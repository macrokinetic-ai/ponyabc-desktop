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

- [ ] 1. Fake-pen fixture script: BOOK/ + DIY/ + real mp3s, stale index, temp userData
      (settings.json with locale + pen path, recordingLabels.json, a RecordingBackups snapshot)
- [ ] 2. Demo data: add `nospace-unknown`; make a demo sync complete without network or writes
- [ ] 3. Demo firmware: package info from a real extracted package dir, canned outcome —
      never launches anything, never runs preflight, off unless the env var is set
- [ ] 4. Scenario-driven capture script (one Electron launch per state group, both locales)
- [ ] 5. Capture all 38, look at every one
- [ ] 6. Put the numbered screenshots into both manuals; regenerate both PDFs
- [ ] 7. Assemble ~/Documents/AI-Reports/manual-0.3.17/ (screenshots/, 2 PDFs,
      whats-new-0.3.17.md, index.md with a one-line description per shot in both languages)
- [ ] 8. Tests, typecheck, lint, build; report + INDEX.md

## Rules held

- Nothing is ever written to a real pen. The fixture is a folder this script creates.
- The demo paths are off unless an env var is set, and the firmware one additionally
  refuses to run in a packaged build.
- No firmware is published, nothing is submitted, no Partner Center.
