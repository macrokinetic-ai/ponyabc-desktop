# Store submission assets

Screenshots in `screenshots/` are REAL captures (via `scripts/capture-screenshots.mjs`, a
CDP-driven click-through — never hand-drawn mockups), not placeholders.

**Current set: all 5 captured from the actual installed Microsoft Store package (`.appx`),
running for real on a Windows CI runner** — not a macOS dev build. Captured by
`build-windows.yml`'s "Store package: capture real screenshots from the installed package" step,
from CI run [35582371173](https://github.com/macrokinetic-ai/ponyabc-desktop/actions/runs/35582371173)
(2026-09-21), built from commit `4a19da2`.

| File | Contents |
| --- | --- |
| `winx64-msix-home.png` | Home screen |
| `winx64-msix-my-recordings.png` | DIY recordings manager (two-pane view) |
| `winx64-msix-book-library.png` | BOOK library (real, live catalog data) |
| `winx64-msix-firmware.png` | Firmware wizard's real "Prepare your pen" step — genuine Windows-only content, not the macOS "not available" message a non-Windows capture would show |
| `winx64-msix-settings.png` | Settings → About, correctly reading "Windows · x64 (Microsoft Store)" / `win-x64-msix` and "Installed from Microsoft Store — updates are handled automatically" |

All captured at 1280×860 @2x. These replace an earlier, temporary set of macOS-dev-build
captures (used only because no Windows machine was available yet) — that set is gone; this one is
the real thing.

**To recapture (e.g. after a UI change) from a real Windows build:**

```powershell
# after Add-AppxPackage-installing the built .appx (see tasks/windows-test-kit/), or from a plain
# npm run dist:win unpacked build:
node scripts/capture-screenshots.mjs "C:\path\to\PonyABC Desktop.exe" .\store-assets\screenshots --label=winx64
```
