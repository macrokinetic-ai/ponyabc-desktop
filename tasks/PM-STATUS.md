# PonyABC — PM status

**Single source of truth. Update at the end of every task.**

Last updated: **2026-09-29 02:05 BST** · by Claude Code · after the v0.3.17 housekeeping task

Covers both products, because the **1–4 Oct expo** needs both:
the **desktop app** (`ponyabc-desktop`, this repo) and the **registration site**
(`ponyabc-web` → `register.ponyabc.uk`).

Convention: ✅ verified by someone actually checking · ⚠️ needs attention ·
🛑 blocker · ❓ claimed but unverified. Never promote ❓ to ✅ without evidence.

---

## 1. Microsoft Store

|                                       |                                                                                                                                                          |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                                | ✅ **Live** since 2026-09-28                                                                                                                             |
| Published version                     | **APPX 0.3.16.0**                                                                                                                                        |
| Source commit                         | `f39df08ad9b26e1768e1ff0dc9f1026198ef5c4e`, tagged **`v0.3.16`**                                                                                         |
| Provenance                            | ✅ CI run **35883786536** → artifact `windows-appx`, **byte-identical** to `store-assets/v0.3.16-tile-fix/`; sha256 `48ad39b2…506dbf4b` agrees four ways |
| Store page                            | ✅ `https://apps.microsoft.com/detail/9P544XC6B609` → HTTP 200                                                                                           |
| Short link                            | ✅ `https://tinyurl.com/ponyabc-windows` → 302 → Store page (⚠️ routes via TinyURL's `redirect.viglink.com` affiliate hop)                               |
| Installed from the real Store and run | 🛑 **Never done, for any release.** Publishing is not proof the product works.                                                                           |

History worth not repeating: v0.3.15 was **rejected** under policy 10.1.1.11 (On Device
Tiles) for shipping default Electron tile art. Fixed in v0.3.16.

## 2. Current development

|            |                                                                                                                                |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Branch     | **`release/0.3.17`** @ `dd007b5`, pushed                                                                                       |
| Version    | **0.3.17** → manifest **0.3.17.0** (electron-builder appends `.0`)                                                             |
| Windows CI | ✅ **success** (run 36502051892) — identity, tile assets, version, sidecar and EXE icon all verified against the built package |
| `main`     | ✅ contains everything shipped (`v0.3.16` is an ancestor); Store pipeline merged in `9a9e240`                                  |
| Next       | ⏳ **Waiting on Benny's list of v0.3.17 changes.** Preparation is done; nothing blocks starting.                               |

### 0.3.17 changes so far

| Phase        | What                                                                                                                                                                                                                                                                               | State                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 0            | `/source/` gitignored — vendor firmware zips and `.axb` content (48 MB + 288 MB) can never enter git history                                                                                                                                                                       | ✅                                                                                             |
| 1            | **Pre-flash cleanup** before every firmware upgrade, plus **automatic restore** when the flash never starts (UAC declined, launch error). A file that cannot be backed up is not deleted.                                                                                          | ✅ implemented, **not yet tested on a real pen** — `docs/test-plans/firmware-v126-real-pen.md` |
| 2 + C        | **Parent-facing BOOK screen**: six plain states replace sixteen technical ones, the technical detail moves under Advanced, and adding a book is one click from its row.                                                                                                            | ✅                                                                                             |
| 3 / B        | **Recordings v2 built**: snapshot backups with a manifest and hard-link dedupe, restore under original filenames with a listen-to-both conflict dialog, per-side delete with a backup first, friendly labels, sticker reassign, and migration of old "(1)" backups.                | ✅                                                                                             |
| A3/C3        | Every technical term removed from customer-facing screens in all 8 locales — no index filenames, no vendor tool, no checksum, no Task Manager.                                                                                                                                     | ✅                                                                                             |
| Wording      | zh-Hant rewritten in standard written Chinese (書面語) — colloquial Cantonese had reached shipped strings; zh-Hans matched for meaning. A test now fails if either comes back.                                                                                                     | ✅                                                                                             |
| Book index   | **The pen's book list is rebuilt after adding or removing a book** — the list is positional with no filenames, so a stale one makes the pen read the WRONG book aloud. Same-name replacements leave it alone. Plus a self-heal prompt when a parent changes books outside the app. | ✅                                                                                             |
| Books policy | **Parents add and update only — no parent-facing way to delete a book.** Books are governed by the PonyABC library; the removal service stays for self-heal and the coming sync.                                                                                                   | ✅                                                                                             |
| Slow USB     | The pen's USB is 1.x (**978 kB/s measured**): a 1.1 GB book is ~19 min. Time estimate before starting, live progress with time remaining, "don't unplug" notice, and the computer kept awake while writing.                                                                        | ✅                                                                                             |
| Library sync | Designed for 0.3.18 — `docs/design/library-sync.md`. Differential, parent-chosen, never deletes non-catalog books. Needs one real-pen check (§E of the index test plan) and ~1.5 days of web work after 4 Oct.                                                                     | 📄 design                                                                                      |

**Correction worth reading (A1).** The vendor's account of the firmware package is wrong on the
mechanism. The V1.26 zip contains **no** `1.BIN` or `BOOKFILE.BIN`, and `download.bat` does not
write them — it rebuilds `app.bin` and chains to a script that programs the pen's norflash over
USB/serial, never touching the BOOK folder. The pen gets new index files because **its own
firmware rebuilds them** (`app.bin` contains `storage/sd0/C/BOOK/1.bin` and the scan code). The
outcome is as the vendor described; the timing is not — they reappear after the pen reboots, not
when the PC tool finishes. Full evidence in `docs/vendor-notes.md`.

Gates: typecheck ✅, 653 unit tests ✅, build ✅, Windows CI package verification ✅.

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
| **The firmware row stays `inactive` through the expo** | No firmware is published to `ponyabc-web` until 0.3.17 is live in the Microsoft Store. Visitors will see "no update available", and that is the intended state — an upgrade offered to 0.3.16 would run without the pre-flash cleanup and silently not take effect. Sequence: 0.3.17 live in the Store → then publish firmware. |
| **v0.3.17 scope received**                             | Phases 0–2 implemented (see §2). Phase 3 (DIY recordings) is designed only, awaiting approval.                                                                                                                                                                                                                                  |

### Needs attention before the expo ⚠️

|                                                                       |                                                                                                                                 |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| 🛑 **Nobody has registered a pen through the live site in a browser** | The API is verified; the actual customer journey is not. Use the reserved test serial `PABC-PEN-2509-00001-5M`, then delete it. |
| 🛑 **Nobody has installed the app from the real Store**               | Do it on a clean Windows machine, ideally the expo laptop.                                                                      |
| ⚠️ **Admin dashboard never opened with a real login**                 | Needed if you want to show or check registrations at the expo.                                                                  |
| ⚠️ **Print and apply the stickers**                                   | Test-print one first, scan the QR, and confirm it validates against production.                                                 |

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
