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
- **Windows x64:** not currently built from this repo's CI — see below.

On first launch on macOS, if Gatekeeper blocks the app: right-click the app in
Applications → Open, or run `xattr -cr "/Applications/PonyABC Desktop.app"`.

## Building the Windows installer yourself

This project's development sandbox is a Mac with no Windows host and no working `wine`,
so a Windows `.exe` installer can't be produced there. If you have a Windows machine:

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
