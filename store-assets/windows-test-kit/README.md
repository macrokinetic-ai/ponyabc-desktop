# PonyABC Desktop — Windows Store package test kit

This tests a **test build only** — a Microsoft Store-format package (`.appx`) signed with a
one-time test certificate, for verifying it on your own machine before real Store submission.
**Not for real customers.** Nothing here changes any Windows security setting (UAC, SmartScreen,
Defender) — only a certificate trust entry and one app install, both removed by the cleanup step.

## 1. Download

Get **`windows-appx.zip`** from the most recent successful run of *Build Windows EXE + Store
package*:

**https://github.com/macrokinetic-ai/ponyabc-desktop/actions/workflows/build-windows.yml**

Open that page, click the top (most recent) run with a green checkmark, scroll to the
**Artifacts** section near the bottom, and click **windows-appx** to download it. (Requires being
signed in to GitHub with access to this repo — that's a GitHub requirement for any workflow
download, not specific to this file. Each run's artifacts are available for 90 days.)

*Most recently verified against run [35557679933](https://github.com/macrokinetic-ai/ponyabc-desktop/actions/runs/35557679933) (2026-09-21) — if you were given that exact link directly, it still works, but always prefer the latest run from the link above once a newer one exists.*

## 2. Extract

Extract the zip into one folder. You should see 7 files together:

| File | What it is |
|---|---|
| `PonyABC-Desktop-v<version>-winx64.appx` | The app package |
| `PonyABC-Desktop-v<version>-winx64.appx.sha256` | Its checksum — `1-install.ps1` checks this automatically; there's no fixed value to compare by hand here since it changes with every build |
| `PonyABC-Desktop-test-cert.cer` | The matching test certificate (public part only) |
| `1-install.ps1` | Installs everything, checking the checksum and certificate first |
| `2-run-firmware-probe.ps1` | Runs the harmless UAC/firmware test (see step 6) |
| `3-cleanup.ps1` | Removes everything this kit added when you're done |
| `README.md` | This file |

## 3. Unblock the scripts (one time)

Windows marks every file extracted from a downloaded zip as "from the internet," and blocks
unsigned scripts specifically — not because of anything wrong with these files, just because
they came from a download. This unblocks only these 3 files, individually and by name; it does
**not** change any system-wide script-execution setting. In the same folder, in an ordinary
(non-administrator) PowerShell window:
```
Unblock-File -Path .\1-install.ps1
Unblock-File -Path .\2-run-firmware-probe.ps1
Unblock-File -Path .\3-cleanup.ps1
```

## 4. Install (one time)

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

## 5. Try the app normally

Open **PonyABC Desktop** from the Start menu like any other app. Check:

- It opens and shows the normal home screen (not blank, not an error).
- **Settings → About** reads **"Windows · x64 (Microsoft Store)"** — confirms it knows it's a
  Store install.
- **My Recordings** → "Select pen storage manually…" opens a real folder picker, and you can
  browse into a real folder.
- **BOOK Library** shows a real list of books (not an error) and you can download one.
- All three **Settings** tabs open, and the language dropdown works.

## 6. The firmware/UAC test

This never runs any real vendor tool and never touches a real pen — just a two-line harmless
script.

1. Open an **ORDINARY** PowerShell window — **not** "Run as administrator" this time. (This
   matters: running it elevated would skip the real prompt entirely — see Technical details.)
2. Go to the same folder, then run:
   ```
   .\2-run-firmware-probe.ps1
   ```
3. **A real Windows prompt should appear** asking to let the app make changes to your device.
   - Run it once and click **Yes**. This alone confirms the harmless elevation/logging mechanism
     works from a real, non-administrator launch — it is **not** a real firmware flash and not a
     full functional test of the app.
   - Run it again and click **No** — this is a separate, equally important check (does the app
     handle a declined prompt cleanly) that a single "Yes" run does not cover.
   Both are useful, valid results — the script tells you what happened either way.

## 7. When you're done

Back in an **Administrator** PowerShell window, in the same folder:
```
.\3-cleanup.ps1
```
This removes the test app and (only if it added one) the test certificate. Send me the output
from steps 4 and 6 — that's the evidence I need.

---

## Technical details

### Why `Unblock-File`, not a change to execution policy

Windows tags files extracted from a downloaded zip with a "Mark of the Web" (an NTFS alternate
data stream, `Zone.Identifier`), and PowerShell's default `RemoteSigned` execution policy refuses
to run an unsigned script carrying that mark — you'd see an error like "File ... cannot be loaded.
... is not digitally signed." `Unblock-File` removes that mark from one specific file; running it
on each of the 3 scripts by name (step 3) unblocks exactly those 3 files and nothing else on your
system. The alternative some guides suggest — `Set-ExecutionPolicy` — changes what PowerShell will
run **system-wide**, for every script, indefinitely, which is a much bigger and longer-lasting
change than this task needs. This kit never asks you to touch execution policy at all.

### What's actually been verified so far, and what hasn't

CI (GitHub Actions, a real Windows machine but with no interactive user) confirmed: the package's
manifest identity matches Partner Center exactly, Windows' own computed `PackageFamilyName`
matches exactly, and the process launches and stays running. A real notebook run of this kit then
confirmed, from a genuinely non-administrator session: the harmless elevation mechanism completes
successfully, its log is captured correctly, and the recovery marker file round-trips correctly.

**That notebook run is real evidence for exactly one thing: the harmless elevation/logging
mechanism, approved once, works end to end from a real non-admin launch.** It is not a real
firmware flash (it never touches a vendor tool or a pen), and it is not a complete functional test
of the app. Two things specifically remain undemonstrated by a single "click Yes and it worked"
run: **declining** the UAC prompt (see step 6's second run), and the **interrupted-launch/recovery**
behavior (see below) — both need their own separate pass.

### Why step 6 must run from a non-administrator window

If the PowerShell window running `2-run-firmware-probe.ps1` is itself elevated, the app it
launches inherits that elevation. When the app then tries to elevate the harmless stand-in script
internally, Windows sees the request is already satisfied and skips the prompt silently — the
exact same reason CI's own test never saw a prompt. `2-run-firmware-probe.ps1` checks for this
and refuses to run if it detects it's elevated, specifically to prevent an accidentally-meaningless
test.

### How package identity is confirmed, not assumed

`2-run-firmware-probe.ps1` calls the documented Win32 function `GetPackageFullName` against the
actual running process it just launched, and compares the FULL string it gets back against the
installed package's own real `PackageFullName` — not just "the API call returned success," which
would only prove *some* package identity was found, not that it's the right one. An earlier
version of this script had a real, confirmed bug here: the P/Invoke declaration was missing
`CharSet = Unicode`, so .NET defaulted to ANSI marshaling for a Win32 API that returns UTF-16 text
— the returned name was silently truncated to its first character (a real notebook run showed
"...running process: P" instead of the full package name). Fixed by declaring the P/Invoke call
with explicit Unicode marshaling.

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
