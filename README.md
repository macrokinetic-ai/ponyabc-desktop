# PonyABC Desktop

Companion desktop app for the PonyABC Bluetooth talking pen: pen registration, a
two-pane manager for DIY recordings (pen SD card ⇄ computer), and (planned) BOOK
content management and a Windows firmware wizard.

**Status: internal test builds.** Not signed with a real Apple Developer ID or Windows
code-signing certificate — macOS Gatekeeper and Windows SmartScreen will warn (or, on
macOS, refuse outright) on first launch; see **Known install blockers** below before
assuming a download is corrupted. Not an official release channel.

## Downloads

Grab the latest build from the [Releases page](../../releases/latest), and verify the
file against the matching `.sha256` before installing (`shasum -a 256 -c
<file>.sha256`, or `certutil -hashfile <file> SHA256` on Windows). Every installer in a
given release is built from the exact same tagged commit. The app itself also checks
for updates (Settings → About this App → Check for updates) — the button opens this
Releases page in your browser, it does not download or install anything on its own.

- **macOS, Apple Silicon (M1/M2/M3/…):** `PonyABC-Desktop-v<version>-applesilicon.dmg`
- **macOS, Intel:** `PonyABC-Desktop-v<version>-appleintel.dmg`
- **Windows x64:** `PonyABC-Desktop-v<version>-winx64.exe` — built automatically by
  GitHub Actions (see below) and attached to each tagged release, no local Windows
  machine needed.
- **Windows x64, Store package:** `PonyABC-Desktop-v<version>-winx64.appx` — same GitHub
  Actions workflow, also attached to each tagged release. This is a genuine Appx-format
  package (built via `makeappx.exe`, the same underlying format Microsoft's Store also calls
  "MSIX" for a plain full-trust desktop app like this one — `.appx` is directly accepted for
  Store submission, not a lesser/renamed substitute) for sideload-testing before Microsoft
  Store submission, **not** the Store listing itself (that's a separate Partner Center
  submission — see `tasks/todo.md`'s MSIX section). It's signed only with a throwaway CI/local
  test certificate, never a Store-trusted one — **do not distribute this file to real
  customers as an installer**; it exists for sideload verification only. Installing it
  requires enabling Developer Mode (Settings → Privacy & security → For developers) or
  importing that test certificate into your Trusted People store first (see `tasks/todo.md`
  for exact steps and cleanup instructions).

## Known install blockers (unsigned builds)

- **macOS "\<app\> is damaged and can't be opened."** As of this build, the packaged
  `.app` is given a real ad-hoc signature after packaging (`scripts/afterPack.cjs` —
  needed because `electron-builder`'s own signing is off, `mac.identity: null`, and
  without it the shipped app kept a broken, stale signature left over from before
  electron-builder repacks its resources). That fixes the broken-signature class of
  "damaged" report, confirmed with `codesign --verify --deep --strict`. It does **not**
  make the app Gatekeeper-trusted: a fresh download is quarantined by the browser, and
  `spctl` still rejects an ad-hoc (non-Developer-ID) signature once quarantined —
  confirmed by reproducing that exact state locally. A real fix needs a paid Apple
  Developer ID Application certificate plus `notarytool` submission. Until then, if
  macOS still blocks the app: right-click the app in Applications → Open, or run
  `xattr -cr "/Applications/PonyABC Desktop.app"`.
- **Windows "Windows protected your PC" / unknown publisher.** Expected for an
  unsigned `.exe` — needs a Windows code-signing certificate to remove, and even a
  freshly-signed low-reputation binary can still trip SmartScreen for a while
  regardless. Click "More info" → "Run anyway" to proceed.

## Windows builds via GitHub Actions

This project's development sandbox is a Mac with no Windows host and no working `wine`,
so Windows installers can't be produced there directly. Instead,
`.github/workflows/build-windows.yml` builds them on GitHub's free hosted Windows runner
(no cost on a public repo):

- Runs on every push to `main` (typecheck + test + `npm run dist:win` for the NSIS `.exe`,
  then an ephemeral self-signed test certificate is generated and `npm run dist:win:appx`
  builds the Store package, which is then sideload-installed, launched, and probed for real
  via `Add-AppxPackage`/`Get-AppxPackage`/a direct launch/a harmless firmware-plumbing check —
  not just packaged and assumed to work; see the workflow's step names for exactly what each
  check verifies) on every version tag push (`v*`), where it additionally attaches both
  installers straight to that tag's GitHub Release.
- Can also be run on demand from the repo's **Actions** tab → *Build Windows EXE + Store
  package* → *Run workflow*.
- A workflow-artifact build (from a plain branch push, not a tagged release) requires
  being signed in to GitHub to download from the Actions run page; a release asset (from a
  tag push) does not.
- The Store package's Partner Center identity (`PonyABC.PonyABCDesktop`, publisher
  `CN=E476FCF5-1C63-4A56-85B1-DA5D642911B5`) lives in `electron-builder.win-appx.yml` — the
  actual Microsoft Store submission is a separate, manual Partner Center step, never done by
  this workflow.

You can still build either locally on an actual Windows machine the same way the workflow
does, if you'd rather:

```bash
git clone https://github.com/macrokinetic-ai/ponyabc-desktop.git
cd ponyabc-desktop
npm install
npm run dist:win        # NSIS .exe (unsigned)
npm run dist:win:appx   # Store package (.appx) — needs a certificate whose Subject matches
                         # electron-builder.win-appx.yml's `publisher` on your signing
                         # machine (CSC_LINK/CSC_KEY_PASSWORD env vars), e.g. a self-signed
                         # test cert per the CI step above, to produce an installable package
```

The installer(s) will be in `release/`.

## Development

```bash
npm install
npm run dev        # electron-vite dev server, hot reload
npm run typecheck
npm test            # vitest
npm run dist:mac       # unsigned mac build (identity: null)
npm run dist:win       # unsigned windows NSIS .exe
npm run dist:win:appx  # windows Store package (.appx) — see "Windows builds" above for signing
```

Stack: Electron + React + TypeScript (electron-vite), i18next (8 UI languages),
vitest. See the source comments in `src/main/window.ts` and `src/main/services/
pathSecurity.ts` for the security model (contextIsolation + sandbox, narrow preload
API, main-process-only filesystem trust).
