# Vendor notes — PonyABC P5 pen (JieLi / AC696x "BR25")

Behaviour of the pen and the vendor toolchain that we had to discover ourselves.
Everything here was established from the vendor directly or from testing on a real pen —
not inferred from documentation, because in each case the documentation did not say it.

---

## Firmware upgrades require deleting two files first

**Rule:** before **every** firmware upgrade, delete these two files from the root of the
pen's `BOOK` directory:

```
1.BIN
BOOKFILE.BIN
```

**Why it matters:** without the deletion the upgrade _appears_ to run — the vendor tool
reports success — but the new firmware does not take effect. With the deletion, it works.

- **Confirmed by:** the vendor, and verified by Benny on a real pen (recorded 2026-09-30).
- **The vendor's documentation does not mention this.** It is not in the toolkit README or
  the `download.bat` comments. We found it because upgrades were silently not taking.
- **Applies to every firmware release, not just V1.26.** It is a property of the pen, not
  of a particular firmware build.

**What these files appear to be:** a content index the pen builds from the `.axb` books.
The working theory is that the old firmware leaves a stale index that the new firmware
will not rebuild while it exists. That is an inference from the observed behaviour — the
vendor did not explain the mechanism, so do not state it as fact to customers.

### Where the NEW `1.BIN` / `BOOKFILE.BIN` come from — verified 2026-09-29

The vendor's account is that "the firmware package contains the new `1.BIN` and `BOOKFILE.BIN`,
and `download.bat` generates/copies them into BOOK". **The outcome is right and the mechanism is
not**, which matters for what we can promise the user and when.

Checked directly against `pen-AC6966-V1.26-…-SD.zip` (SHA-256
`14cc6ca6e86badc95c0f96f3b55d5f836c83461d3d37870aa18486efa2ad6ec6`):

- **No entry in the package is named `1.BIN` or `BOOKFILE.BIN`**, at any depth, in any casing —
  464 payload files searched by name, and every text file searched by content.
- **`download.bat` is a _build_ script, not a flasher.** It runs `llvm-objcopy` over `sdk.elf` to
  regenerate `text.bin`/`data.bin`/the overlays, concatenates them into `app.bin`, copies that
  into `soundbox\standard\`, and chains to `soundbox\standard\download.bat`.
- That second script is the real one, and it runs
  `isd_download.exe -tonorflash -dev br25 … -uboot uboot.boot -app app.bin …`. It programs the
  pen's **norflash over USB/serial**. It never mounts, opens or writes the pen's mass-storage
  `BOOK` folder at all.

So where do the new files come from? **The firmware itself writes them, on the pen, at runtime.**
`app.bin` contains the literal paths

```
storage/sd0/C/BOOK/1.bin
storage/sd0/C/BOOK/bookfile.bin
```

alongside the symbols that build them — `ScanDirAndBuildBookFileList`, `InitBookFile`,
`CheckBookFile`, `FindFileByBookFileList` (from `sdk.map` / `symbol_tbl.txt`). The pen scans its
own `BOOK` directory and rebuilds the index there.

**What follows from this, and why it is worth the paragraph:**

1. The two files reappear **after the pen boots on the new firmware and rescans**, not at the
   moment the PC tool finishes. Anyone looking in `BOOK\` while the pen is still plugged in as a
   USB drive right after flashing should expect them to be **missing**, and that is correct.
2. Nothing on the PC side can put them back. If an upgrade is abandoned **before** the flash
   starts, the pen is still on the old firmware with its old books, and only the copies we took
   ourselves can restore its index — hence the preflight backup below.
3. It also explains the original bug cleanly: the old index is a file the _old_ firmware built,
   and the new firmware will not rebuild it while a file is already sitting there.

### What this does NOT apply to

**Updating `.axb` books does not need this, and must never do it.** A book update that
deleted the content index would be destructive for no reason. The preflight is wired into
the firmware path only.

### How the app implements it

`src/main/services/firmwarePreflight.ts`, called from `startFirmwareUpgrade` in
`src/main/ipc/firmware.ts` **before** the work directory is created, before the recovery
marker is written, and before anything is launched.

- Confirms the target really is a PonyABC pen (`resolvePenRoot` → `BOOK` _and_ `DIY` must
  exist) before deleting anything. Deleting `BOOK/1.BIN` from an arbitrary USB stick
  because the user picked the wrong drive is the worst outcome available here.
- Matches **only** those two names, **only** in the `BOOK` root, **never** recursively,
  case-insensitively (FAT), deleting under the pen's own casing.
- A file that is already absent is fine and does not stop the upgrade.
- **A file that is present but cannot be deleted aborts the upgrade before flashing.**
- Each deletion is recorded in the firmware session log (stage `preflight`) and in the
  capped diagnostics, so a later "the upgrade didn't take" report can be checked against
  whether the deletion actually happened.
- The list is a parameter, not a hardcoded constant, so a future release can carry its own
  steps from the catalogue — see `docs/design/firmware-preflight-metadata.md`.

Tests: `tests/unit/firmwarePreflight.test.ts` — present, absent, deletion fails, wrong
drive, case-insensitivity, non-recursion, and that neighbouring books/recordings survive.

### If a customer upgrades outside the app

Shown in the app on the firmware confirm step, as a collapsed note
(`faq.manualUpgradeWarning*` in `FirmwareScreen.tsx`): anyone running the vendor's tool
directly must delete those two files first, or the upgrade will not take. This app is the only
place that rule is written down for a customer.

### Verifying it on a real pen

`docs/test-plans/firmware-v126-real-pen.md`. Two things in it are still unanswered and only a
real pen can answer them: whether the pen recreates `1.BIN`/`BOOKFILE.BIN` after the upgrade
and first boot, and whether books installed before the upgrade still play afterwards.

---

## The pen's USB is 1.x — about 1 MB/s

Measured 2026-09-29: a full-card `dd` image ran at **978 kB/s**.

|                                     |                      |
| ----------------------------------- | -------------------- |
| A 1.1 GB book                       | ~19 minutes to write |
| Reading that book back to verify it | another ~19 minutes  |
| Re-copying a full 16 GB card        | over 4½ hours        |

This is not a detail — it is the constraint every content feature is designed around. Never
re-copy or read back a whole book unless there is no alternative. Since 0.3.17 a write is
verified by its size plus the first and last 8 MB (~16 seconds), not a full read-back; the full
check stays available per book under Advanced details.

---

## The book index: `BOOKFILE.BIN` and `1.BIN`

**Settled on real pens, 2026-09-29**, by comparing a pen's index before and after adding a book.

`BOOK/BOOKFILE.BIN` is written **by the pen's own firmware, on power-on**, from the `.axb` files
it finds in `BOOK/`. The PC-side upgrade never creates it: `download.bat` is a build script and
`isd_download.exe -tonorflash` programs the NOR flash, never the card.

### Format

A flat array of **44-byte records, one per `.axb`** — measured: 1,628 bytes for 37 books, and
adding `phonics card.axb` produced 38 records with the first 37 byte-identical and in the same
order, the new book appended as #38.

```
01 01 02 01 | ff ×8      | 68 06 00 00 | 27 07 00 00 | ff ×24
^^ ^^ ^^                    OID start     OID end
|  |  record type: 0x02 for the 37 existing books, 0x03 for phonics card
|  book index, 1-based, incrementing
```

**There are no filenames in it.** A book is identified purely by its **position**. Everything
important follows from that:

- **Remove a book** and every later book shifts down one position → the pen plays **the wrong
  book's audio**. Nothing looks broken; it just reads the wrong story to a child.
- **Add a book** and it sits past the end of the index → silent.
- **Replace a book under the same filename** → same position, same order, index still correct.
  Benny verified this on a real pen.

`BOOK/1.BIN` is a **zero-byte marker**. While the pair exists the pen trusts the index; delete
both and it rescans and rebuilds on the next power-on.

The index counts `.axb` only — a card with 37 `.axb` **plus** `english.dic` has exactly 37
records. The firmware scans `.axb .ax1 .smp .dic .bnf` (from `app.bin`), so `.dic` is read for
its own purpose and is not a book.

The record type byte differing (`0x03` for `phonics card`) may mean a newer book format that
needs V1.26. **Not yet tested** — see `docs/test-plans/book-index-rebuild.md` section D.

### The owner's rule (decided by Benny, 2026-09-30 — replaces the 2026-09-29 version)

```
wrote any book (added OR replaced under the same name) -> delete 1.BIN and BOOKFILE.BIN
removed a book                                         -> delete 1.BIN and BOOKFILE.BIN
wrote nothing                                          -> touch nothing
a batch that wrote anything -> delete once, at the end, even if it stopped part-way
```

**What changed, and why.** The 2026-09-29 rule left the index alone for a same-name replacement,
on the reasoning that no book moves position. That is true of the positions. It is not
dependable of the contents — a re-issued edition can keep its filename and change what is inside
it, including its OID range — and when it is wrong the pen reads the **wrong book aloud** with
nothing visibly broken. The old rule also had to be explained to parents ("no restart needed if
you only updated a book"), which is a sentence nobody should have to read. One rule, one ending.

Implemented in `src/main/services/bookIndexReset.ts` and `src/main/ipc/bookIndex.ts`, reusing the
firmware preflight's guards. The decision itself is one line in `runInstallAction`
(`src/main/ipc/book.ts`): any `completed` write marks the index stale. The deletion is the
**last** step of a batch, after every book operation has finished — doing it first would leave
the pen with neither a valid index nor the books the new one should describe. The "this pen owes
a reset" flag is persisted the moment the first write or removal succeeds, so a batch that is
interrupted, or that stops because the card filled up, still heals on the next connection.

The catalogue's per-book `update_requires_index_reset` flag is now redundant for this decision.
It is still parsed (`bookCatalog/httpClient.ts`) and still harmless; nothing reads it to decide
anything. See `docs/design/book-index-reset-catalog.md`.

---

## Firmware package layout changed between V1.18 and V1.26

|                                  | V1.18 (`tools.zip`) | V1.26                                                                                                                                  |
| -------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Top-level folder                 | `tools/`            | `pen-AC6966-V1.26-20260924-vddio-3400-Rectail-500-pause-bnf-ble-SD/`                                                                   |
| Extra entries                    | none                | `__MACOSX/` (465 resource-fork files — zipped on a Mac)                                                                                |
| Payload files                    | 464                 | 464 — **identical names, zero differences**                                                                                            |
| Files differing in content       | —                   | **19** (`app.bin` 468,118 → 470,322 bytes, `sdk.elf`, the `.bc`/`.o` build artifacts, `data.bin`, and the `soundbox/standard/` copies) |
| Windows tooling (`.exe`, `.bat`) | —                   | **unchanged**                                                                                                                          |

Two consequences:

1. **Never hardcode `tools/`.** `extractFirmwarePackage` already auto-detects the single
   top-level folder, so the rename is handled.
2. **`__MACOSX/` is harmless only because `extract-zip` silently skips those entries.**
   The root detection accepts exactly one top-level directory; if the library ever stopped
   filtering, V1.26-shaped packages would fail as `invalid-package-layout`. Pinned by a
   test in `tests/unit/firmwareExtract.test.ts` so that breaks in CI, not on a pen.

Ask the vendor to stop zipping on a Mac, or strip `__MACOSX/` before publishing — it
doubles the entry count and the download size for nothing.

---

## Vendor tool output is GBK/CP936, not UTF-8

Decoding it as UTF-8 produces mojibake and the success signal is not recognised. Handled
in `src/main/services/logEncoding.ts`, which always decodes the **full accumulated**
buffer rather than incremental chunks — a multi-byte character split across two reads is
otherwise corrupted.

---

## `GetPackageFullName` P/Invoke must be Unicode

Found during real-notebook testing of the MSIX probe: the ANSI marshaling truncated the
package name to `P`, because the UTF-16 string's first null byte ended it. Fixed by
declaring the call as Unicode and comparing the full `PackageFullName`.
