import fs from 'node:fs';
import type { BookBackupReason, BookRemoveResult } from '@shared/types';
import { resolveContainedFile, resolvePenRoot } from './pathSecurity';
import { sha256File } from './transferService';
import { acquirePenLock } from './penOperationLock';
import * as session from './session';
import { backupBeforeRemove, type BookBackupDeps } from './bookBackup';

/**
 * Removes exactly one file from the pen's BOOK folder — never any other folder, structurally
 * (resolveContainedFile is always given fresh.bookDirReal). Always backs up first (blocking;
 * a failed backup aborts before anything is deleted), and re-verifies immediately before the
 * actual delete that the pen file's bytes are still exactly what was just backed up — not
 * just that the device identity hasn't changed — so new, unbacked-up content can never be
 * destroyed by a race between the backup copy and the delete.
 */
export async function removeFromPen(params: {
  fileName: string;
  penGeneration: number;
  reason: BookBackupReason;
  matchedContentId: string | null;
  backupDeps: BookBackupDeps;
}): Promise<BookRemoveResult> {
  const { fileName, penGeneration, reason, matchedContentId, backupDeps } = params;

  const penRoot = session.getPenRoot();
  if (!penRoot) return { status: 'no-pen-selected' };
  if (penGeneration !== session.getGeneration()) return { status: 'stale-plan' };

  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status === 'not-found') {
    session.setPenRoot(null);
    return { status: 'device-disconnected' };
  }
  if (fresh.status === 'invalid') return { status: 'invalid', missing: fresh.missing };
  const { changed } = session.setPenRoot(fresh);
  if (changed || session.getGeneration() !== penGeneration) return { status: 'stale-plan' };

  const fileResolution = resolveContainedFile(fresh.bookDirReal, fileName);
  if (fileResolution.status !== 'ok') return { status: 'error', message: 'File no longer exists on the pen.' };

  let sizeBytes = 0;
  try {
    sizeBytes = (await fs.promises.stat(fileResolution.realPath)).size;
  } catch {
    return { status: 'error', message: 'File no longer exists on the pen.' };
  }

  const backup = await backupBeforeRemove({
    sourcePath: fileResolution.realPath,
    originalFileName: fileName,
    reason,
    matchedContentId,
    deps: backupDeps,
  });
  if (!backup.ok) return { status: 'backup-failed', message: backup.message };

  const capturedGeneration = session.getGeneration();
  const bookDirReal = fresh.bookDirReal;
  const verifyStillSameTarget = () => session.getGeneration() === capturedGeneration && fs.existsSync(bookDirReal);

  const release = await acquirePenLock();
  try {
    if (!verifyStillSameTarget()) return { status: 'device-disconnected', backupPath: backup.entry.backupId };

    let currentHash: string;
    try {
      currentHash = await sha256File(fileResolution.realPath);
    } catch {
      return { status: 'error', message: 'File no longer exists on the pen.', backupPath: backup.entry.backupId };
    }
    if (currentHash !== backup.entry.sha256) {
      return { status: 'target-changed-since-backup', backupPath: backup.entry.backupId };
    }
    if (!verifyStillSameTarget()) return { status: 'device-disconnected', backupPath: backup.entry.backupId };

    await fs.promises.unlink(fileResolution.realPath);
    return { status: 'completed', freedBytes: sizeBytes, backupPath: backup.entry.backupId };
  } finally {
    release();
  }
}
