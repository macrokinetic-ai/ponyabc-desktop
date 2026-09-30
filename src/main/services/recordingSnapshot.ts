import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { isEligibleMp3FileName } from './pathSecurity';
import { sha256File } from './transferService';

/**
 * Snapshot backups of the pen's DIY recordings.
 *
 * The problem this replaces: saving recordings to the computer renamed a file when one of that
 * name was already there — `0451.mp3` became `0451 (1).mp3`. The pen identifies a recording
 * *solely* by its filename (the filename IS the sticker number), so a renamed file is not a
 * lesser copy of that recording. It is nothing. It cannot be restored.
 *
 * A snapshot is a timestamped folder holding every recording under its ORIGINAL name, so there
 * is never a collision to resolve, plus a `manifest.json` describing all of them.
 *
 * Two rules that look like implementation detail and are not:
 *
 * 1. **Every snapshot lists every recording.** When a file's bytes are identical to one already
 *    held by an earlier snapshot we avoid storing them twice — but the manifest still names the
 *    file, and the file still appears in this snapshot's folder (as a hard link when the
 *    filesystem allows one). Omitting it would mean that deleting an old snapshot to free space
 *    silently breaks newer ones, in a way nobody would discover until a restore failed.
 * 2. **A hard link is an optimisation, never a correctness requirement.** External drives are
 *    routinely exFAT or FAT32, where `link()` fails. Then we copy, and record that we copied.
 */

export const MANIFEST_FILENAME = 'manifest.json';
export const SNAPSHOT_MANIFEST_VERSION = 1;

/** How this snapshot's copy of the bytes is stored. */
export type SnapshotStorage = 'copy' | 'hardlink';

export interface SnapshotEntry {
  /** The recording's name on the pen, unchanged. For a P5 pen this is the sticker number. */
  fileName: string;
  sizeBytes: number;
  /** The pen's own modified time — the closest thing we have to when it was recorded. */
  mtimeMs: number;
  sha256: string;
  storage: SnapshotStorage;
  /** The snapshot whose bytes this entry shares, or this snapshot's own id. */
  bytesFrom: string;
  /** The friendly label at the time of the backup, so a label survives with its recording. */
  label: string | null;
}

/**
 * Why this snapshot exists.
 *
 * A backup the owner asked for and a backup the app took by itself, a second before replacing
 * something, are not the same kind of thing, and a list that shows them identically makes the
 * automatic ones look like clutter the person does not remember making. `manual` is the button;
 * everything else is the app protecting something, and `protecting` says what.
 */
export type SnapshotReason = 'manual' | 'before-replace' | 'before-delete' | 'before-restore' | 'before-reassign' | 'migration';

export interface SnapshotManifest {
  version: number;
  snapshotId: string;
  createdAtMs: number;
  /** Which pen this came from, so snapshots from two pens are never confused. */
  penVolumeLabel: string | null;
  entries: SnapshotEntry[];
  /** Absent in snapshots written before rc6; treated as 'manual' when read. */
  reason?: SnapshotReason;
  /** The recording this backup was taken to protect, e.g. "0451.mp3". Only for the automatic
   *  reasons, and only when one recording was at stake. */
  protecting?: string | null;
}

export interface CreateSnapshotResult {
  status: 'ok';
  snapshotId: string;
  snapshotDir: string;
  manifest: SnapshotManifest;
  /** Entries whose bytes were already held by an earlier snapshot. */
  dedupedCount: number;
  /** Entries that had to be copied although an earlier snapshot held the same bytes, because
   *  the destination filesystem does not support hard links. Purely informational. */
  linkFallbackCount: number;
  failed: Array<{ fileName: string; error: string }>;
}

/** `2026-09-30-1412-a1b2c3` — sortable, readable, and unique even twice in one minute. */
export function makeSnapshotId(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `${stamp}-${crypto.randomBytes(3).toString('hex')}`;
}

export function readManifest(snapshotDir: string): SnapshotManifest | null {
  try {
    const raw = fs.readFileSync(path.join(snapshotDir, MANIFEST_FILENAME), 'utf8');
    const parsed = JSON.parse(raw) as SnapshotManifest;
    if (typeof parsed?.snapshotId !== 'string' || !Array.isArray(parsed.entries)) return null;
    return parsed;
  } catch {
    // A folder without a readable manifest is not a snapshot we can restore from. Reporting it
    // as "no snapshot" is honest; guessing its contents from the directory listing would not be.
    return null;
  }
}

/** Every readable snapshot under `backupRootDir`, newest first. */
export function listSnapshots(backupRootDir: string): Array<{ snapshotId: string; snapshotDir: string; manifest: SnapshotManifest }> {
  let names: string[];
  try {
    names = fs.readdirSync(backupRootDir);
  } catch {
    return [];
  }
  const found: Array<{ snapshotId: string; snapshotDir: string; manifest: SnapshotManifest }> = [];
  for (const name of names) {
    const snapshotDir = path.join(backupRootDir, name);
    try {
      if (!fs.statSync(snapshotDir).isDirectory()) continue;
    } catch {
      continue;
    }
    const manifest = readManifest(snapshotDir);
    if (manifest) found.push({ snapshotId: manifest.snapshotId, snapshotDir, manifest });
  }
  return found.sort((a, b) => b.manifest.createdAtMs - a.manifest.createdAtMs);
}

interface HeldBytes {
  filePath: string;
  snapshotId: string;
}

/** sha256 -> an existing file holding exactly those bytes, for deduplication. */
function buildByteIndex(backupRootDir: string): Map<string, HeldBytes> {
  const index = new Map<string, HeldBytes>();
  for (const { snapshotDir, manifest } of listSnapshots(backupRootDir)) {
    for (const entry of manifest.entries) {
      if (index.has(entry.sha256)) continue;
      const candidate = path.join(snapshotDir, entry.fileName);
      // Only index bytes that are actually still there — a user may have deleted the folder.
      if (fs.existsSync(candidate)) index.set(entry.sha256, { filePath: candidate, snapshotId: manifest.snapshotId });
    }
  }
  return index;
}

/**
 * Places `sourcePath`'s bytes at `destPath`, preferring a hard link to an identical file we
 * already hold. Returns how it was stored, and never leaves a partial file behind.
 */
function placeBytes(sourcePath: string, destPath: string, identical: HeldBytes | undefined): SnapshotStorage {
  if (identical) {
    try {
      fs.linkSync(identical.filePath, destPath);
      return 'hardlink';
    } catch {
      // exFAT/FAT32, a different volume, or a filesystem without links. Copying is always
      // correct; only the disk usage differs.
    }
  }
  fs.copyFileSync(sourcePath, destPath);
  return 'copy';
}

/**
 * Backs up every recording in `diyDirReal` into a new timestamped snapshot.
 *
 * `labels` supplies the friendly label for a filename, if the user has set one, so it travels
 * with the backup rather than only living in the app.
 */
export async function createSnapshot(params: {
  diyDirReal: string;
  backupRootDir: string;
  penVolumeLabel: string | null;
  labels?: Record<string, string>;
  reason?: SnapshotReason;
  protecting?: string | null;
  now?: Date;
  onProgress?: (event: { fileIndex: number; fileCount: number; fileName: string }) => void;
}): Promise<CreateSnapshotResult> {
  const { diyDirReal, ...rest } = params;
  let names: string[] = [];
  try {
    names = fs.readdirSync(diyDirReal).filter(isEligibleMp3FileName).sort();
  } catch {
    // No DIY folder (pen unplugged mid-operation, or not a pen at all) — an empty snapshot is
    // still a valid, restorable record of "there was nothing here".
    names = [];
  }
  return createSnapshotFromFiles({ ...rest, files: names.map((fileName) => ({ fileName, sourcePath: path.join(diyDirReal, fileName) })) });
}

/**
 * The core of a snapshot, taking explicit sources so it can serve both an ordinary backup of the
 * pen and the migration of an old `(1)`-style folder, where the file a recording must be saved
 * as is not the name it currently has on disk.
 */
export async function createSnapshotFromFiles(params: {
  files: ReadonlyArray<{ fileName: string; sourcePath: string }>;
  backupRootDir: string;
  penVolumeLabel: string | null;
  labels?: Record<string, string>;
  reason?: SnapshotReason;
  protecting?: string | null;
  now?: Date;
  onProgress?: (event: { fileIndex: number; fileCount: number; fileName: string }) => void;
}): Promise<CreateSnapshotResult> {
  const { files, backupRootDir, penVolumeLabel, labels = {}, reason = 'manual', protecting = null, now, onProgress } = params;

  const snapshotId = makeSnapshotId(now);
  const snapshotDir = path.join(backupRootDir, snapshotId);
  fs.mkdirSync(snapshotDir, { recursive: true });

  const byteIndex = buildByteIndex(backupRootDir);

  const entries: SnapshotEntry[] = [];
  const failed: CreateSnapshotResult['failed'] = [];
  let dedupedCount = 0;
  let linkFallbackCount = 0;

  for (let i = 0; i < files.length; i++) {
    const { fileName, sourcePath } = files[i];
    onProgress?.({ fileIndex: i, fileCount: files.length, fileName });

    try {
      const stat = fs.statSync(sourcePath);
      if (!stat.isFile()) continue;
      const sha256 = await sha256File(sourcePath);
      const identical = byteIndex.get(sha256);
      const storage = placeBytes(sourcePath, path.join(snapshotDir, fileName), identical);

      if (identical) {
        dedupedCount += 1;
        if (storage === 'copy') linkFallbackCount += 1;
      }
      entries.push({
        fileName,
        sizeBytes: stat.size,
        mtimeMs: stat.mtimeMs,
        sha256,
        storage,
        bytesFrom: identical?.snapshotId ?? snapshotId,
        label: labels[fileName] ?? null,
      });
      // A file we have just stored is itself a dedupe target for the rest of this run.
      if (!byteIndex.has(sha256)) byteIndex.set(sha256, { filePath: path.join(snapshotDir, fileName), snapshotId });
    } catch (err) {
      failed.push({ fileName, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const manifest: SnapshotManifest = {
    version: SNAPSHOT_MANIFEST_VERSION,
    snapshotId,
    createdAtMs: (now ?? new Date()).getTime(),
    penVolumeLabel,
    entries,
    reason,
    protecting,
  };
  fs.writeFileSync(path.join(snapshotDir, MANIFEST_FILENAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  return { status: 'ok', snapshotId, snapshotDir, manifest, dedupedCount, linkFallbackCount, failed };
}
