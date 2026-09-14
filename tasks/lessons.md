# Lessons

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
