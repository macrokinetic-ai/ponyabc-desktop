# rc6 — what the owner found testing rc5 on a real Windows PC

Owner decisions, 2026-09-30. Nothing is submitted to the Store; Partner Center is never opened.

## 4. Re-download leaves the pen's book list behind — THE BUG  (do first)

**Found it.** `Re-download` (`reinstall` in `bookInstall.ts`) **does write to the pen** —
`resolveCacheFile(…, force) → writeToPen`. So the rule applies to it, and it is being broken.

`markBookIndexStale()` is called correctly by every pen mutation and persisted immediately.
What is missing is the commit: `commitBookIndexReset()` is only ever reached from
`finishBookBatch()` in `BookLibraryScreen.runSync`. A single action — Re-download, Add,
Replace, Remove, Restore — marks the pen stale and then **nobody deletes the two .BIN files**,
so they sit there until the next time the pen is plugged in, with no restart prompt. Exactly
what the owner saw on the SD card.

The fix must not be "call it from the other four places too": the next path added would forget
again. The commit belongs at the boundary, in main.

- [x] `bookIndex.ts`: a batch session — `beginPenBookBatch()` / `endPenBookBatch()`, depth-counted
- [x] every pen-mutating IPC handler commits the reset itself when no batch is open, and returns
      what happened so the screen can ask for the restart
- [x] `runSync` opens one batch and closes it once, keeping "one reset per batch"
- [x] audit and cover every writing path: Sync, Re-download, Add, Replace, Remove, Restore,
      testing-mode installs
- [x] tests: each single action resets and prompts; a batch resets exactly once; a batch that
      wrote nothing resets nothing; an interrupted batch still heals

## RECORDINGS

- [x] 1. `reason` on the snapshot manifest (`manual` | `before-replace` | `before-delete` |
      `before-restore` | `migration`), with the thing it was protecting. Labels read
      "Backup — 30 September 2026, 21:10" vs "Automatic backup before replacing 0451".
- [x] 1. "Back up my recordings" single-shot: disabled while running, so a double click cannot
      make two backups.
- [x] 2. BUG: a backup says "20 recordings" and lists none — `SnapshotSummary` never carries the
      entries. Add a contents call; list sticker number, friendly name, size, Play; tick boxes
      and Select all; "Put selected recordings back on my pen" with one line of explanation;
      say plainly that each backup is its own snapshot and older ones are kept.
- [ ] 3. Promote "Add recordings from this computer" to the main screen: choose MP3 files
      (name = sticker number, 4 or 5 digits), show new vs REPLACE, Preview both, automatic
      backup of the pen's copy first, progress bar. Batch to many pens is 0.3.18 — design note.

## BOOKS

- [ ] 5. Progress or a spinner with what it is doing, and a clear Done or error, for every long
      action: Verify, Re-download, Sync, firmware download, backups, copying recordings.
      Buttons disabled while running.
- [x] 6. Pen storage on BOOK and My Recordings: total / used / free, books and recordings
      separately, in plain words.
- [x] 7. BOOK screen lists the books on the pen by default — name in the app's language, size,
      status — not behind "See book list".

## INTERNAL BUILD ONLY

- [x] 8. A Technical log panel listing each step as it happens: files deleted
      ("Deleted BOOK/1.BIN"), files written, index reset requested, firmware preflight,
      restores. Test that the Store build contains none of it.

## FIRMWARE

- [x] 9. Confirmed already true and now pinned: the online check is in BOTH builds (it was
      never behind `@internal`), and the by-hand picker is Internal-only — absent from the
      Store bundle by aliasing, checked against the built artefact.
- [x] 10. It cannot be read — traced again: every scripted path in the vendor toolkit is
      write-only, and `penFirmwareVersionVerified` is a literal `false` for that reason. The
      screen now says so **always** (it used to say it only when the catalogue had answered),
      and adds the one thing the app knows for certain: the version it installed itself, and
      when — labelled as that and not as a reading from the pen.

## TEST PLAN

- [ ] Record the owner's measurement as test A's result: the pen rebuilt both .BIN files within
      a few seconds of power-on after deletion.

## GATES

- [ ] 8 locales, UK English, no technical words in the Store build
- [ ] typecheck, vitest, build, Windows CI both builds
- [ ] publish `v0.3.17-rc6` (pre-release, both builds)
- [ ] `tasks/PM-STATUS.md`
- [ ] report, INDEX, push to ponyabc-reports
