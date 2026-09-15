# Lessons

## Electron's main-process `fetch`/stream interop can silently corrupt bytes — verify a real download's hash against a real server, not just a synthetic response

`bookDownload.ts` originally used `Readable.fromWeb(response.body)` +
`node:stream/promises.pipeline()` to stream a download to disk. Every unit
test passed (mocked `fetch` returning a small `ReadableStream`), and a
standalone Node script (`tsx`, plain Node, not Electron) hitting the exact
same real production URL produced the exact correct SHA-256. Only inside the
running Electron app's main process did the identical code, against the
identical URL, produce the exact right byte **count** but a **different**
hash — confirmed via temporary `console.error` tracing at each stage
(pipeline-done / stat / sha256File), which showed the size check passing and
only the hash comparison failing. The existing checksum verification did its
job and refused to write the corrupted file to the pen every time — it was
never bypassed, silently accepted, or the check itself at fault.

**Fix:** stop going through the Node-stream conversion layer — read the
WHATWG `ReadableStream` directly via `response.body.getReader()` and pump
chunks manually into the write stream, with explicit backpressure handling
(`write()`'s return value + the `'drain'` event) and an explicit
`writeStream.end()` callback instead of relying on `pipeline()` to know when
both sides are truly done.

**How to apply:** a synthetic fetch mock (even a byte-accurate one) proves
the code path works, not that the specific runtime's stream implementation
is faithful — for any feature streaming real bytes through Electron's main
process, verify a real download's content hash against a real server
response before considering it verified, the same way real hardware output
was needed to catch the MPEG Layer II bug below. Isolating the same function
in plain Node (outside Electron) to compare its output byte-for-byte against
Electron's own run is what actually pinpointed this as an Electron-specific
interop bug rather than a logic bug in the download code itself.

## Two related races found while rewriting the same download loop — audit cancellation and cleanup against the actual event semantics, not the ones that feel intuitive

While replacing the streaming approach above, two more bugs surfaced only
via real failing tests (not reasoning about the code):
1. **`reader.cancel()` resolves a pending `read()` as `{done: true}`** (a
   normal-completion signal per the streams spec), not a rejection. A
   cancel-on-abort listener that calls `reader.cancel()` can therefore win a
   `Promise.race()` against an abort-rejection listener with the *wrong*
   outcome — a cancelled download was silently treated as "finished
   successfully" with a truncated read, producing a false `hash-mismatch`
   instead of `cancelled`. Fix: race explicitly against the abort signal
   itself (a separate promise that rejects on `'abort'`), and only call
   `reader.cancel()` afterward, as pure cleanup — never as part of what
   decides the race.
2. **`fs.createWriteStream(...).destroy()` doesn't guarantee the file's
   pending `open()` has completed** — if a stream is destroyed before it
   ever wrote anything (e.g. the very first chunk already failed
   validation), an `unlink()` issued immediately after can race ahead of
   that still-pending open and miss the file it creates a moment later,
   leaving an orphaned empty temp file. Fix: wait for the stream's `'close'`
   event (which only fires once the fd is actually released) before
   unlinking.

**How to apply:** when cleaning up a stream/reader on an error or
cancellation path, don't assume a "cancel" or "destroy" call synchronously
undoes everything it started — check what event actually signals true
completion (a rejection vs. a normal resolution; a `'close'` event vs. the
method call itself) and gate cleanup on that, not on the call that merely
*requests* it. A real failing test (not code review) is what caught both of
these.

## A ".mp3" file extension doesn't mean the data is MPEG Layer III — check with real hardware output, not just synthetic test files

The v0.2.6 MP3 preview feature passed every test I ran (typecheck, unit tests, CDP with a
`lame`-encoded fixture) but failed immediately on the user's real physical pen. Root cause,
confirmed with the user's own uploaded file via `file`/`afinfo`: the pen records **MPEG-1
Layer II**, not Layer III — cheap embedded audio hardware commonly does this since Layer II is
simpler/cheaper to encode, but still ships with a `.mp3` extension for generic compatibility.
Chromium's native `<audio>` element only decodes Layer III, so it silently (if technically
correctly) rejected every real recording, while the OS's own player (QuickTime/CoreAudio, more
permissive) played the same file fine — which is why "it plays on my Mac" and "the app says
unsupported" were both true at once, not a contradiction.

**How to apply:** a synthetic test fixture I generate myself (`lame`, `afconvert`, etc.)
proves the *code path* works, not that it's compatible with what real hardware actually
produces — for any feature reading device-generated files whose format is asserted only by
convention/extension, get an actual sample from the real device before considering it verified.
When a user reports "doesn't work" after I tested it myself, ask for the actual file (or a
`file`/hexdump of it) rather than re-testing with my own fixture again — that's what actually
diagnosed this in under two tool calls once the file was in hand.

## React 18 StrictMode double-invokes the *function* form of a state setter — never put a side effect inside `setState(prev => ...)`

Confirmed by CDP: a `togglePlayPause` written as `setState(prev => { stopNode(); startNode();
return {...prev, playing: !prev.playing} })` visibly flip-flopped back to the wrong icon on
every click. StrictMode (used in `src/renderer/main.tsx`, matching real production rendering)
intentionally calls a functional updater passed to `useState`'s setter twice, specifically to
help surface impure updaters — so any side effect inside one runs twice per logical call. Pure
computations inside an updater (reading refs, no mutation) are fine to double-invoke, since
they're idempotent; anything that starts/stops/mutates external state must not live there.
**Fix pattern:** keep a ref mirror of the state (updated by a `setStateAndRef` wrapper used at
every real setState call site), perform side effects directly in a plain function body reading
that ref, and call `setState` with a **plain value** (never a function) once the side effect is
done.

**How to apply:** a unit test rendered without `<StrictMode>` will never catch this class of
bug — it needs either a StrictMode-wrapped render in the test (see `renderScreenStrict` in
`MyRecordingsScreen.test.tsx`) or a real CDP run against the actual app (which already wraps
its tree in StrictMode). Don't trust a green non-StrictMode unit test suite alone for any hook
with imperative side effects in its setters.

## A PNG's "transparent" area can actually be opaque white — check the alpha channel, don't assume

The provided `ponyabc_logo1.png` looked like a normal logo on transparent background when
viewed in chat, but compositing it onto a real transparent canvas revealed a hard-edged
rounded-card shape: the corners were genuinely `alpha=0`, but ~70% of the canvas (a large
rounded-bottom region) was fully **opaque white** (`alpha=255`), baked in from whatever it
was originally designed for (a card/header background). Used directly as an app-icon source,
this would have produced a visible mismatched white card shape under the OS's own icon mask.
Confirmed by extracting and viewing just the alpha channel (`img.getchannel("A")`) rather than
trusting how the RGB composite looked — always do this before using a supplied logo as an
icon source. Fixed via a flood-fill from the genuinely-transparent border pixels through
connected near-white opaque regions (leaves white text/details that are enclosed by non-white
colors, like the logo's own lettering, untouched since they're not border-connected).

## Never pass a `${...}`-templated electron-builder value through a CLI `-c.key=value` override — put it in a YAML file instead

`npm run dist:win`'s `electron-builder --win -c.win.artifactName='PonyABC-Desktop-v${version}-winx64.${ext}'`
looked fine locally (bash) but broke on the real windows-latest GitHub Actions runner: the
`run:` step uses PowerShell, but npm's own script runner spawns the actual script via
`cmd.exe` regardless — and cmd.exe does not strip single quotes as a quoting mechanism at
all, so the literal `'...'` characters end up baked into the artifactName string, producing
a real file named `'PonyABC-Desktop-v0.2.5-winx64.exe'` (quote marks included) that
`actions/upload-artifact`'s `release/*.exe` glob then couldn't find (job failed with "No
files were found"). Double-quoting would have "fixed" cmd.exe but broken bash instead
(bash expands `$version` inside double quotes). There is no quoting style that is safe on
both shells for a string containing a literal `$`.

**How to apply:** any electron-builder config value that itself contains `${...}` template
syntax must live in a YAML config file (loaded via `-c <path>`, with `extends: ./electron-builder.yml`
for shared base config — confirmed this merges correctly), never in a CLI `-c.key=value`
override. A YAML string value has no shell in the way at all. Caught this by actually
watching the real Windows Actions run fail (`gh run view --log-failed`), not by reasoning
about it on Mac — the failure mode is invisible unless you run it on the actual target
shell.

## Path-containment checks must use `path.relative()`, not `startsWith(parent + sep)`

A naive `real === parent || real.startsWith(parent + path.sep)` containment check breaks
on a Windows drive root: `fs.realpathSync('D:\\')` already ends in a separator, so
`parent + sep` becomes a double backslash that a real child (`D:\BOOK`) never starts
with — wrongly rejecting every file under a drive-root pen. This silently broke both
manual folder selection AND auto-scan (a rejected drive never becomes a scan candidate),
and was invisible for a long time because "found nothing" and "found something that
failed validation" looked identical in the UI.

Fix: `path.relative(parent, child)` — check `=== ''` (same location, including trailing
slash/case/UNC-alias differences — **treat as contained, not rejected**, an early draft
of this fix got that inverted, which would have let `resolveDestination`'s on-pen guard
be bypassed), `=== '..'` or starts with `'..' + sep` (escape, reject), otherwise
`!isAbsolute(rel)` (cross-drive escape check). Verified directly in Node (not assumed)
that `path.win32.relative` is already case-insensitive and handles UNC paths correctly,
so no separate case-folding logic was needed.

**How to apply:** any new path-containment check in this codebase should go through
`isPathContained()` in `src/main/services/pathSecurity.ts`, never a hand-rolled prefix
check. Test path-security logic by injecting `path.win32`/`path.posix` directly
(`tests/unit/pathContainment.test.ts`) rather than relying only on same-OS
`fs.realpathSync` fixtures — that's what let this ship unnoticed on a Mac-only dev
machine in the first place.

## electron-builder: an explicit `arch` array on a target beats CLI `--arm64`/`--x64`

Confirmed by direct testing: with `mac.target: [{target: dmg, arch: [x64, arm64]}]` in
electron-builder.yml, passing `--arm64` on the CLI did **not** restrict the build to
arm64 — it built both archs anyway (racing to write the same artifactName and
corrupting the second DMG's `hdiutil convert`). Fix: leave `arch` off the YAML target
entirely (`target: [dmg]`) and let each `pack:mac:arm64` / `pack:mac:x64` npm script's
CLI flag be the only thing selecting the arch.

## electron-builder: `afterSign` does not run when `identity: null` skips signing

`identity: null` makes electron-builder skip its own signing step entirely (confirmed by
reading `node_modules/app-builder-lib/out/platformPackager.js` directly), and when no
signing occurred, `afterSign` is skipped too (electron-builder logs "skipping afterSign
hook as no signing occurred, perhaps you intended afterPack?"). Use `afterPack` instead
for any post-packaging step (like our own ad-hoc `codesign --force --deep --sign -`) that
must run regardless of whether real signing happened.

## Verify security/forensic claims by reproducing the actual failure locally, not by inspecting one layer

`codesign -dv` only prints signing *information* — it does not validate signature
integrity (that's `codesign --verify --deep --strict`), and a clean local launch proves
nothing about Gatekeeper's verdict on a real downloaded (quarantined) copy. The real
technique: copy the built .app, manually set `com.apple.quarantine` to the same value a
browser would, then run `spctl -a --type execute` on that copy — this reproduced the
"already damaged" report locally and distinguished two different failure classes (a
broken/stale signature after electron-builder repacks resources without re-signing —
`codesign --verify` error "code has no resources but signature indicates they must be
present" — vs. a valid-but-untrusted ad-hoc signature, which `spctl` separately rejects
for lacking a trusted identity). Don't accept "it launched" or "-dv shows a signature"
as proof of anything Gatekeeper-related; reproduce the actual quarantine + policy check.

## When a user gives corrections mid-plan-approval, incorporate them without a second full plan round

Explicit instruction observed in this session: "計劃方向批准，請直接納入以下修正後實作，不需要重新提交整份計劃"
(plan direction approved, incorporate these corrections directly into implementation, no
need to resubmit the whole plan). When a user approves the overall direction but attaches
specific technical corrections, update the plan file for the record and proceed straight
to implementation — don't loop back through another ExitPlanMode approval cycle, that's
exactly the overhead they were asking to skip.

## `useTranslation(ns)` already scopes to that namespace — don't also prefix keys with `ns.`

Wrote the entire first draft of `BookLibraryScreen.tsx` calling `t('book.refresh')`,
`t('book.status.notCached')`, etc. under `const { t } = useTranslation('book')`. Since the
namespace is already `'book'`, every one of those should have been `t('refresh')`/
`t('status.notCached')` — the `'book.'` prefix made every single call miss, silently
rendering raw i18n keys (`book.refresh`) as the displayed text instead of falling back to
English or throwing. Only caught because a renderer test asserted on real rendered text
(`screen.findByText('Book One')`, `/Last updated:/`) rather than only checking for the
presence of *some* string — an assertion pattern like `expect(container).toBeTruthy()`
would never have caught this.

**How to apply:** when writing `t()` calls in a component scoped via
`useTranslation('someNamespace')`, keys are relative to that namespace only — grep the
component's `t('` calls against the actual locale JSON's top-level keys before considering
i18n work done, and make sure at least one renderer test asserts on real translated text
(not just a key's presence in a mock).

## An async function meant to return a typed failure result must guard EVERY fs call, not just the ones already wrapped in try/catch

`bookBackup.ts`'s `backupBeforeRemove()` wrapped `copyFile`/`unlink`/hashing in try/catch to
return `{ok: false, message}` on failure, but the earlier `fs.mkdirSync(filesDir, {recursive:
true})` was left bare — a real filesystem error there (parent path occupied by a file, a
permissions failure) would throw synchronously and reject the whole async function instead
of returning the typed failure the caller (`bookRemove.ts`) expects, propagating as an
unhandled rejection rather than a clean `backup-failed` status. Found while writing a test
that deliberately pre-occupied the target directory path with a plain file.

**How to apply:** when a function's contract is "never throws, always returns a typed
result," audit *every* synchronous fs call in it (not just the ones that felt risky while
writing it) — a bare `mkdirSync`/`writeFileSync`/`statSync` mid-function is exactly the kind
of thing that looks safe until a test (or a real EACCES/ENOTDIR) proves otherwise.

## `fs.createReadStream(...).on('end', ...)` is not proof the file's OS handle is released yet — matters on Windows if you unlink/rename that same path next

`sha256File()` resolved its promise on the stream's `'end'` event. `bookRemove.ts` hashes a
pen file (`sha256File`) and then, in the very next line, `fs.promises.unlink`s that exact
path. Passed every local (macOS) test and typecheck, then failed on the very first real
`windows-latest` CI run with `ENOTEMPTY`/handle-still-open errors during cleanup — `'end'`
fires once the last byte is read, but the stream's underlying file descriptor is released
asynchronously afterward via a separate internal close; on Windows (unlike POSIX, which
allows deleting/renaming a file with open handles) a delete/rename racing that release can
fail or leave the directory transiently "busy." `safeWriteFile` has the same
hash-then-rename shape and was quietly exposed to the identical race.

**Fix:** resolve on the stream's `'close'` event instead of `'end'` — `'close'` only fires
after the fd is actually released, so a caller that immediately deletes/renames the same
path next is safe. Compute the digest at `'end'` (correctness), gate the promise resolution
on `'close'` (Windows safety) — two different concerns, two different events, don't collapse
them into one.

**How to apply:** any Node code that reads a file via a stream and then deletes/renames/
moves that *same path* immediately afterward needs to wait for the stream's `'close'`, not
just `'end'`/`'finish'`, before doing so — and this class of bug is only ever caught by a
real Windows CI run, never by local macOS testing or by reasoning about it. Push early and
let `build-windows.yml` run rather than assuming a Mac-clean test suite generalizes.

## A single boolean "offline" flag conflated two very different situations — "never succeeded" and "just failed, but old data still exists" — and hid the real reason from the user

`BookLibraryMeta.offline` was `snapshot === null`, i.e. true only when NO catalog fetch had
*ever* succeeded. A *later* refresh failure, with an older successful snapshot still on disk,
left `offline` false and showed nothing — the user's real screenshot showed the app displaying
"could not be reached / showing what was last saved" simultaneously with "Catalog not yet
loaded" and every pen file as "Unknown," which looked like a stuck/contradictory state but was
actually this exact gap: a genuine first-run catalog-fetch failure with no real bug underneath
it, just no visibility into *why*.

**Fix:** added `BookLibraryMeta.lastCheck` — the outcome of the *most recent* fetch attempt
(state/httpStatus/itemCount/message/durationMs), tracked independently of whether an older
snapshot still exists. A `BookCatalogBar` component (mirroring `PenRootBar`/`ComputerFolderBar`
for left/right layout parity) renders a dot + text from this: checking / connected-with-count /
connected-but-empty (distinct from a failure) / server-error-with-status / network-unreachable,
plus "using the last saved catalog" only when a real prior snapshot exists. Also added a
persistent (capped, redacted) diagnostics log (`diagnostics.ts`) recording every catalog-fetch
attempt's URL/status/duration/outcome, gated behind a hidden (not real access control) passcode
in Settings, exportable via a native save dialog — so a real-world "why didn't it connect"
question is answerable from the log, not just re-guessed.

**How to apply:** when a status flag can be set once and never revisited, ask whether a *later*
failure needs its own visibility — collapsing "never happened" and "happened before, failing
now" into one boolean silently hides the more common, more actionable case. Any user-facing
connectivity/sync status needs a distinct "last attempt" outcome, not just a "do we have
anything at all" flag.

## Don't hash a file's content just to list it — filename-matching and content-verification are different costs, and the first must never wait on the second

The original `buildBookLibrary()` computed a SHA-256 of every matched pen file (to decide
current-vs-differs) *before* returning either pane's list. Real catalog books range up to
~1GB; hashing one inline meant the whole BOOK screen could sit blank while a single large file
was read start-to-finish, and it's a real user complaint waiting to happen even though every
existing test used small fixture files that hashed instantly.

**Fix:** split into a fast, hash-free filename-matching pass (`buildBookLibrary`, returns
`'matched-verifying'`/`'on-pen-verifying'` for anything that still needs a hash comparison,
plus a `pending` list of what needs verifying) and a separate `verifyPendingHash()` the caller
runs afterward, pushing the resolved current/differs outcome to the renderer via a dedicated
IPC event (`bookVerifyUpdate`) that patches just that one item in both panes — no full re-list
round trip, and the two panes never each hash the same file independently (one `pending` entry
drives both).

**How to apply:** when a "list this" operation and a "verify this one item's content" operation
share a code path, check whether the verify step's cost scales with data the list step doesn't
actually need yet (file size here) — if so, the list must return an honest "not yet known"
status rather than block on it, even if every test fixture is small enough that inlining it
never fails a test.

## "Never block the list on hashing" isn't enough by itself — a deferred-but-still-automatic verification, re-triggered on every list call, silently turns into repeated full re-reads

The previous fix (above) made `buildBookLibrary` hash-free and pushed verification into a
"pending" list the *caller* resolved right after. That caller (`bookList`/`bookCatalogRefresh`)
re-triggered that pending-verification pass on *every single call* — mount, manual refresh,
and after every add/remove (each of which re-lists). `verifyInFlight` only deduped two
*literally concurrent* requests for the same file; it never remembered an already-completed
result, so a user who refreshed a few times, or added/removed one book, quietly re-hashed every
other large matched AXB on the pen each time — "the busy spinner clears fast" hid that a
detached background read was still churning through hundreds of MB repeatedly. A real
consultant reading the code (not a user complaint) caught this.

**Fix:** verification became a fully separate, explicit, user-triggered action ("Verify
selected content") instead of anything list/refresh ever kicks off automatically, with its
result persisted in a small capped index keyed to the pen's device-identity generation + the
file's exact size/mtime + the catalog's current official hash — a cache hit skips re-hashing
entirely, invalidated the instant any of those four things changes, never merely by volume
label/path looking the same.

**How to apply:** "never block the list" and "never repeat the same work automatically" are two
different guarantees — fixing the first (deferring heavy work out of the hot path) doesn't
fix the second (that deferred work silently re-running every time the hot path is hit again).
When deferring expensive work out of a frequently-called function, ask separately: how often
does the *caller* of that function actually run, and does deferred work get memoized/persisted,
or just moved one frame later and repeated just as often as before?

## Destroying a Node stream before its `'error'` listener is attached throws an uncaught exception — attach every listener first, branch on already-aborted state after

`sha256FileWithProgress`'s already-aborted-signal path called `stream.destroy()` then
`reject(...)` and `return`ed — *before* the function reached its `stream.on('error', fail)`
line further down. `EventEmitter` throws synchronously (an uncaught exception, not just an
unhandled rejection) when an `'error'` event fires with zero listeners attached, and
`destroy()`ing a stream that hasn't finished opening does exactly that. Every test passed in
isolation; only running the full suite surfaced it as a real uncaught exception (Vitest's
`Unhandled Errors` section), triggered by the specific "signal already aborted before the call"
test.

**Fix:** attach all of the stream's listeners (`data`/`end`/`close`/`error`) unconditionally
first; only after that, check `signal.aborted` and call the shared `fail()` helper (which now
always has a live `'error'` listener to land on) instead of a separate ad hoc destroy+reject.

**How to apply:** whenever a code path can call `.destroy()` (or otherwise force an `'error'`
emission) on a Node stream/EventEmitter, verify by inspection that an `'error'` listener is
already attached at that exact point in execution — not just "attached somewhere in the
function" — and write the test for the *already in the terminal state before you start*
case specifically (not just "abort while in progress"), since that's the one most likely to
race ahead of setup code.

## "Matched by filename" quietly absorbed "matched but wrong size" too

`buildBookLibrary`'s filename-lowercase join only ever compared names — a
pen file that matched a catalog entry's filename but had a different
declared size fell into the exact same "present"/"on-pen-present" bucket as
a genuine, correctly-sized, simply-not-yet-hashed match. Both are
legitimately "not yet verified," but a size mismatch is a far stronger,
zero-cost (stat-only) signal that something is actually wrong, and burying
it inside the generic "unverified" bucket meant the user had no way to
notice without manually running a full hash verify. Fix: compare
`penFile.sizeBytes` to `entry.sizeBytes` as its own decision point, before
falling back to the verify-record lookup — a size-differs status is decided
and shown before any hashing question even arises. General rule: when a
"matched" concept is built from a single join key (filename here), check
whether OTHER already-known-for-free fields (size, mtime — anything from a
plain `stat`) can further distinguish "matched and this looks right" from
"matched but something is already suspicious," and surface that distinction
immediately rather than lumping it into "not yet checked."

## A status string doing double duty as both "list label" and "detail label" eventually satisfies neither well

`status.present` ("On pen — not yet verified") was used for BOTH the
default collapsed row AND would-be detail text — there was only one string
per status, so making the default list "necessarily short" and the detail
view "fully explicit" pulled in opposite directions on the same key. Fix:
split into two parallel key sets (`status.*` for full/long wording,
`statusShort.*` for the collapsed default) rather than trying to find one
string that reads well in both contexts. General rule: when a UI grows an
explicit "brief by default, detailed on demand" requirement, check whether
an existing single-purpose string is being asked to serve both purposes —
if the two contexts have different accuracy/verbosity requirements (here:
default must never overclaim "verified", detail should say the full state
plainly), split the string, don't compromise on one shared version.

## A trivial-looking "open URL" wrapper is still a real bug surface — don't copy-paste it wrong

While wiring the new "Open full website privacy policy" button, the first
draft called `window.ponyabc.openRegistrationPage()` (opens the REGISTRATION
page) instead of a new privacy-policy opener, then tried to paper over it
with a `window.open(PRIVACY_POLICY_URL)` fallback chained with `&&` after a
`void`-prefixed call — which never ran at all, since `void expr` evaluates
to `undefined` and `undefined && x` never reaches `x`. Caught by re-reading
the diff before testing, not by a test catching it. Fixed by adding a
proper, separate main-process handler (`openPrivacyPolicyPage()`, mirroring
the existing `openRegistrationPage()` pattern exactly: its own hardcoded
URL, its own IPC channel) rather than trying to reuse or patch around the
wrong one. General rule: when a screen needs to open a NEW external URL,
add a new dedicated hardcoded-URL handler mirroring the existing one — never
reuse an existing single-purpose "open X" function for a different
destination, and never chain a fire-and-forget `void` call with `&&` as if
it were synchronous.

## When legal/privacy content needs translation, translate the chrome, not the substance — until it's actually reviewed

For the new Privacy/Legal & Copyright section, the user's instruction was:
don't present a translation as reviewed when it isn't. Rather than
translating the full legal body into 8 languages and appending a disclaimer
(which still ships potentially-wrong legal nuance to users who can't
independently check it against English), only the UI chrome (headings,
button labels, the "pending review" notice itself) was translated; the
substantive paragraphs were kept English-only and fetched via i18next's
`t(key, { lng: 'en' })` override regardless of the active UI locale. General
rule: "don't claim a translation is reviewed" is better satisfied by not
translating the reviewable-risk content at all yet than by translating it
and hoping a disclaimer is enough — reserve full translation for content
where a wrong nuance is low-stakes (ordinary UI copy), not for rights/
retention/company-identity language.

## A real confirmed outcome outranks static config-string evidence — don't let "the label looks wrong" become "this doesn't work"

Investigated `tools.zip` and found `isd_config.ini` declaring
`PID=AC696x_TWS`/`SDK_TYPE=SOUNDBOX` (a Bluetooth-earbud/speaker product
identifier) plus a different bootloader filename (`br25loader.bin`) than a
PDF screenshot (`br21loader.bin`). Concluded and reported, as a headline
finding, that the zip was "NOT the P5 pen's firmware package" — a strong,
unqualified negative claim built entirely from static text inside
config/filenames. The user then reported they had personally, successfully
flashed a real P5 pen using that exact zip — the static evidence was real,
but the inference drawn from it was wrong. Vendors commonly reuse a shared
SDK template (with its original product-line labels left untouched inside
config comments) across genuinely different hardware products; a label that
looks like it names the wrong product is not proof the config doesn't work
for this one — it's only proof the vendor didn't bother renaming an internal
string. General rule: when static/textual evidence (file names, embedded
labels, config strings) conflicts with a real, user-confirmed outcome, the
real outcome wins — reframe a "definitely wrong" static finding as "this
looks surprising, worth confirming" rather than reporting it as a settled
conclusion, especially when the user hasn't yet been asked whether they've
actually tried it. Ask before concluding, when asking is possible.

## When a "confirmed working" script has a dev-toolchain dependency that's provably absent, trace WHY it still worked instead of guessing

The confirmed real upgrade entry point (`tools\download.bat`) starts by
invoking a hardcoded `C:\JL\pi32\bin\llvm-objcopy.exe` that essentially no
end-user machine has. Rather than assuming "it must silently succeed
somehow" or "the user must have had the toolchain installed", traced every
subsequent line: each objcopy/objdump failure is harmless because its
output file already exists pre-built in the package; the final concatenation
step even references a `bank.bin` that doesn't exist anywhere in the zip, so
it structurally cannot ever produce fresh output; and the two files that DO
get unconditionally copied afterward are byte-identical in size to what's
already at the destination, making that copy a no-op. This turned "trust me,
it works" into a specific, verifiable mechanical explanation, which then
directly justified a design decision (invoke the top-level script as-is,
never skip to the inner tool) with evidence instead of assumption. General
rule: when a real, confirmed-working outcome conflicts with a script's
apparent hard dependency, don't stop at "it must be fine" — trace the actual
control flow far enough to explain the specific mechanism, since that
mechanism is often exactly what later engineering decisions should hinge on.

## A missing source file and a same-SIZE destination are not proof a copy step is a no-op — test the real platform semantics and hash the bytes

**Correction to the lesson above (2026-09-15).** The trace was right to go looking
for a mechanism instead of assuming, but two of its specific claims were
unverified assumptions dressed up as conclusions: (1) "`bank.bin` doesn't exist,
so [`copy /b`] structurally cannot ever produce fresh output" — this assumes
`copy /b` aborts/no-ops when one source in a `+`-joined list is missing, never
actually tested. (2) "byte-identical in **size**... making that copy a no-op" —
same size is not the same as same bytes. The user caught both by asking a
specific, falsifiable question rather than accepting the narrative.

**What real testing showed:** dispatching a manual-only GitHub Actions workflow
against `windows-latest` with 100%-synthetic placeholder files (never the vendor
tool) proved `copy /b f1+f2+missing.bin dest` does NOT skip or abort — it silently
drops the missing source and still overwrites `dest` from whatever sources exist,
exit code 0, no error text. So claim (1) was false as a mechanism. Separately,
hashing (SHA-256, not `ls -la` size) directly from the pristine `.zip` via
`unzip -p file | shasum -a 256` — never from possibly-already-touched extracted
copies — proved claim (2)'s files WERE actually byte-identical, and additionally
proved the *real* reason the net effect is still a no-op: concatenating the 13
present source files (bank.bin correctly omitted) reproduces the destination's
exact hash. The right conclusion turned out to be reachable, but only by verifying
the actual mechanism, not by the two shortcuts originally taken.

**How to apply, generally:**
- Never conclude "a command can't do X" from "one of its inputs is missing"
  without checking that platform/tool's actual documented or tested behavior on a
  missing input — many copy/build/link tools skip-and-continue rather than abort,
  especially multi-source concatenation syntax like `copy /b a+b+c`.
- Never treat matching file **size** as evidence of matching **content**. Hash it
  (SHA-256 here; whatever's cheap and collision-safe for the context). This
  project already had `sha256File` and `certutil -hashfile` idioms in active use
  elsewhere (BOOK downloads, `safeWriteFile`) — the same discipline should have
  applied to this investigation from the start, not just to code paths that ship.
- When a real Windows-only behavior is in question and a real Windows CI runner
  is available (`windows-latest` via `workflow_dispatch`, the existing pattern
  from the elevation-smoke workflow), reproduce the EXACT structure (same `+`
  count/position of the missing file, same pre-existing-destination-or-not cases)
  with harmless synthetic files rather than reasoning about cmd.exe semantics
  from memory — it's cheap (seconds of runner time) and removes the guesswork
  entirely.
- A "confirmed/inferred/unverified" split in the write-up (rather than a single
  flat conclusion) makes gaps like the still-open `remove_tailing_zeros.exe`
  question in this same investigation visible instead of buried — keep using it
  for any multi-step no-vendor-execution investigation.

## "The user clicking acknowledge" is not evidence of anything about the real world — encode what IS evidence as a typed fact, not as a status label

**What happened (2026-09-15, v0.3.7).** The previous round fixed the *documentation*
around the firmware wizard's lock safety but left the actual code unchanged: on
an `'unclear'` outcome, `acknowledgeFirmwareOutcome()` unconditionally released
both the pen lock and the firmware in-progress guard the moment the user clicked
"I understand" — for EVERY unclear reason, including `'timeout'` (we gave up
watching; the real elevated process might still be running) and an internal
error thrown who-knows-when relative to the actual launch. The user rejected
this immediately: a UI acknowledgment is evidence the user read a message, never
evidence about a real external device's state.

**The fix's shape, generalizable beyond this feature:** don't let a single
`status` enum (`'success' | 'failed' | 'unclear'`) carry two different meanings
at once — "what should the user see" and "is it safe to unlock shared state."
Those turned out to need different answers for the same `status: 'unclear'`
value (a `'no-recognized-signal'` unclear has confirmed termination and CAN be
unlocked; a `'timeout'` or `'unparseable'` unclear does NOT and must not be,
ever, short of a full app restart resetting the in-memory lock). Splitting them
into a second explicit boolean field (`processTerminationConfirmed`) computed
once, close to the actual evidence (`elevation.status === 'completed'` — i.e.
PowerShell's own `-Wait` genuinely returned), and then gating every
lock-release/no-release decision on THAT field rather than on `status`, made an
entire class of "acknowledge secretly means different things depending on
reason" bugs impossible to reintroduce by accident — a future new `'unclear'`
reason has to explicitly pick true or false, there's no silent default that
unlocks.

**Testing an intentionally-permanent lock requires per-test module isolation.**
The regression tests for this (`tests/unit/firmwareIpc.test.ts`) needed to
prove a lock STAYS held forever (until app restart) for the not-confirmed
cases — but `penOperationLock.ts`/`firmwareLock.ts` are plain module-level
singletons, so a lock left deliberately un-released by one test would still be
held in the very next test in the same file, breaking it for an unrelated
reason. Fix: `vi.resetModules()` in `beforeEach` + dynamically re-`import()`
every module in the dependency graph (including the mocked `elevatedRun`) at
the start of each test, so every test gets a completely fresh set of
module-level singletons. Reach for this pattern specifically when a test needs
to assert that some state is NEVER cleared by the code under test — the
"happy path always cleans up" assumption baked into most module-level test
setups is exactly backwards for a safety invariant like this one.

**How to apply, generally:** when a boolean/enum result is used to gate BOTH a
user-facing message AND an irreversible-ish side effect (releasing a lock,
starting a payment, enabling a button that fires once), check whether every
value of that result actually implies a single answer for the side effect. If
even one value is ambiguous (as `'unclear'` was here), split the side-effect
question into its own explicitly-computed field instead of overloading the
display status — and write the test that proves the dangerous value can never
accidentally take the safe path.
