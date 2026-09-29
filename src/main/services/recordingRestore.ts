import fs from 'node:fs';
import path from 'node:path';
import { isEligibleMp3FileName } from './pathSecurity';
import { sha256File } from './transferService';
import { createSnapshot, type SnapshotManifest } from './recordingSnapshot';

/**
 * Putting recordings back on the pen, from a snapshot.
 *
 * The rule the whole feature exists for: **a recording is restored under its own name, or not at
 * all.** The pen finds a recording by its filename — the filename is the sticker number — so a
 * `0451 (1).mp3` written to the pen would not be a slightly-wrong restore, it would be a file
 * the pen can never play, taking up space and confusing the next listing.
 *
 * So a name clash is a question for the user, never something to route around.
 */

export type RestoreDecision =
  /** Put the backup's copy on the pen. The pen's current copy is backed up first. */
  | 'replace'
  /** Leave the pen's copy alone. */
  | 'keep-pen';

export type RestoreItemState =
  /** Nothing of that name on the pen — restoring is unambiguous. */
  | 'new'
  /** Same name, byte-identical content. Nothing to decide and nothing to do. */
  | 'identical'
  /** Same name, different content. The user must choose. */
  | 'clash';

export interface RestorePlanItem {
  fileName: string;
  state: RestoreItemState;
  label: string | null;
  backupSizeBytes: number;
  backupMtimeMs: number;
  /** Only for 'identical' and 'clash'. */
  penSizeBytes: number | null;
  penMtimeMs: number | null;
}

export interface RestorePlan {
  snapshotId: string;
  items: RestorePlanItem[];
  /** Entries in the manifest whose bytes are no longer in the snapshot folder. Reported up
   *  front rather than discovered file by file during a restore. */
  missingFromBackup: string[];
}

export interface RestoreResult {
  restored: string[];
  replaced: string[];
  skipped: string[];
  /** Identical copies that needed no action — never counted as work, never shown as a question. */
  unchanged: string[];
  failed: Array<{ fileName: string; error: string }>;
  /** The snapshot taken of the pen before anything was overwritten, if anything was. */
  penBackupSnapshotId: string | null;
}

/**
 * Compares a snapshot against what is on the pen now.
 *
 * Hashing only happens for a same-name, same-size pair — the only case where "is this actually
 * the same recording?" is both undecidable from a `stat` and worth knowing.
 */
export async function planRestore(params: {
  snapshotDir: string;
  manifest: SnapshotManifest;
  diyDirReal: string;
  fileNames?: readonly string[];
}): Promise<RestorePlan> {
  const { snapshotDir, manifest, diyDirReal, fileNames } = params;
  const wanted = fileNames ? new Set(fileNames) : null;

  const items: RestorePlanItem[] = [];
  const missingFromBackup: string[] = [];

  for (const entry of manifest.entries) {
    if (wanted && !wanted.has(entry.fileName)) continue;

    const backupPath = path.join(snapshotDir, entry.fileName);
    if (!fs.existsSync(backupPath)) {
      missingFromBackup.push(entry.fileName);
      continue;
    }

    const penPath = path.join(diyDirReal, entry.fileName);
    let penStat: fs.Stats | null = null;
    try {
      const s = fs.statSync(penPath);
      if (s.isFile()) penStat = s;
    } catch {
      // not on the pen — the ordinary case
    }

    let state: RestoreItemState = 'new';
    if (penStat) {
      state = 'clash';
      if (penStat.size === entry.sizeBytes) {
        try {
          if ((await sha256File(penPath)) === entry.sha256) state = 'identical';
        } catch {
          // unreadable on the pen — treat as a clash so the user decides rather than us
        }
      }
    }

    items.push({
      fileName: entry.fileName,
      state,
      label: entry.label,
      backupSizeBytes: entry.sizeBytes,
      backupMtimeMs: entry.mtimeMs,
      penSizeBytes: penStat?.size ?? null,
      penMtimeMs: penStat?.mtimeMs ?? null,
    });
  }

  return { snapshotId: manifest.snapshotId, items, missingFromBackup };
}

/**
 * Executes a plan. Every clash must carry a decision; anything undecided is skipped rather than
 * guessed, because both possible guesses destroy something.
 *
 * Copies, never moves: the snapshot is left exactly as it was, so a failed restore is harmless
 * and retrying is always safe.
 */
export async function executeRestore(params: {
  snapshotDir: string;
  plan: RestorePlan;
  diyDirReal: string;
  decisions: Record<string, RestoreDecision>;
  /** Where the pen's own pre-overwrite backup snapshot is written. */
  backupRootDir: string;
  penVolumeLabel: string | null;
  labels?: Record<string, string>;
  onProgress?: (event: { fileIndex: number; fileCount: number; fileName: string }) => void;
}): Promise<RestoreResult> {
  const { snapshotDir, plan, diyDirReal, decisions, backupRootDir, penVolumeLabel, labels, onProgress } = params;

  const result: RestoreResult = { restored: [], replaced: [], skipped: [], unchanged: [], failed: [], penBackupSnapshotId: null };

  const toWrite = plan.items.filter(
    (i) => i.state === 'new' || (i.state === 'clash' && decisions[i.fileName] === 'replace'),
  );
  const willOverwrite = toWrite.some((i) => i.state === 'clash');

  // Anything about to be overwritten is backed up first — the pen's copy may be the only one in
  // existence, and "restore" must never be a way to lose a recording.
  if (willOverwrite) {
    const penBackup = await createSnapshot({ diyDirReal, backupRootDir, penVolumeLabel, labels });
    result.penBackupSnapshotId = penBackup.snapshotId;
  }

  for (const item of plan.items) {
    if (item.state === 'identical') {
      result.unchanged.push(item.fileName);
      continue;
    }
    if (item.state === 'clash' && decisions[item.fileName] !== 'replace') {
      result.skipped.push(item.fileName);
      continue;
    }
  }

  for (let i = 0; i < toWrite.length; i++) {
    const item = toWrite[i];
    onProgress?.({ fileIndex: i, fileCount: toWrite.length, fileName: item.fileName });

    // The name is never adjusted to avoid a collision. There is nothing to collide with by this
    // point — a clash was either decided or skipped above.
    if (!isEligibleMp3FileName(item.fileName)) {
      result.failed.push({ fileName: item.fileName, error: 'not a recording file name' });
      continue;
    }

    try {
      fs.copyFileSync(path.join(snapshotDir, item.fileName), path.join(diyDirReal, item.fileName));
      if (item.state === 'clash') result.replaced.push(item.fileName);
      else result.restored.push(item.fileName);
    } catch (err) {
      result.failed.push({ fileName: item.fileName, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return result;
}
