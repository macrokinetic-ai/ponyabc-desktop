import fs from 'node:fs';
import type { BookActionResult } from '@shared/types';
import { resolvePenRoot } from './pathSecurity';
import { safeWriteFile } from './transferService';
import { acquirePenLock } from './penOperationLock';
import * as session from './session';
import { backupFilePath, type BookBackupDeps } from './bookBackup';

/** Restores a previously-backed-up BOOK file to the pen under its original filename — just
 *  safeWriteFile again, source = the backup's bytes (or its cache reference); no new write
 *  primitive. */
export async function restoreFromBackup(params: {
  backupId: string;
  penGeneration: number;
  backupDeps: BookBackupDeps;
  /** A fresh, non-conflicting scratch dir for safeWriteFile's own crash-safety backup. */
  scratchBackupDir: string;
}): Promise<BookActionResult> {
  const { backupId, penGeneration, backupDeps, scratchBackupDir } = params;

  const entry = backupDeps.getBackupEntries().find((e) => e.backupId === backupId);
  if (!entry) return { status: 'error', message: 'Backup no longer exists.' };

  const sourcePath = backupFilePath(backupDeps, entry);
  if (!fs.existsSync(sourcePath)) return { status: 'error', message: 'Backup file is missing on disk.' };

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

  const capturedGeneration = session.getGeneration();
  const bookDirReal = fresh.bookDirReal;
  const verifyStillSameTarget = () => session.getGeneration() === capturedGeneration && fs.existsSync(bookDirReal);

  const release = await acquirePenLock();
  try {
    const result = await safeWriteFile({
      sourcePath,
      targetDir: bookDirReal,
      targetFileName: entry.originalFileName,
      backupDir: scratchBackupDir,
      verifyStillSameTarget,
    });
    if (!result.ok) {
      const status =
        result.reason === 'device-changed' || result.reason === 'disconnected'
          ? 'device-disconnected'
          : result.reason === 'no-space'
            ? 'no-space'
            : result.reason === 'backup-failed'
              ? 'backup-failed'
              : 'error';
      return { status, message: result.message, backupPath: result.backupPath };
    }
    return { status: 'completed', backupPath: result.backupPath };
  } finally {
    release();
  }
}
