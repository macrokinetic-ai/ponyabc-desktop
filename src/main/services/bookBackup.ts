import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BookBackupEntry, BookBackupReason } from '@shared/types';
import { sha256File } from './transferService';

export interface BookBackupDeps {
  /** backups/book — durable, never touched by any (future) cache-cleanup logic. */
  backupDir: string;
  getBackupEntries: () => BookBackupEntry[];
  saveBackupEntry: (entry: BookBackupEntry) => void;
  cacheDir: string;
  findCacheEntryByHash: (sha256: string) => { contentId: string; sha256: string } | null;
}

async function defaultGetFreeBytes(targetPath: string): Promise<number> {
  const stat = await fs.promises.statfs(targetPath);
  return stat.bavail * stat.bsize;
}

/**
 * Backs up a pen file BEFORE it is removed or overwritten, verifying the copy's hash before
 * recording it. If an already-verified cache file with the exact same hash exists, the
 * backup entry references it instead of duplicating bytes — safe because this app has no
 * cache-eviction feature this round, so a referenced cache file can never be cleaned up out
 * from under a backup. A failed backup returns `ok: false` and touches nothing else; the
 * caller must not proceed with the remove/overwrite.
 */
export async function backupBeforeRemove(params: {
  sourcePath: string;
  originalFileName: string;
  reason: BookBackupReason;
  matchedContentId: string | null;
  deps: BookBackupDeps;
  getFreeBytesFn?: (p: string) => Promise<number>;
}): Promise<{ ok: true; entry: BookBackupEntry } | { ok: false; message: string }> {
  const { sourcePath, originalFileName, reason, matchedContentId, deps } = params;
  const getFreeBytesFn = params.getFreeBytesFn ?? defaultGetFreeBytes;

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(sourcePath);
  } catch {
    return { ok: false, message: 'Source file no longer exists.' };
  }
  let sha256: string;
  try {
    sha256 = await sha256File(sourcePath);
  } catch {
    return { ok: false, message: 'Could not read the file to back it up.' };
  }

  const existingCacheRef = deps.findCacheEntryByHash(sha256);
  const backupId = crypto.randomUUID();

  if (!existingCacheRef) {
    const filesDir = path.join(deps.backupDir, 'files');
    try {
      fs.mkdirSync(filesDir, { recursive: true });
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    let freeBytes = 0;
    try {
      freeBytes = await getFreeBytesFn(filesDir);
    } catch {
      freeBytes = 0;
    }
    if (freeBytes < stat.size) return { ok: false, message: 'Not enough free space to back up this file.' };

    const destPath = path.join(filesDir, `${backupId}-${originalFileName}`);
    try {
      await fs.promises.copyFile(sourcePath, destPath, fs.constants.COPYFILE_EXCL);
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
    const backedUpHash = await sha256File(destPath);
    if (backedUpHash !== sha256) {
      await fs.promises.unlink(destPath).catch(() => {});
      return { ok: false, message: 'Backup did not verify after copying.' };
    }
  }

  const entry: BookBackupEntry = {
    backupId,
    originalFileName,
    sizeBytes: stat.size,
    sha256,
    reason,
    matchedContentId,
    createdAtMs: Date.now(),
    cacheRef: existingCacheRef,
  };
  deps.saveBackupEntry(entry);
  return { ok: true, entry };
}

/** The real on-disk path for a backup entry's bytes — a reference resolves to the cache
 *  file's deterministic path, never a duplicate. */
export function backupFilePath(deps: Pick<BookBackupDeps, 'backupDir' | 'cacheDir'>, entry: BookBackupEntry): string {
  if (entry.cacheRef) {
    return path.join(deps.cacheDir, `${entry.cacheRef.contentId}-${entry.cacheRef.sha256}.axb`);
  }
  return path.join(deps.backupDir, 'files', `${entry.backupId}-${entry.originalFileName}`);
}
