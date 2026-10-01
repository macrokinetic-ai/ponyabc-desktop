# Installing the v0.3.17 test build on a test PC

**Build:** `0.3.17` from `release/0.3.17`, commit `c3db0de`, CI run
[36618366214](https://github.com/macrokinetic-ai/ponyabc-desktop/actions/runs/36618366214) —
the latest green run.

| File                                                              | SHA-256                                                            |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `PonyABC-Desktop-v0.3.17-winx64.appx` (Store-format test package) | `52150d9500a1205f7b83a65f8600e9f68388def15b530cd1047c62b6ef94b5e3` |
| `PonyABC-Desktop-v0.3.17-winx64.exe` (ordinary installer)         | `ac6587ee522820d25e7173095679a122c0b48c8a62ed11cd410032a4baf2f99f` |

Both were downloaded from that run and re-checked against their `.sha256` sidecars — they match.

---

## ⚠️ Read this before you pick a machine

**Do not use the expo demo laptop.** Use a spare Windows PC.

There are two builds, and they behave very differently:

|                                         | **The `.exe` — recommended** | **The `.appx` test package** |
| --------------------------------------- | ---------------------------- | ---------------------------- |
| Can sit alongside the Store v0.3.16?    | **Yes**                      | **No**                       |
| Needs the Store version uninstalled?    | No                           | **Yes**                      |
| Needs an administrator PowerShell?      | No                           | Yes                          |
| Shares settings with the Store version? | No — separate                | No — separate                |

**Why the `.appx` cannot sit alongside it:** it carries the _same_ Store identity
(`PonyABC.PonyABCDesktop`, publisher `CN=E476FCF5-…`) but is signed with a one-off test
certificate instead of Microsoft's. To Windows that is the same app with a different signature,
so it refuses to install until the Store copy is removed.

**So: use the `.exe` unless you specifically need to test the Store packaging.** It installs
beside the Store version, needs no certificate, no admin, and no cleanup script. Everything in
the testing session guide works identically in it — the only thing it cannot prove is that the
_Store package_ installs, which CI already checks on every build.

---

## Option A — the ordinary installer (`.exe`). Recommended.

1. On the test PC, open
   [the CI run](https://github.com/macrokinetic-ai/ponyabc-desktop/actions/runs/36618366214),
   scroll to **Artifacts**, and download **windows-installer**. (You need to be signed in to
   GitHub — that is GitHub's rule for any workflow artifact.)
2. Unzip it. You get `PonyABC-Desktop-v0.3.17-winx64.exe`.
3. Double-click the `.exe`.
4. Windows will likely show **"Windows protected your PC"** (SmartScreen). This is expected —
   the file is not signed with a paid code-signing certificate. Click **More info** →
   **Run anyway**.
5. Choose **Just me** if asked. It installs for your user only, no administrator needed.
6. It starts automatically when finished. The title bar and **Settings** both show **0.3.17**.

**Where its data lives:** `C:\Users\<you>\AppData\Roaming\PonyABC Desktop`
(paste `%APPDATA%\PonyABC Desktop` into the File Explorer address bar).

**To remove it afterwards:** Settings → Apps → Installed apps → **PonyABC Desktop** →
Uninstall. Pick the one whose source is **not** "Microsoft Store".

Your Store v0.3.16 is untouched the whole time.

## Option B — the Store-format test package (`.appx`)

Only if you want to test the actual Store packaging.

1. **Uninstall the Store version first:** Settings → Apps → Installed apps → **PonyABC
   Desktop** (source: Microsoft Store) → Uninstall.
2. Download the **windows-appx** artifact from the same CI run and unzip it — 7 files together
   in one folder.
3. Follow `README.md` in that folder. In short: unblock the three scripts, then run
   `.\1-install.ps1` from an **administrator** PowerShell in that folder.
4. When you have finished testing, run `.\3-cleanup.ps1` from the same admin PowerShell. It
   removes the app and the test certificate it added.

**Where its data lives:**
`C:\Users\<you>\AppData\Local\Packages\PonyABC.PonyABCDesktop_<random>\LocalCache\Roaming\PonyABC Desktop`

That is a different folder from Option A's, so the two builds never see each other's settings,
recordings backups or diagnostics.

---

## Going back to v0.3.16

| You installed | To go back                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| The `.exe`    | Uninstall it (above). The Store version is still there and still works.                                |
| The `.appx`   | Run `.\3-cleanup.ps1`, then reinstall from the Store: <https://apps.microsoft.com/detail/9P544XC6B609> |

**Your pen is not affected by uninstalling either build.** Books, recordings and firmware live on
the pen itself. The only things that live on the PC are settings, the download cache and the
recordings backups — and those are per-build, as above.

If you want to keep the recordings backups a test build made, copy that `PonyABC Desktop` folder
somewhere else before uninstalling.
