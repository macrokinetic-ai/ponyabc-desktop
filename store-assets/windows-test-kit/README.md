# PonyABC Desktop — Windows Store package test kit

This tests a **test build only** — a Microsoft Store-format package (`.appx`) signed with a
one-time test certificate, for verifying it on your own machine before real Store submission.
**Not for real customers.** Nothing here changes any Windows security setting (UAC, SmartScreen,
Defender) — only a certificate trust entry and one app install, both removed by the cleanup step.

## 1. Download

Get **`windows-appx.zip`** from this GitHub Actions run:

**https://github.com/macrokinetic-ai/ponyabc-desktop/actions/runs/35548857169**

Scroll to the **Artifacts** section near the bottom of that page and click **windows-appx** to
download it. (Requires being signed in to GitHub with access to this repo — that's a GitHub
requirement for any workflow download, not specific to this file. Available until 2026-12-20.)

## 2. Extract

Extract the zip into one folder. You should see 7 files together:

| File | What it is |
|---|---|
| `PonyABC-Desktop-v0.3.15-winx64.appx` | The app package (121,088,377 bytes) |
| `PonyABC-Desktop-v0.3.15-winx64.appx.sha256` | Its checksum (`a4d94debb0c05ab110f7fc1882036dd00596d3a3feadbb1b7815c22863f934a3`) |
| `PonyABC-Desktop-test-cert.cer` | The matching test certificate (public part only) |
| `1-install.ps1` | Installs everything, checking the checksum and certificate first |
| `2-run-firmware-probe.ps1` | Runs the harmless UAC/firmware test (see step 5) |
| `3-cleanup.ps1` | Removes everything this kit added when you're done |
| `README.md` | This file |

## 3. Install (one time)

1. Right-click **Start** → **Windows PowerShell (Admin)** (or search "PowerShell", right-click,
   "Run as administrator").
2. In that window, go to the folder you extracted (example: `cd C:\Users\you\Downloads\windows-appx`).
3. Run:
   ```
   .\1-install.ps1
   ```
4. Read the output — it tells you the certificate thumbprint it found or imported, and confirms
   the installed app's identity matches exactly what's registered with Microsoft. If anything
   says **FAILED** or **MISMATCH**, stop and let me know before continuing.
5. Close this Administrator window — you won't need it again except for cleanup.

## 4. Try the app normally

Open **PonyABC Desktop** from the Start menu like any other app. Check:

- It opens and shows the normal home screen (not blank, not an error).
- **Settings → About** reads **"Windows · x64 (Microsoft Store)"** — confirms it knows it's a
  Store install.
- **My Recordings** → "Select pen storage manually…" opens a real folder picker, and you can
  browse into a real folder.
- **BOOK Library** shows a real list of books (not an error) and you can download one.
- All three **Settings** tabs open, and the language dropdown works.

## 5. The firmware/UAC test

This never runs any real vendor tool and never touches a real pen — just a two-line harmless
script.

1. Open an **ORDINARY** PowerShell window — **not** "Run as administrator" this time. (This
   matters: running it elevated would skip the real prompt entirely — see Technical details.)
2. Go to the same folder, then run:
   ```
   .\2-run-firmware-probe.ps1
   ```
3. **A real Windows prompt should appear** asking to let the app make changes to your device.
   - Run it once and click **Yes**.
   - Run it again and click **No**.
   Both are useful, valid results — the script tells you what happened either way.

## 6. When you're done

Back in an **Administrator** PowerShell window, in the same folder:
```
.\3-cleanup.ps1
```
This removes the test app and (only if it added one) the test certificate. Send me the output
from steps 3 and 5 — that's the evidence I need.

---

## Technical details

### What CI already verified vs. what only this kit can check

CI (GitHub Actions, a real Windows machine but with no interactive user) already confirmed, with
real evidence: the package's manifest identity matches Partner Center exactly, Windows' own
computed `PackageFamilyName` matches exactly, the process launches and stays running, and the
elevation mechanism's file-visibility works end to end. What CI's own elevation attempt could
**not** prove: what a real UAC consent dialog looks like and does, because the CI service
account's elevation completed silently, with no prompt — likely because that account already had
elevation rights, not because the prompt doesn't matter. **That is exactly what step 5 above
tests**, and it's the one thing that genuinely needs your machine.

### Why step 5 must run from a non-administrator window

If the PowerShell window running `2-run-firmware-probe.ps1` is itself elevated, the app it
launches inherits that elevation. When the app then tries to elevate the harmless stand-in script
internally, Windows sees the request is already satisfied and skips the prompt silently — the
exact same reason CI's own test never saw a prompt. `2-run-firmware-probe.ps1` checks for this
and refuses to run if it detects it's elevated, specifically to prevent an accidentally-meaningless
test.

### How package identity is confirmed, not assumed

`2-run-firmware-probe.ps1` calls the documented Win32 function `GetPackageFullName` against the
actual running process it just launched. This function only succeeds for a process that has real
package identity; for an ordinary unpackaged process it fails with `APPMODEL_ERROR_NO_PACKAGE`.
The script reports the real package full name it gets back, not just "the exe lives under
WindowsApps."

### Certificate handling: exact thumbprint, not Subject

Multiple different certificates could share the same Subject (`CN=E476FCF5-...`) — a Subject is
just a name, not a unique identity. `1-install.ps1` computes and records the exact **thumbprint**
(a cryptographic fingerprint unique to that one certificate) of the `.cer` file, checks whether
that specific thumbprint is already trusted, and `3-cleanup.ps1` removes only that exact
thumbprint — never a different certificate that happens to share the same Subject, and never a
certificate that was already there before this kit touched anything.

### Interrupted-launch / recovery test — what "success" actually means

**Do not treat "the app reopens and looks fine" as proof recovery worked.** There are two
different, both-correct outcomes depending on exactly when you interrupt it, and the app must
behave differently in each:

**Case A — you force-close the app *before* clicking Yes/No on the UAC prompt.** Nothing ever
actually ran. On relaunch, the app should determine the interrupted attempt is definitely not
running anywhere, clear it silently, and behave completely normally — a new attempt should work
immediately with no message at all. This is the *only* case where "it just works normally" is the
correct, expected result.

**Case B — you force-close the app while the harmless script is still genuinely running** (use
`.\2-run-firmware-probe.ps1 -DelaySeconds 8`, click **Yes**, then force-close the "PonyABC
Desktop" process from Task Manager within those 8 seconds, while it's still counting down). This
is the meaningful test: on relaunch, going to the **Firmware** section should show a dedicated
screen — not the normal wizard — reading:

> **Previous upgrade not confirmed finished**
> A firmware upgrade from a previous session appears to still be running outside this app.
> Restarting this app is not evidence it has stopped. New firmware upgrades and BOOK/DIY pen
> writes stay blocked, and this app will not attempt to stop the other process itself.

with a **Check again** button, and no way to start a new firmware attempt or DIY/BOOK pen write
until it resolves. **If instead the app lets you start a new firmware attempt immediately in this
case, that is a bug** — it would mean a genuinely uncertain state got silently cleared, which is
exactly the failure mode the real safety mechanism exists to prevent. Please report which of
these two you actually see.
