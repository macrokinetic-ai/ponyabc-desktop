import fs from 'node:fs';
import path from 'node:path';
import { isEligibleMp3FileName } from './pathSecurity';
import { createSnapshot, readManifest, MANIFEST_FILENAME, type SnapshotManifest } from './recordingSnapshot';

/**
 * Deleting recordings, renaming them to a different sticker, and the friendly labels.
 *
 * Two rules run through all of it:
 *
 * - **Nothing leaves the pen without a backup first.** A DIY recording is often the only copy
 *   of a child's grandparent reading to them. If the backup cannot be taken, the delete does
 *   not happen.
 * - **No free-text renaming on the pen, ever.** The filename IS the sticker number, so a text
 *   box over it is a way to make a recording unplayable with a typo. A recording is moved to a
 *   different sticker number, or it keeps the name it has. What a human wants to call it is a
 *   label, stored here on the computer.
 */

// ---------------------------------------------------------------------------------------
// Sticker numbers
// ---------------------------------------------------------------------------------------

/**
 * Every sticker printed so far is a four-digit number, and future sheets may use five. Those
 * are two different name spaces, not two spellings of one: **`0451` and `00451` may be different
 * stickers**, so this code never pads, trims or otherwise converts between the two lengths.
 */
export const STICKER_DIGIT_LENGTHS = [4, 5] as const;
/** The only length in use on printed stickers today. Five-digit numbers are accepted and warned about. */
export const STICKER_DIGITS_IN_USE = 4;

export interface StickerNumber {
  /** The digits exactly as they appear, leading zeros included. */
  digits: string;
  /** 4 or 5. Never normalised — see the comment above. */
  length: number;
}

/** Parses a DIY filename as a sticker number, or null if it is not one. */
export function parseStickerNumber(fileName: string): StickerNumber | null {
  const match = /^(\d{4,5})\.mp3$/i.exec(fileName);
  if (!match) return null;
  return { digits: match[1], length: match[1].length };
}

export const stickerFileName = (digits: string): string => `${digits}.mp3`;

export type ReassignCheck =
  | { status: 'ok'; fileName: string; warnings: ReassignWarning[] }
  | { status: 'invalid-length'; warnings: [] }
  | { status: 'not-digits'; warnings: [] }
  | { status: 'occupied'; fileName: string; warnings: [] }
  | { status: 'unchanged'; fileName: string; warnings: [] };

export type ReassignWarning =
  /** Five digits: valid, but no sticker sheet printed so far uses them. */
  | 'length-not-yet-printed'
  /** Nothing of that number is on the pen, so we cannot confirm the sticker exists. */
  | 'not-currently-on-pen';

/**
 * Checks a number the user typed. Deliberately **warns rather than blocks** for anything we
 * merely cannot confirm: we do not hold the list of valid sticker numbers, and a wrong guess at
 * an upper bound would block a real sticker while looking, to the user, like a broken app.
 */
export function checkReassign(params: { input: string; currentFileName: string; existingFileNames: readonly string[] }): ReassignCheck {
  const raw = params.input.trim();
  if (!/^\d+$/.test(raw)) return { status: 'not-digits', warnings: [] };
  if (!STICKER_DIGIT_LENGTHS.includes(raw.length as (typeof STICKER_DIGIT_LENGTHS)[number])) {
    // Padding "451" to "0451" would be exactly the conversion we must never make on the user's
    // behalf — it could send a recording to a different sticker than the one they meant.
    return { status: 'invalid-length', warnings: [] };
  }

  const fileName = stickerFileName(raw);
  const lower = fileName.toLowerCase();
  if (lower === params.currentFileName.toLowerCase()) return { status: 'unchanged', fileName, warnings: [] };
  if (params.existingFileNames.some((n) => n.toLowerCase() === lower)) return { status: 'occupied', fileName, warnings: [] };

  const warnings: ReassignWarning[] = [];
  if (raw.length !== STICKER_DIGITS_IN_USE) warnings.push('length-not-yet-printed');
  warnings.push('not-currently-on-pen');
  return { status: 'ok', fileName, warnings };
}

export type ReassignResult =
  | { status: 'ok'; fileName: string; backupSnapshotId: string }
  | { status: 'rejected'; reason: ReassignCheck['status'] }
  | { status: 'backup-failed'; error: string }
  | { status: 'failed'; error: string };

/** Moves a recording to a different sticker number on the pen, backing the pen up first. */
export async function reassignStickerNumber(params: {
  diyDirReal: string;
  currentFileName: string;
  input: string;
  backupRootDir: string;
  penVolumeLabel: string | null;
  labels?: Record<string, string>;
}): Promise<ReassignResult> {
  const { diyDirReal, currentFileName, input, backupRootDir, penVolumeLabel, labels } = params;

  let existing: string[] = [];
  try {
    existing = fs.readdirSync(diyDirReal).filter(isEligibleMp3FileName);
  } catch {
    return { status: 'failed', error: 'could not read the pen' };
  }

  const check = checkReassign({ input, currentFileName, existingFileNames: existing });
  if (check.status !== 'ok') return { status: 'rejected', reason: check.status };

  let backupSnapshotId: string;
  try {
    const snap = await createSnapshot({
      diyDirReal,
      backupRootDir,
      penVolumeLabel,
      labels,
      reason: 'before-reassign',
      protecting: currentFileName,
    });
    backupSnapshotId = snap.snapshotId;
  } catch (err) {
    return { status: 'backup-failed', error: err instanceof Error ? err.message : String(err) };
  }

  try {
    fs.renameSync(path.join(diyDirReal, currentFileName), path.join(diyDirReal, check.fileName));
  } catch (err) {
    return { status: 'failed', error: err instanceof Error ? err.message : String(err) };
  }
  return { status: 'ok', fileName: check.fileName, backupSnapshotId };
}

// ---------------------------------------------------------------------------------------
// Deleting
// ---------------------------------------------------------------------------------------

export interface DeleteResult {
  deleted: string[];
  failed: Array<{ fileName: string; error: string }>;
  /** Only for a pen delete: the snapshot taken before anything was removed. */
  backupSnapshotId: string | null;
}

/**
 * Deletes recordings from the pen — after backing the whole pen up. If the backup fails, nothing
 * is deleted: the recording may be the only copy, and there is no undo on a FAT volume.
 *
 * There is deliberately **no "delete from both sides"**. One click that destroys the pen's copy
 * and its only backup is worth nothing to anyone and can cost a recording that cannot be remade.
 */
export async function deleteFromPen(params: {
  diyDirReal: string;
  fileNames: readonly string[];
  backupRootDir: string;
  penVolumeLabel: string | null;
  labels?: Record<string, string>;
}): Promise<DeleteResult | { status: 'backup-failed'; error: string }> {
  const { diyDirReal, fileNames, backupRootDir, penVolumeLabel, labels } = params;
  const result: DeleteResult = { deleted: [], failed: [], backupSnapshotId: null };
  if (fileNames.length === 0) return result;

  try {
    const snap = await createSnapshot({
      diyDirReal,
      backupRootDir,
      penVolumeLabel,
      labels,
      reason: 'before-delete',
      // Only when one recording is at stake: "before deleting 0451" is useful, "before deleting
      // 0451 and 11 others" is not a label, it is a sentence.
      protecting: fileNames.length === 1 ? fileNames[0] : null,
    });
    result.backupSnapshotId = snap.snapshotId;
  } catch (err) {
    return { status: 'backup-failed', error: err instanceof Error ? err.message : String(err) };
  }

  for (const fileName of fileNames) {
    if (!isEligibleMp3FileName(fileName)) {
      result.failed.push({ fileName, error: 'not a recording file name' });
      continue;
    }
    try {
      fs.unlinkSync(path.join(diyDirReal, fileName));
      result.deleted.push(fileName);
    } catch (err) {
      result.failed.push({ fileName, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return result;
}

/**
 * Deletes recordings from a snapshot on the computer, and takes them out of its manifest — a
 * manifest that named a file it no longer holds would turn every later restore into a warning
 * about something the user removed on purpose.
 */
export function deleteFromSnapshot(params: { snapshotDir: string; fileNames: readonly string[] }): DeleteResult {
  const { snapshotDir, fileNames } = params;
  const result: DeleteResult = { deleted: [], failed: [], backupSnapshotId: null };

  for (const fileName of fileNames) {
    if (!isEligibleMp3FileName(fileName)) {
      result.failed.push({ fileName, error: 'not a recording file name' });
      continue;
    }
    try {
      fs.unlinkSync(path.join(snapshotDir, fileName));
      result.deleted.push(fileName);
    } catch (err) {
      result.failed.push({ fileName, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const manifest = readManifest(snapshotDir);
  if (manifest && result.deleted.length > 0) {
    const gone = new Set(result.deleted.map((n) => n.toLowerCase()));
    const updated: SnapshotManifest = { ...manifest, entries: manifest.entries.filter((e) => !gone.has(e.fileName.toLowerCase())) };
    try {
      fs.writeFileSync(path.join(snapshotDir, MANIFEST_FILENAME), `${JSON.stringify(updated, null, 2)}\n`, 'utf8');
    } catch {
      // The files are gone either way; planRestore reports them as missing from the backup, so
      // a stale manifest degrades into an honest warning rather than a broken restore.
    }
  }
  return result;
}

// ---------------------------------------------------------------------------------------
// Friendly labels
// ---------------------------------------------------------------------------------------

/**
 * What a person calls a recording, kept on the computer and never in a filename.
 *
 * Keyed by pen volume label so one household's two pens cannot show each other's names against
 * the same sticker number.
 */
export type RecordingLabels = Record<string, Record<string, string>>;

const penKey = (penVolumeLabel: string | null): string => penVolumeLabel ?? '(unlabelled pen)';

export function getLabels(all: RecordingLabels, penVolumeLabel: string | null): Record<string, string> {
  return all[penKey(penVolumeLabel)] ?? {};
}

export function setLabel(all: RecordingLabels, penVolumeLabel: string | null, fileName: string, label: string): RecordingLabels {
  const key = penKey(penVolumeLabel);
  const forPen = { ...(all[key] ?? {}) };
  const trimmed = label.trim();
  if (trimmed) forPen[fileName] = trimmed;
  else delete forPen[fileName]; // clearing the text removes the label rather than storing ''
  return { ...all, [key]: forPen };
}

/** Follows a recording when it moves to a different sticker number. */
export function renameLabelKey(all: RecordingLabels, penVolumeLabel: string | null, fromFileName: string, toFileName: string): RecordingLabels {
  const key = penKey(penVolumeLabel);
  const forPen = { ...(all[key] ?? {}) };
  const label = forPen[fromFileName];
  if (label === undefined) return all;
  delete forPen[fromFileName];
  forPen[toFileName] = label;
  return { ...all, [key]: forPen };
}
