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
