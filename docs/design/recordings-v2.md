# Design — DIY recordings v2

**Status: approved and built in 0.3.17** (2026-09-29), including the three amendments below.
Kept as the record of what was decided and why. What shipped differs from this design in one
respect, noted under "Reassign": the vendor question was answered by Benny — four digits today,
five possible later, and never converted between the two.

## The problem, stated precisely

Saving recordings from the pen to the computer renames a file when a file of that name is
already in the destination folder: `0451.mp3` is written as `0451 (1).mp3`
(`resolveCollisionFreeName` in `src/main/services/copyService.ts`). The rename is the safe
choice on the way _out_ — nothing on the computer is overwritten — but it destroys the only
thing that identifies the recording, because **the pen identifies a recording solely by its
filename**. A restored `0451 (1).mp3` is not the recording that sticker plays. It is not
anything.

The app already knows this and can only warn about it after the fact:

> `summaryRenamedStickerHint`: "If you send these back to the pen later, use the original
> sticker filename shown above — not the renamed one."

Which puts the burden of a filesystem detail on a parent with a pen full of stickers. The
proposal below is the right direction. My evaluation is: **adopt it, with three changes** —
noted at each point and collected at the end.

## What the code actually establishes about pen filenames

This matters because one part of the proposal ("limited to valid numbers") depends on a rule
nobody has written down. Going only by what is in the repo:

| Question                                   | What the code says                                                                                                                                                                 |
| ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where do recordings live?                  | `<pen>/DIY/`, non-recursive. The pen root is valid only when **both** `BOOK` and `DIY` exist (`resolvePenRoot`).                                                                   |
| What counts as a recording?                | `isEligibleMp3FileName`: any `*.mp3` (case-insensitive) that is not a macOS `._` AppleDouble sidecar. **That is the entire rule in code.**                                         |
| Is there a numeric format?                 | **Nothing in the app validates one.** No four-digit check, no range, no zero-padding logic anywhere in `src/`.                                                                     |
| How does a file map to a sticker?          | By being that filename in `DIY/`. "Replace this sticker's audio" (`executeReplaceSticker`) is literally "overwrite this filename, keeping the name".                               |
| What is the observed shape?                | Four zero-padded digits — `0001.mp3`, `0451.mp3`, `0454.mp3` — throughout the tests and fixtures, which came from real pens.                                                       |
| Does the app know which numbers are valid? | **No, and it says so**: `transferPlan.toAddHint` — "This app can't confirm a new filename actually corresponds to a real sticker — check it against the sticker if you're unsure." |
| What format is the audio?                  | MPEG-1 **Layer II** as often as Layer III, despite the `.mp3` name (`tasks/lessons.md`). Preview already handles this via `mpg123-decoder`.                                        |

**Answered, 2026-09-29.** The filename is the sticker number. Every sticker printed so far is
four digits; future sheets may use five. **These are two different name spaces, not two
spellings of one** — `0451` and `00451` may be different stickers — so the app accepts four or
five digits and never converts between them, never pads and never trims. Anything it cannot
confirm it warns about rather than blocking: we still do not hold the list of valid numbers, and
a guessed upper bound would block a real sticker while looking, to the user, like a broken app.

## Evaluating the proposal

### 1. Backups as timestamped snapshot folders, original filenames, never renamed — **yes**

`RecordingBackups/2026-09-30-1412/0451.mp3`, and `0451.mp3` stays `0451.mp3`. This removes the
rename at its source: within a fresh folder there is no collision to resolve, so
`resolveCollisionFreeName` is never reached on the backup path. The folder name carries the
time, which is the information "(1)" was standing in for, and carries it in a form a person can
read.

Keep `resolveCollisionFreeName` for the free-form "Save selected to computer…" action, where
the user picks an arbitrary folder that may already contain anything. Two different jobs:
**snapshot** (structured, ours, restorable) and **export** (a copy for the user to do as they
like with). Conflating them is what produced this bug.

### 2. Skipping identical content by hash — **yes, but a snapshot must stay self-contained**

Skipping an unchanged file is right; re-copying 300 MB of unchanged recordings nightly is
waste. But if snapshot N simply omits a file because snapshot N−1 already has it, then
snapshot N is no longer a picture of the pen — and the day the user deletes an old folder to
free space, restores start failing in a way they cannot predict.

**Change 1: every snapshot lists every recording; only the bytes are shared.** Write a
`manifest.json` per snapshot holding, for each recording, its filename, size, mtime, SHA-256,
and where the bytes live (this snapshot, or the snapshot that first held them). Deduplicate the
bytes with a hard link when the filesystem allows one and a plain copy when it does not — on
Windows, NTFS supports hard links and exFAT/FAT32 does not, so the fallback is not theoretical.
Restore reads the manifest and never has to guess. A "verify backups" action can then also
report a snapshot whose referenced bytes have gone missing, instead of discovering it during a
restore.

Hashing cost is not a concern: recordings are small (seconds of Layer II audio), and the same
SHA-256 machinery already exists for BOOK verification.

### 3. Restore writes original names; on a clash: Replace / Keep pen's / Preview both — **yes**

This is the heart of it, and it is right. Never write `(1)` to the pen: a file the pen cannot
map to a sticker is not a lesser outcome, it is a useless one that also consumes space and
confuses the next listing.

Three notes:

- **Preview both is nearly free.** `useAudioPreview` + `AudioPreviewBar` already decode
  Layer I/II/III via `mpg123-decoder` and share one player. The conflict dialog needs two
  preview buttons, not a new audio stack.
- **Add a fourth outcome the proposal omits: identical.** When the backup copy and the pen copy
  have the same SHA-256, there is no conflict to resolve — say "already on the pen, unchanged"
  and skip it silently. Without this, restoring a 40-recording snapshot after changing one file
  asks the user 40 questions with the same answer.
- **Offer "apply to all remaining"** on the conflict dialog, as the BOOK screen already does
  with Replace/Skip. Its absence is what makes a per-file prompt unbearable at scale.

**Change 2: back up the pen's copy before replacing it during a restore.** The proposal
specifies auto-backup before _deleting_ from the pen (point 5) but not before _overwriting_
during a restore, and an overwrite destroys the pen's version just as completely. `safeWriteFile`
already backs up before replacing in `executeReplaceSticker` — the restore path should use the
same guarantee, which means this is consistency, not new machinery.

### 4. Restore copies, never moves — **yes, unconditionally**

A backup that a restore consumes is not a backup. This also makes a failed restore harmless:
the snapshot is still intact, so retrying is always safe.

### 5. No free-text rename on the pen — **yes, and this is the most important point**

A text box that writes a filename onto the pen is a way for a user to silently break a
recording, and no amount of warning text fixes that. Removing it is correct. Two halves:

**Friendly labels on the computer, as app metadata.** `0451.mp3` can be shown as "Grandma
reading page 12" while the file on disk stays `0451.mp3`. Store them in the app's own store
keyed by `{penVolumeLabel, fileName}` (and in each snapshot's `manifest.json`, so a label
survives with its backup). Never in the filename, never on the pen. This is the same pattern
as `friendlyName` for BOOK content, which is already how the app separates what a file is
called from what it is called _to a person_.

**"Reassign to sticker number" instead of rename.** The honest version, given that we do not
know the valid range:

- The field takes **digits only**, and the app formats them to the observed four-digit padded
  shape (`451` → `0451.mp3`). This alone prevents every malformed name a text box allows.
- If the number matches a file already on the pen, it is a conflict, handled by the same
  Replace / Keep / Preview dialog as a restore.
- If the number is not currently on the pen, warn — reusing the existing honest wording from
  `transferPlan.toAddHint` — that the app cannot confirm the number corresponds to a real
  sticker, and let the user proceed. **Warn, do not block**, until the vendor gives us a range.
- When the vendor confirms the range, the check tightens to a hard validation in one place.
  Build the validator as a single function now (`isPlausibleStickerNumber`) so that later
  change is one edit and one test, not a search.

Reassign is a rename **on the pen** (`fs.rename` within `DIY/`), not a copy — but back the file
up first, for the same reason as every other pen write.

### 6. Delete on both sides, with confirmation and auto-backup before a pen delete — **yes**

Delete from the computer: confirm, then delete. It is the user's own folder.

Delete from the pen: snapshot the file into the backup folder **first**, then delete, and say
in the confirmation where the copy went. If the backup fails, the delete does not happen — the
same rule `executeReplaceSticker` already applies to replacement (`reasonBackupFailed`: "Could
not back up the existing file, so nothing was replaced").

**Change 3: never offer "delete from both".** A single click that destroys the pen's copy and
its only backup is worth nothing to the user and can cost them a recording of a grandparent who
is no longer around. Deleting from the computer, if they want that, is a second deliberate act.

## Migrating existing "(1)" backups

Existing folders hold `0454.mp3` and `0454 (1).mp3` side by side, and the `(1)` file is
currently unusable. A one-time **Import old backups** action, offered when a folder containing
`(N)`-suffixed mp3s is chosen:

1. Scan the folder; group by the base name recovered from the `^(.*) \((\d+)\)$` suffix.
2. Hash every file. **Where the `(1)` copy is byte-identical to the base file, resolve it
   automatically** — it is a duplicate save, and it is the common case. Report the count.
3. Where the contents genuinely differ, **do not guess**: present the group as a small list —
   filename, size, modified date, a preview button each — and let the user decide which is the
   real `0454` (or keep several as separate snapshots by date). The mtimes came from the pen,
   so ordering is usually obvious to the person who made the recordings; it is never obvious to
   us.
4. Write the result as proper snapshot folders with a `manifest.json`, **without deleting the
   original folder**. Migration is additive; the user can delete the old folder themselves once
   they are satisfied.

What migration must never do: pick one file per group by mtime and discard the rest. The whole
reason this document exists is that a silent automatic choice destroyed information.

## UI sketches

### My Recordings — main screen

```
┌─ On the pen (DIY) ──────────────────┐  ┌─ On this computer ─────────────────┐
│ ☐ 0451.mp3   "Grandma, page 12"  ▶  │  │ Snapshot: 2026-09-30 14:12  [v]    │
│ ☐ 0452.mp3   —                   ▶  │  │ ☐ 0451.mp3  "Grandma, page 12"  ▶  │
│ ☐ 0454.mp3   "Dad — the dog"     ▶  │  │ ☐ 0452.mp3  —                   ▶  │
│                                     │  │ ☐ 0454.mp3  "Dad — the dog"     ▶  │
│ [Back up selected to computer]      │  │ [Restore selected to pen]          │
│ [Reassign sticker number…] [Delete] │  │ [Rename label…]        [Delete]    │
└─────────────────────────────────────┘  └────────────────────────────────────┘
  Labels are stored on this computer only. The pen always uses the numbered filename.
```

The footnote is load-bearing: it is the sentence that stops a user believing the label is on
the pen.

### Restore conflict

```
┌ This recording is already on the pen ───────────────────────────────┐
│ Sticker 0451                                                        │
│                                                                     │
│   From backup   2026-09-30 14:12   412 KB   ▶ Play                  │
│   On the pen    modified 10 Oct    391 KB   ▶ Play                  │
│                                                                     │
│ ( ) Replace the pen's copy  (the pen's copy is backed up first)      │
│ ( ) Keep the pen's copy                                             │
│                                     ☐ Do this for the remaining 7   │
│                            [Cancel]  [Continue]                     │
└─────────────────────────────────────────────────────────────────────┘
```

Neither option is preselected. Both are destructive-ish in opposite directions, and a default
here is a decision made on the user's behalf about which recording matters more.

### Reassign

```
┌ Reassign to a sticker number ───────────────────────────────────────┐
│ Currently: 0451.mp3    "Grandma, page 12"                           │
│ New sticker number:  [ 0462 ]        digits only                    │
│                                                                     │
│ ⚠ No recording is on this number yet. This app can't confirm 0462   │
│   is a real sticker — check the sticker before relying on it.       │
│                                                                     │
│ The label stays on this computer. The file on the pen is renamed    │
│ to 0462.mp3 (a backup is kept first).                               │
│                            [Cancel]  [Reassign]                     │
└─────────────────────────────────────────────────────────────────────┘
```

## Edge cases

| Case                                               | Behaviour                                                                                                                                                                   |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FAT is case-insensitive                            | `0451.MP3` and `0451.mp3` are the same file on the pen. Match case-insensitively everywhere; write using the pen's existing casing, exactly as the firmware preflight does. |
| macOS `._0451.mp3` sidecars                        | Already excluded by `isEligibleMp3FileName`; snapshots must exclude them too, or a restore puts junk on the pen.                                                            |
| Pen unplugged mid-restore                          | Existing behaviour: abort the batch, mark the rest `disconnected`, keep what succeeded. The snapshot is untouched, so a retry is safe.                                      |
| Pen full                                           | Plan the whole restore before writing (as `planTransferToPen` already does) and refuse up front rather than failing halfway.                                                |
| Two pens                                           | Key labels and snapshots by pen volume label + generation, as the BOOK verification index already does. A label from pen A must never appear against pen B's `0451`.        |
| Snapshot folder deleted by the user                | The manifest's referenced bytes are gone; report it clearly in the restore list instead of failing per-file mid-restore.                                                    |
| Hard links unavailable (exFAT/FAT32 backup target) | Fall back to a full copy. Correctness never depends on the link.                                                                                                            |
| Zero-byte or unreadable `.mp3`                     | Back it up as-is (it is the user's data), but flag it — a zero-byte recording usually means a failed pen write, and the user should know before they rely on it.            |
| Label with an emoji or CJK text                    | Fine: labels never touch the filesystem. This is a consequence of the design, and worth a test.                                                                             |
| `0451 (1).mp3` still on the **pen**                | Out of scope for migration, but list it and offer Reassign — it is the one case where the pen holds an unusable name.                                                       |

## Effort

|                                                                                   |           |
| --------------------------------------------------------------------------------- | --------- |
| Snapshot backup: manifest, hashing, hard-link dedupe + copy fallback              | ~1.5 days |
| Restore: plan, conflict dialog with preview, apply-to-all, identical-skip         | ~1.5 days |
| Labels store (+ display across both panes, per-pen keying)                        | ~1 day    |
| Reassign sticker number (replacing free-text rename) + `isPlausibleStickerNumber` | ~0.5 day  |
| Delete both sides, with pre-delete backup                                         | ~0.5 day  |
| Migration of `(N)` backups, including the manual-resolution list                  | ~1 day    |
| Tests (real temp dirs, as `firmwarePreflight.test.ts` does)                       | ~1.5 days |
| Manual/help text                                                                  | ~0.5 day  |

**~8 days.** None of it is on the expo's critical path.

Sequence, if it is split: the snapshot backup alone stops new unusable files from being created
and is worth shipping first. Restore + conflict resolution second, because it is what makes the
snapshots useful. Migration last — it only matters once the rest exists to migrate into.

## Summary of the three changes I would make to the proposal

1. **A snapshot must list every recording**, even when the bytes are deduplicated — manifest
   plus hard link, not omission. Otherwise deleting an old snapshot silently breaks newer ones.
2. **Back up the pen's copy before a restore overwrites it**, not only before a delete. An
   overwrite destroys it just as completely, and `safeWriteFile` already does this elsewhere.
3. **No "delete from both sides" in one action.** Two separate deliberate acts.

And one blocking dependency, for one feature only: **the vendor must confirm the sticker number
format and range** before "limited to valid numbers" can be enforced. Until then, format and
warn rather than block — and keep the check in one function so tightening it later is one edit.
