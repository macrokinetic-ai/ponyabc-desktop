# PonyABC — PM status

**Single source of truth. Update at the end of every task.**

Last updated: **2026-10-01 11:05 BST** · by Claude Code · after 0.3.17 went live on the Store

Covers both products, because the **1–4 Oct expo** needs both:
the **desktop app** (`ponyabc-desktop`, this repo) and the **registration site**
(`ponyabc-web` → `register.ponyabc.uk`).

Convention: ✅ verified by someone actually checking · ⚠️ needs attention ·
🛑 blocker · ❓ claimed but unverified. Never promote ❓ to ✅ without evidence.

---

## 1. Microsoft Store

|                                       |                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                                | ✅ **Live** since 2026-09-28 · **0.3.17 published 2026-10-01**                                                                                            |
| Published version                     | **APPX 0.3.17.0** — confirmed from Microsoft's own public catalogue, not from a claim: packed version `12886016000` decodes to `0.3.17.0`, last modified `2026-10-01T09:40Z` |
| Source commit                         | `17ecd69e88f03d1db3e4c951facf1f65cf5959a2`, tagged **`v0.3.17`**                                                                                          |
| Provenance                            | ✅ sha256 `49a9e2a2…e4c92b94` agrees three ways: the pack, the owner's submitted file, and the `.appx` downloaded back off the `v0.3.17` Release page    |
| Previous version                      | 0.3.16.0 from `f39df08`, tagged `v0.3.16`; sha256 `48ad39b2…506dbf4b` agreed four ways                                                                    |
| Store page                            | ✅ `https://apps.microsoft.com/detail/9P544XC6B609` → HTTP 200                                                                                           |
| Short link                            | ✅ `https://tinyurl.com/ponyabc-windows` → 302 → Store page (⚠️ routes via TinyURL's `redirect.viglink.com` affiliate hop)                               |
| Installed from the real Store and run | 🛑 **Never done, for any release.** Publishing is not proof the product works.                                                                           |

History worth not repeating: v0.3.15 was **rejected** under policy 10.1.1.11 (On Device
Tiles) for shipping default Electron tile art. Fixed in v0.3.16.

### Releases (owner decision, 2026-09-30) — `tasks/store-release-checklist.md`

Test builds now live on the repo's Releases page, members only:

| Release | What it is |
| --- | --- |
| **`v0.3.16`** | The Microsoft Store version, marked **Latest**, with the submitted `.appx` archived on it |
| **`v0.3.17-rc1`** | The first 0.3.17 test build, from `69e4412`, marked **Pre-release** — `.exe`, `.sha256`, `READ-ME-FIRST.txt` |
| `v0.3.17-rc2` … `rc3` | Further test builds. Pre-release. |
| `v0.3.17-rc4` | **Superseded.** Its Store installer lost its stamp before publishing, so Settings showed a plain `0.3.17` and a tester could not tell it from the Store version. Left as the record; not to be handed to anyone. |
| `v0.3.17-rc5` | From `dbfb545`. The build the owner tested on a real Windows PC. |
| `v0.3.17-rc6` | From `40290da`. Tested on real pens and approved. |
| `v0.3.17-rc7` | From `17ecd69`. The build that was submitted: the official product name and the button layout fix. Pre-release. |
| `v0.3.17-store-candidate` | The submission pack as it was assembled — the unsigned `.appx`, listing text, screenshots, notes. Pre-release, and never written to by a build again. |
| **`v0.3.17`** | ✅ **The Microsoft Store version, marked Latest** (2026-10-01), holding the exact submitted `.appx` and everything that went with it |

**A final `vX.Y.Z` Release is created only after Microsoft Store approval** — never before, so the
newest thing in the repository is never software nobody can install. `v0.3.17` was created on
2026-10-01, after the owner published. Each further test build is the next `rcN`, published the
same way. Nothing is submitted to Partner Center from here.

**Two builds from every commit (owner, 2026-09-30).** The **Store build** is the only one ever
submitted: no testing mode, no support tools, no developer switches, excluded at build time and
checked against the built bundle by a test. The **Internal build** is the same code plus testing
mode, with its own name, application id and banner, so it installs beside the Store app and
cannot be submitted by mistake — CI refuses an internal package carrying the Store identity.
Every rc Release carries both.

### rc7 is the build to submit, and the pre-flight passes on it (2026-10-01)

**`v0.3.17-rc7`** (`17ecd69`) carries the product's official name — 點讀錄音筆 / 点读录音笔 /
PonyABC P5 Intelligent Recording Reading Pen — in the app, the manual, the rebuilt PDFs, the Store
listing and the screenshots, and the button layout fix for every language at every window size.

The submission pack on **`v0.3.17-store-candidate`** is built from that same commit.
WACK: overall PASS, 0 warnings. Clean machine with no pen and no network: 12 of 12 steps, 0 errors,
clean uninstall. **Verdict: GO**, after the ten-minute look in `09-rc7-visual-check.md`.

**One scare worth remembering.** Creating the `v0.3.17-store-candidate` tag triggered the rc
workflows, whose attach steps overwrote the unsigned submission `.appx` with a test-signed one and
added installers, DMGs and a test certificate to that release. Fixed, and both workflows now
exclude that tag — but for a while the page the owner would submit from held the wrong package.

Still open: the five translated product names (es, fr, de, it, pt) are mine and need native review.

### 0.3.17 is live on the Microsoft Store (2026-10-01)

The owner pressed Publish. Microsoft's public catalogue now serves **0.3.17.0** for
`9P544XC6B609`, which is the only confirmation that matters and needs nobody to log in to
Partner Center.

It passed certification first time — the thing the whole pre-flight was for, after 0.3.15 was
rejected under 10.1.1.11 for default Electron tile art.

The permanent record is the **`v0.3.17`** Release: the submitted `.appx` and its checksum, the
Store-flavour installer, both manuals and quick starts, the listing text, "What's new", and
`04-notes-for-certification-SUBMITTED.md` — the exact 1,923 characters pasted into Partner
Center, so the archive and the submission say the same thing. The `.appx` was downloaded back off
the finished page and re-hashed: `49a9e2a2…e4c92b94`, the owner's figure.

**The near miss.** Creating `v0.3.17-store-candidate` had already triggered the rc workflows once,
whose attach steps overwrote the unsigned submission `.appx` with a test-signed one. The fix at the
time was a denylist naming that one tag — which did not include `v0.3.17`, so tagging the published
version would have overwritten the certified bytes the same way. Both workflows had to be disabled
by hand to cut the release safely. Now an allowlist: a build attaches to a `-rc` tag or to nothing,
and a plain `vX.Y.Z` page is written by a person (`fc6c0a9`).

The pack also lives in `~/Documents/AI-Reports/store-submission-0.3.17/`, and the Partner Center
steps in `tasks/store-release-checklist.md`.

Still open: **five** product-name translations are mine and have had no native review (es, fr, de,
it, pt). English and both Chinese forms came from the owner. They are on the Store now. The full
list of what 0.3.18 owes is `tasks/backlog-0.3.18.md` — the headline being that no Mac builds
shipped with 0.3.17, which breaks a standing rule.

### What rc6 fixes, from the owner's rc5 test on a real pen (2026-09-30)

**The book index was only being reset after a full sync.** Re-download, Add, Replace, Remove and
Restore each marked the pen as needing its book list rebuilt and then left both `.BIN` files on
the card, because the one line that deleted them lived in the sync screen and nothing else called
it. The owner found them still there after a Re-download. That decision now belongs to the main
process: any write outside a batch settles itself, a sync is one batch that settles once, and a
new writing path gets the rule without having to remember it. `Restore` marked nothing at all
before, so a restored book could have played from the wrong position.

**"Re-download" is now "Get a fresh copy and put it on my pen"**, with a line saying the pen is
written to and will need restarting. It always did write to the pen; the label read as though it
only touched this computer, which is what the owner reasonably expected of it.

**A backup said "20 recordings" and listed none** — the count was in the summary and the
recordings never left the main process. A backup's contents are now listed with tick boxes,
Select all, sizes and Play, and only what is ticked is put back. Backups also say why they exist,
so "Backup · 30 Sept 2026, 21:10" and "Automatic backup before replacing 0451" no longer look
like the same thing. Backing up is single-shot.

**Adding your own recordings is on the screen**, not inside Advanced tools: a real file picker,
new versus replace from the main process's own plan, both takes playable, and the pen's copies
kept in a backup a teacher can actually see — the old per-file copies went somewhere that never
appeared in the backups list.

**The pen's books and its free space are shown**, not hidden behind a disclosure, on BOOK and My
Recordings. **Every long action** says what it is doing and always ends with something; the
backup progress channel had existed all along with nothing listening to it.

**The Internal build has a Technical log**, so the `.BIN` files can be watched going without
taking the SD card out. The Store build has neither the panel nor a word of its wording.

**The pen cannot report its firmware version** — traced again through the vendor toolkit, where
every scripted path is write-only. The screen says so plainly and always, and adds the one thing
the app knows for certain: the version it installed itself, labelled as that and not as a reading
from the pen.

**Every version is stored on GitHub as the permanent record (owner, 2026-09-30).** Nothing
important may live only on the Mac mini. A candidate build dispatched with an `rc` input now
publishes its own Release automatically, carrying the installer, the Store package, a checksum
for each, the tester's README, the four manual PDFs and the Store what's-new and listing text.
Binaries are Release assets, never git history. The vendor firmware packages have their own
`firmware-archive` Release; the reports live in the private `macrokinetic-ai/ponyabc-reports`;
the 15.9 GB SD-card image stays on the external drive with its location and checksum recorded in
that repository's README.

Since rc2, a test build **stamps itself**: Settings → Version shows `0.3.17 (rc5, <commit>)`,
while the Store build submitted to Microsoft, built without the stamp, shows a plain `0.3.17`.
rc1 predates this, and **rc4 lost its stamp** — a later packaging step rebuilt the installer over
the checked one, so rc4's Store build also shows a plain `0.3.17`. rc4 is marked Superseded;
install **rc5**. Each installer's hash is now recorded when it is built and compared again
before publishing, so an installer nobody checked cannot reach the Releases page.

Every candidate publishes **two** installers: the Store build, which is what customers get, and
the Internal build, which carries testing mode and the support tools, says
`INTERNAL TEST BUILD — not for customers` across the top, and installs beside the Store app
under its own name and application id. Only the Store build is ever submitted, and CI refuses
to publish an internal package carrying the Store identity.

## 2. Current development

|            |                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Branch     | **`release/0.3.17`** @ `37ff4eb`, pushed                                                                                     |
| Version    | **0.3.17** → manifest **0.3.17.0** (electron-builder appends `.0`)                                                             |
| Windows CI | ✅ **success** (run 36643861464, 2026-09-30) — identity, tile assets, version, sidecar and EXE icon verified against the built package, plus a real install, launch and cleanup |
| `main`     | ✅ contains everything shipped (`v0.3.16` is an ancestor); Store pipeline merged in `9a9e240`                                  |
| Next       | ⏳ **Waiting on Benny's list of v0.3.17 changes.** Preparation is done; nothing blocks starting.                               |

### 🛑 0.3.17 is closed to new work (owner, 2026-09-29)

**From now until Benny reports real-pen test results after the expo (4 Oct), 0.3.17 accepts ONLY
fixes for problems found in real-pen testing.**

Not new features, not refactors, not "while I'm in here" improvements — including ones I might
think are good. Everything asked for is built; what is missing is evidence from hardware, and the
way to get that is to stop changing the thing being tested.

Since that line was drawn, the owner has twice directed further work inside 0.3.17 — the parent
manual with its screenshots (2026-09-29) and British English (2026-09-30). Both are recorded in
the table below. The freeze otherwise stands.

Anything else goes to 0.3.18. The open test plans are:

- `docs/test-plans/firmware-v126-real-pen.md` — the pre-flash cleanup, and the cancelled-upgrade
  restore.
- `docs/test-plans/book-index-rebuild.md` — rebuild timing, switching off mid-rebuild, a `0x03`
  book on V1.18, and section E (does the pen ignore a hidden root folder).

### 0.3.17 changes so far

| Phase               | What                                                                                                                                                                                                                                                                                                                                                                                                                        | State                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 0                   | `/source/` gitignored — vendor firmware zips and `.axb` content (48 MB + 288 MB) can never enter git history                                                                                                                                                                                                                                                                                                                | ✅                                                                                             |
| 1                   | **Pre-flash cleanup** before every firmware upgrade, plus **automatic restore** when the flash never starts (UAC declined, launch error). A file that cannot be backed up is not deleted.                                                                                                                                                                                                                                   | ✅ implemented, **not yet tested on a real pen** — `docs/test-plans/firmware-v126-real-pen.md` |
| 2 + C               | **Parent-facing BOOK screen**: six plain states replace sixteen technical ones, the technical detail moves under Advanced, and adding a book is one click from its row.                                                                                                                                                                                                                                                     | ✅                                                                                             |
| 3 / B               | **Recordings v2 built**: snapshot backups with a manifest and hard-link dedupe, restore under original filenames with a listen-to-both conflict dialog, per-side delete with a backup first, friendly labels, sticker reassign, and migration of old "(1)" backups.                                                                                                                                                         | ✅                                                                                             |
| A3/C3               | Every technical term removed from customer-facing screens in all 8 locales — no index filenames, no vendor tool, no checksum, no Task Manager.                                                                                                                                                                                                                                                                              | ✅                                                                                             |
| Wording             | zh-Hant rewritten in standard written Chinese (書面語) — colloquial Cantonese had reached shipped strings; zh-Hans matched for meaning. A test now fails if either comes back.                                                                                                                                                                                                                                              | ✅                                                                                             |
| Book index          | **The pen's book list is rebuilt after ANY sync that wrote a book** — added or replaced — and after a removal. The list is positional with no filenames, so a stale one makes the pen read the WRONG book aloud. One reset per batch, at the end, including a sync that stopped part-way after writing something. A sync that wrote nothing touches nothing. Owner decision 2026-09-30, replacing the same-name-replace exception; `update_requires_index_reset` no longer decides anything. Plus a self-heal prompt when a parent changes books outside the app.                    | ✅                                                                                             |
| Books policy        | **Parents add and update only — no parent-facing way to delete a book.** Books are governed by the PonyABC library; the removal service stays for self-heal and the coming sync.                                                                                                                                                                                                                                            | ✅                                                                                             |
| Slow USB            | The pen's USB is 1.x (**978 kB/s measured**): a 1.1 GB book is ~19 min. Time estimate before starting, live progress with time remaining, "don't unplug" notice, and the computer kept awake while writing.                                                                                                                                                                                                                 | ✅                                                                                             |
| Verification        | Writes are verified by **size + the first and last 8 MB** read back (~16 s), not a full read-back (~19 min on a 1.1 GB book). The full source hash is computed during the write, for free. Full read-back stays on demand per book under Advanced details; a resumed copy (future sync) still gets one.                                                                                                                     | ✅                                                                                             |
| BOOK screen         | **One button.** Pen status in plain words, a one-line summary, **Sync books**, a collapsed book list, everything technical under Advanced. Parents cannot choose or delete books. Sync adds what is missing and updates what differs, smallest first, decided from filenames and sizes only; retired books are never added but still updated; nothing is ever deleted. Space checked before the first byte, with a way out. | ✅                                                                                             |
| Manual & Store pack | **Parent manual** in `docs/manual/` (EN + 繁體中文, Markdown + print-ready PDF, with screenshots), **What's new** in all 8 languages, and `store-assets/0.3.17-readiness.md` listing the six things that still block submission.                                                                                                                                                                                            | ✅                                                                                             |
| Library sync        | Designed for 0.3.18 — `docs/design/library-sync.md`. Differential, parent-chosen, never deletes non-catalog books. Needs one real-pen check (§E of the index test plan) and ~1.5 days of web work after 4 Oct.                                                                                                                                                                                                              | 📄 design                                                                                      |
| Manual screenshots  | **Every parent-facing screen photographed**, EN + 繁體中文, 38 pictures, captured on Windows from the real app against a throwaway pen folder. Both manuals rebuilt around them. Six wording faults found by looking at the pictures, fixed in all 8 locales.                                                                                                                                                                   | ✅                                                                                             |
| British English     | **English is en-GB.** Every date and time goes through one formatter — "30/09/2026, 00:01", 24-hour, in the chosen UI language rather than the computer's. American spellings gone from the English strings, the manual and the Store text. A test fails on either coming back.                                                                                                                                             | ✅                                                                                             |

**Correction worth reading (A1).** The vendor's account of the firmware package is wrong on the
mechanism. The V1.26 zip contains **no** `1.BIN` or `BOOKFILE.BIN`, and `download.bat` does not
write them — it rebuilds `app.bin` and chains to a script that programs the pen's norflash over
USB/serial, never touching the BOOK folder. The pen gets new index files because **its own
firmware rebuilds them** (`app.bin` contains `storage/sd0/C/BOOK/1.bin` and the scan code). The
outcome is as the vendor described; the timing is not — they reappear after the pen reboots, not
when the PC tool finishes. Full evidence in `docs/vendor-notes.md`.

Gates: typecheck ✅, 696 unit tests ✅, build ✅, Windows CI package verification ✅.

## 3. Expo readiness — 1–4 Oct

### Ready ✅

- **Desktop app** live in the Store and installable by visitors.
- **Registration site** `register.ponyabc.uk` — health 200; registration path **fixed and
  deployed 2026-09-28** (it had been returning 500 for every customer since 13 Sep).
- **Public BOOK catalogue** — 37 books, served secret-free to the desktop app.
- **Serials** — 220 real serials in batch `2026-10-A`, all unused, check digits valid.
- **Sticker print files** — NIIMBOT B31 T30×15 mm, 440 labels (PEN + BOX per serial),
  in `ponyabc-web/exports/serials/2026-10-A/`.
- **Marketing consent** — recorded properly, and non-consenters are no longer pushed to
  Klaviyo.

### Decided 🟢

| Decision                                               | Detail                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The firmware row stays `inactive` through the expo** | No firmware is published to `ponyabc-web` until 0.3.17 is live in the Microsoft Store — an upgrade offered to 0.3.16 would run without the pre-flash cleanup and silently not take effect. **That gate is now open** (0.3.17 live 2026-10-01), but the row is still `inactive` and stays that way until the owner says otherwise: the Store rollout reaches machines over hours, not instantly, and every 0.3.16 still out there would be offered an upgrade it cannot apply. Recommendation: leave it until after the expo, 4 Oct. See ⚠️ below. |
| **v0.3.17 scope received**                             | Phases 0–2 implemented (see §2). Phase 3 (DIY recordings) is designed only, awaiting approval.                                                                                                                                                                                                                                  |

### Needs attention before the expo ⚠️

|                                                                       |                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 🛑 **Nobody has registered a pen through the live site in a browser** | The API is verified; the actual customer journey is not. Use the reserved test serial `PABC-PEN-2509-00001-5M`, then delete it. |
| 🛑 **Nobody has installed the app from the real Store**               | Do it on a clean Windows machine, ideally the expo laptop.                                                                      |
| ⚠️ **Admin dashboard never opened with a real login**                 | Needed if you want to show or check registrations at the expo.                                                                  |
| ⚠️ **Print and apply the stickers**                                   | Test-print one first, scan the QR, and confirm it validates against production.                                                 |
| ⚠️ **Firmware publishing is now unblocked — owner's call**            | 0.3.17 is live, so the condition for publishing firmware is met. Nothing has been changed. Doing it means 0.3.16 users get offered an upgrade that silently will not take. |

### Known behaviour, not a fault

- Registration requires a serial that **exists and is unused** — a made-up serial is
  rejected at the check digit before any database query.
- A pen can only be registered once; a second attempt returns 409.

## 4. Waiting on Benny

| #   | Item                                                                | Why it matters                                                                                                                                |
| --- | ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Save the age private key**, then tell me so I delete it from disk | `ponyabc-web/backups/age-key-PRIVATE.txt`. Verified never committed or pushed (630 blobs scanned). Without it, every backup is undecryptable. |
| 2   | **4 GitHub secrets** + reset the standby DB password                | Unblocks the nightly encrypted backup. Production is on Supabase **FREE** — no managed backups at all.                                        |
| 3   | **Cloudflare rate-limit rule** on `/api/public/*`                   | I have `zone (read)` only. Free plan allows one rule — do the `/download` one first (each `.axb` is ~214 MB).                                 |

## 5. Backlog (after 1 Oct)

- **Merge `feature/content-firmware`** — admin BOOK/content/i18n UI. **Do not merge as-is**:
  rebase onto `main` first, then land in three slices (admin BOOK/i18n base → Content UI →
  firmware lifecycle), each deployed and verified separately.
- **R2 has no backup** — ~7.9 GB of BOOK `.axb` files plus firmware. The database backup
  does not cover it.
- **Nothing subscribes opted-in registrants to a Klaviyo list.** Consent is collected
  correctly but nobody is actually emailable until the subscription call and a
  `KLAVIYO_LIST_ID` exist.
- **Desktop app hardcodes `https://register.ponyabc.uk`** (`src/main/ipc/book.ts:40`,
  `firmwareCatalog/httpClient.ts:7`). Should be config, and the API should be versioned.
- **Public distribution / Mac** — being designed in the upcoming Mac task. This repo
  deliberately publishes **no** GitHub Releases today.
- **Rename `ponyabc-unuse`** → the trailing "d" is missing, if it bothers you.

## 6. Known risks

| Risk                                                                                            | State                                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Production Supabase is FREE tier** — no managed backups, and it auto-pauses after 7 idle days | Uptime monitoring is in place; real traffic from 1 Oct keeps it awake. The nightly backup is built but **not running** (item 4.2).                                                        |
| **Schema and code shipping separately**                                                         | The cause of three separate production failures (`42703` registration, `query_failed` Klaviyo sync, `23514` BOOK saves). Rule: a migration and the code that depends on it ship together. |
| **Verifying sources instead of the built package**                                              | Caused the 10.1.1.11 rejection. CI now extracts the real `.appx` and fails on identity, version, missing assets, default art, stale checksum or wrong EXE icon.                           |
| **Green local build ≠ clean install builds**                                                    | A merge to `main` failed CI because `recharts`/`xlsx` were imported but undeclared; local builds passed on a warm `node_modules`. Always `npm ci` in a clean tree.                        |
| **OAuth token exposure**                                                                        | ✅ **Resolved** — Benny rotated the wrangler OAuth token on 2026-09-29. The exposed token is no longer valid.                                                                             |

## 7. Key facts

### Store / package identity — never change these

|                       |                                                                  |
| --------------------- | ---------------------------------------------------------------- |
| Product name          | PonyABC Desktop                                                  |
| Identity/Name         | `PonyABC.PonyABCDesktop`                                         |
| Identity/Publisher    | `CN=E476FCF5-1C63-4A56-85B1-DA5D642911B5`                        |
| PublisherDisplayName  | `PonyABC`                                                        |
| Package Family Name   | `PonyABC.PonyABCDesktop_f1jemggxjsyxg`                           |
| Store ID / Product ID | `9P544XC6B609`                                                   |
| Store URL             | `https://apps.microsoft.com/detail/9P544XC6B609`                 |
| Store protocol URL    | `ms-windows-store://pdp/?productid=9P544XC6B609`                 |
| MSA app ID            | `6b1147f4-47ec-464e-8ed1-47e07b957576`                           |
| Min OS (manifest)     | `10.0.14316.0` — ❓ declaration only, never tested on that build |

CI asserts Name, Publisher and PublisherDisplayName against the built package and fails
on any mismatch. `store-assets/PUBLISHED-STORE-VERSION` holds the live version so a build
cannot ship a version that is not higher.

### Company

|                       |                                                       |
| --------------------- | ----------------------------------------------------- |
| Legal name            | MACROKINETIC MEDIATECH LIMITED (company no. 16420643) |
| Registered office     | 128 City Road, London, EC1V 2NX                       |
| Public correspondence | 34 Redbourne Avenue, London, N3 2BS                   |
| Support email         | marketing@ponyabc.co.uk                               |
| Website               | https://www.ponyabc.co.uk                             |

### Infrastructure

|                                                         |                                                                                              |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Supabase **production**                                 | ref `wtryxixfzlkmmecxzahm`, dashboard name `ponyabc-pen-prod`, **FREE**                      |
| Supabase unused                                         | ref `mmdthrtypsqhxgcghhwd`, dashboard name `ponyabc-unuse`                                   |
| ⚠️ Identify Supabase projects **by ref, never by name** | The two names were attached to the wrong projects for three weeks and caused a real mix-up   |
| Cloudflare Worker                                       | `ponyabc-pen-registration`, account `a56fca29d9391ab25c05d856ee1d9cfd`                       |
| Live site                                               | `https://register.ponyabc.uk`                                                                |
| Privacy (desktop)                                       | `https://register.ponyabc.uk/privacy/desktop`                                                |
| R2 bucket                                               | `ponyabc-device-assets` — 37 books (7.935 GB) + 1 firmware, ✅ exactly matches the database  |
| GitHub                                                  | `macrokinetic-ai/ponyabc-desktop`, `macrokinetic-ai/ponyabc-pen-registration` (both private) |

### Where things live

|                      |                                                                     |
| -------------------- | ------------------------------------------------------------------- |
| Store handover       | `docs/store/PonyABC-Microsoft-Store-AI-Handover.md` (the only copy) |
| Release checklist    | `tasks/store-release-checklist.md`                                  |
| All AI reports       | `/Users/aiagent/Documents/AI-Reports/` + `INDEX.md`                 |
| Shipped v0.3.16 APPX | `store-assets/v0.3.16-tile-fix/`                                    |

## 8. Hard rules

1. **An AI never logs in to Partner Center, uploads, submits or publishes.** Benny does
   every Partner Center action. Nothing authorises otherwise.
2. **Never change the package identity** (§7).
3. **Don't touch firmware behaviour** unless explicitly asked.
4. **A new version must be strictly higher** than `PUBLISHED-STORE-VERSION`.
5. **Verify the built package, not the source assets.**
6. **Never print a credential**, and never read a raw credential file — use the CLI's own
   subcommands.
7. **No GitHub Releases from this private repo.** Tags are for provenance only.
