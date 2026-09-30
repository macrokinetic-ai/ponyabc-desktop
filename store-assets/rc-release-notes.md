**Test build — not for customers.**

A release candidate of PonyABC Desktop {{VERSION}} for testing on a Windows PC. It is not signed
and it is not the Microsoft Store version. Please do not pass it to customers.

## Which build is this?

Settings → Version shows **{{VERSION}} ({{RC}}, {{COMMIT}})**. The Microsoft Store build shows a
plain **{{VERSION}}** — so anything in brackets after the version means you are holding a test
build.

## Installing it

`PonyABC-Desktop-v{{VERSION}}-winx64.exe` — double-click. No PowerShell, no certificate and no
administrator password. `READ-ME-FIRST.txt` has the same steps in plain English.

Windows will show **"Windows protected your PC"** because the build is unsigned: click
**More info**, then **Run anyway**. If the Microsoft Store version is installed, uninstall it
first — both are called PonyABC Desktop.

## What else is attached

| File | What it is |
|---|---|
| `PonyABC-Desktop-v{{VERSION}}-winx64.exe` | The installer to test |
| `PonyABC-Desktop-v{{VERSION}}-winx64.appx` | The Microsoft Store package built from the same commit, for the record |
| `*.sha256` | A checksum for each |
| `READ-ME-FIRST.txt` | Install steps in plain English |
| `PonyABC-Desktop-User-Guide-*.pdf` | The parent manual, English and 繁體中文 |
| `PonyABC-Quick-Start-A4-Fold-*.pdf` | The quick start that folds into the box, both languages |
| `whats-new-{{VERSION}}.md` | The Store "What's new" text for this version |
| `store-listing-{{VERSION}}.md` | The Store listing copy for this version |

Everything this version is, is on this page. Nothing important is kept only on one computer.

## What to look for

- Sync a book you **already have** — no additions — and check it ends with "All done!" and asks
  you to restart the pen.
- After that restart, how long the pen takes before it will play a book.
- Settings → Version: does it say **{{VERSION}} ({{RC}}, {{COMMIT}})**?
- Anything on screen that reads as though it were written for an engineer rather than a parent.

Settings → Support → **Export diagnostics** saves a file recording what the app did. Please send
it with anything you report.

---
Built from `{{COMMIT}}` by Windows CI run [{{RUN}}](https://github.com/macrokinetic-ai/ponyabc-desktop/actions/runs/{{RUN}}).
Nothing has been submitted to Partner Center.
