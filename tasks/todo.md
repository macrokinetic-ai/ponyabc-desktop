# v0.3.17 — parent-manual screenshots (both languages)

Capture every parent-facing screen in English and 繁體中文, number them in manual
order, put them in the manual, and assemble one hand-over folder.

## The 19 screens (× 2 languages = 38 files)

| # | Screen | How the state is reached |
|---|---|---|
| 01 | Home — pen connected | real fake pen folder |
| 02 | Home — no pen | no pen folder |
| 03 | Books — summary (some to add/update) | demo `summary` |
| 04 | Books — everything up to date | demo `uptodate` |
| 05 | Books — not enough space | demo `nospace` + press Sync |
| 06 | Books — couldn't check the space | demo `nospace-unknown` + press Sync |
| 07 | Books — sync finished, restart the pen | demo `summary` + press Sync (demo writes nothing) |
| 08 | Books — fix my pen's book list | real stale book index on the fake pen |
| 09 | Books — what the words mean (legend open) | open the `<details>` |
| 10 | My Recordings — list | real recordings on the fake pen |
| 11 | My Recordings — backup finished | real backup of the fake pen |
| 12 | My Recordings — restore (Replace / Keep / Preview) | real snapshot, real restore plan |
| 13 | My Recordings — change the sticker number | open the panel |
| 14 | My Recordings — add a label | open the label editor |
| 15 | Firmware — step 1 (prepare) | nav only |
| 16 | Firmware — step 2 (choose the update) | click Next |
| 17 | Firmware — step 3 (confirm) | demo package pointed at the real V1.26 folder |
| 18 | Firmware — finished | demo outcome `success` |
| 19 | Firmware — the update didn't start | demo outcome `not-started` |

## Work

- [x] 1. Fake-pen fixture script: BOOK/ + DIY/ + real mp3s, stale index, temp userData
      (settings.json with locale + pen path, recordingLabels.json, a RecordingBackups snapshot)
- [x] 2. Demo data: add `nospace-unknown`; make a demo sync complete without network or writes
- [x] 3. Demo firmware: package info from a real extracted package dir, canned outcome —
      never launches anything, never runs preflight, off unless the env var is set
- [x] 4. Scenario-driven capture script (one Electron launch per state group, both locales)
- [x] 5. Capture all 38, look at every one
- [x] 6. Put the numbered screenshots into both manuals; regenerate both PDFs
- [x] 7. Assemble ~/Documents/AI-Reports/manual-0.3.17/ (screenshots/, 2 PDFs,
      whats-new-0.3.17.md, index.md with a one-line description per shot in both languages)
- [x] 8. Tests, typecheck, lint, build; report + INDEX.md

## Rules held

- Nothing is ever written to a real pen. The fixture is a folder this script creates.
- The demo paths are off unless an env var is set, and the firmware one additionally
  refuses to run in a packaged build.
- No firmware is published, nothing is submitted, no Partner Center.

## Review

All nineteen screens were captured in both languages — 38 pictures, none missing. They were
taken on Windows, in the repo's own Windows job, because the firmware wizard renders on Windows
only: on macOS that screen is a single "this needs Windows" banner, so five of the nineteen
exist nowhere else.

The app did real work in every shot. `scripts/make-demo-pen.mjs` builds a throwaway pen folder
and `PONYABC_TEST_VOLUMES_ROOT` points the app's own volume scan at it, so a real pen plugged
into the same machine is invisible to the app while a capture runs. The recordings are really
backed up, really relabelled, really restored, and the "fix my pen's book list" prompt appears
because the fixture's index really is one record short.

Two screens cannot be produced that way, and both are handled in the demo layer only:

- A sync has no catalogue to download from, so a demo sync reports the completion and the
  "restart your pen" notice the real one produces.
- The firmware result screens would mean flashing a real pen to take a picture.
  `demoFirmware.ts` hands the wizard an outcome directly: it launches nothing, runs no
  preflight deletion, touches no disk, and refuses outright in a packaged build — pinned by
  `tests/unit/demoFirmware.test.ts`.

Photographing the screens found six wording faults that reading the code had not, all now
fixed in all eight languages. They are listed in the report.

One picture is still missing and can only be taken by hand: a real pen being written to, for
section 3 of both manuals. The placeholder is still marked in both.

Verified: typecheck clean, 674 tests pass, build clean, and the capture itself reports
38 captured / 0 failed / 0 skipped.
