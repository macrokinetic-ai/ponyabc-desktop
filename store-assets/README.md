# Store submission assets

Screenshots in `screenshots/` are REAL captures from a running build (via
`scripts/capture-screenshots.mjs`, a CDP-driven click-through — never hand-drawn mockups), not
placeholders. Current status:

| File | Usable for the Store listing as-is? |
| --- | --- |
| `macos-dev-home.png` | Yes — generic content, no platform-specific text visible. |
| `macos-dev-book-library.png` | Yes — real, live BOOK catalog data (37 books). |
| `macos-dev-my-recordings.png` | Yes — generic content, no platform-specific text visible. |
| `macos-dev-firmware.png` | **No.** Shows "Firmware upgrades require the PonyABC Desktop app on Windows. This feature is not available on Mac." — correct behavior, but would read as broken/negative on a *Windows* Store listing. Needs a real capture from the Windows build showing the actual firmware wizard steps. |
| `macos-dev-settings.png` | **No, as captured.** The About panel visibly shows "Mac · Apple Silicon" / `mac-arm64` — needs a Windows-build recapture showing "Windows · x64 (Microsoft Store)" / `win-x64-msix` (see `src/shared/appVariant.ts`) instead. |

All were captured at 1280x860 @2x on macOS (no Windows machine available to this session — see
`tasks/todo.md`'s MSIX section). The rendered UI is identical across platforms (same
Electron/React renderer, confirmed by reading the source — no platform-conditional layout), so
these are representative of layout/content, but a Windows Store listing should still use
native-chrome captures where practical, and MUST replace the two "No" rows above with real
Windows-build captures before submission.

**To capture the remaining two (and refresh all five) from a real Windows build:**

```powershell
# after Add-AppxPackage-installing the built .appx (see tasks/todo.md), or from a plain
# npm run dist:win unpacked build:
node scripts/capture-screenshots.mjs "C:\path\to\PonyABC Desktop.exe" .\store-assets\screenshots --label=winx64
```
