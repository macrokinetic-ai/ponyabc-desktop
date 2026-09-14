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
