# PonyABC Desktop

Companion desktop app for the PonyABC Bluetooth talking pen: pen registration, a
two-pane manager for DIY recordings (pen SD card ⇄ computer), and (planned) BOOK
content management and a Windows firmware wizard.

**Status: internal test builds.** Unsigned — macOS Gatekeeper and Windows SmartScreen
will warn on first launch; that's expected for now. Not an official release channel.

## Downloads

Grab the latest build from the [Releases page](../../releases/latest). The app itself
also checks for updates (Settings → About this App → Check for updates) and links back
here — it never auto-installs anything, since these builds aren't code-signed yet.

- **macOS, Apple Silicon (M1/M2/M3/…):** `PonyABC Desktop-*-arm64.dmg`
- **macOS, Intel:** `PonyABC Desktop-*.dmg` (no `-arm64` suffix)
- **Windows x64:** `PonyABC Desktop Setup *.exe` — built automatically by GitHub Actions
  (see below) and attached to each release, no local Windows machine needed.

On first launch on macOS, if Gatekeeper blocks the app: right-click the app in
Applications → Open, or run `xattr -cr "/Applications/PonyABC Desktop.app"`.

## Windows builds via GitHub Actions

This project's development sandbox is a Mac with no Windows host and no working `wine`,
so a Windows `.exe` installer can't be produced there directly. Instead,
`.github/workflows/build-windows.yml` builds it on GitHub's free hosted Windows runner
(no cost on a public repo):

- Runs on every push to `main` (typecheck + test + `npm run dist:win`, result uploaded as
  a workflow artifact — useful to catch a Windows-specific build break early) and on every
  version tag push (`v*`), where it additionally attaches the built `.exe` straight to
  that tag's GitHub Release.
- Can also be run on demand from the repo's **Actions** tab → *Build Windows EXE* →
  *Run workflow*.
- A workflow-artifact build (from a plain branch push, not a tagged release) requires
  being signed in to GitHub to download from the Actions run page; a release asset (from a
  tag push) does not.

You can still build it locally on an actual Windows machine the same way the workflow
does, if you'd rather:

```bash
git clone https://github.com/macrokinetic-ai/ponyabc-desktop.git
cd ponyabc-desktop
npm install
npm run dist:win
```

The installer will be in `release/`.

## Development

```bash
npm install
npm run dev        # electron-vite dev server, hot reload
npm run typecheck
npm test            # vitest
npm run dist:mac    # unsigned mac build (identity: null)
npm run dist:win    # unsigned windows build
```

Stack: Electron + React + TypeScript (electron-vite), i18next (8 UI languages),
vitest. See the source comments in `src/main/window.ts` and `src/main/services/
pathSecurity.ts` for the security model (contextIsolation + sandbox, narrow preload
API, main-process-only filesystem trust).
