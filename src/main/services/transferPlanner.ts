import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type {
  ConflictDecision,
  CopyProgressEvent,
  ReplaceStickerPlanResult,
  ReplaceStickerSummary,
  TransferConflictItem,
  TransferPlanItem,
  TransferToPenPlan,
  TransferToPenPlanResult,
  TransferToPenSummary,
} from '@shared/types';
import { isEligibleMp3FileName, resolveContainedFile, resolvePenRoot } from './pathSecurity';
import { safeWriteFile } from './transferService';
import * as session from './session';

/**
 * The plan/execute logic for operations B and C, deliberately free of any Electron import
 * (no `app`, no `BrowserWindow`) so it can be exercised directly under plain Node/vitest with
 * simulated folders. The thin ipc/transfer.ts wrapper supplies the two things that DO need
 * Electron: where backups live on disk (`app.getPath('userData')`) and how progress reaches
 * the renderer (`window.webContents.send`) — both passed in as plain parameters here.
 */

export async function getFreeBytes(targetPath: string): Promise<number> {
  const stat = await fs.promises.statfs(targetPath);
  return stat.bavail * stat.bsize;
}

/** A fresh, non-conflicting backup folder for one batch, under the given root (not an OS
 *  temp dir that might get auto-cleaned — the caller points this at persistent storage). */
export function makeBackupDir(backupRootDir: string): string {
  const dir = path.join(backupRootDir, `${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomBytes(3).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------------------
// Operation B: computer -> pen (preserve filename; new files add, same-name needs a decision)
// ---------------------------------------------------------------------------------------

export async function planTransferToPen(
  fileNames: string[],
  options: { getFreeBytesFn?: (targetPath: string) => Promise<number> } = {},
): Promise<TransferToPenPlanResult> {
  const getFreeBytesFn = options.getFreeBytesFn ?? getFreeBytes;
  const penRoot = session.getPenRoot();
  if (!penRoot) return { status: 'no-pen-selected' };
  const computerFolder = session.getComputerFolder();
  if (!computerFolder) return { status: 'no-computer-folder-selected' };

  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status === 'not-found') {
    session.setPenRoot(null);
    return { status: 'device-disconnected' };
  }
  if (fresh.status === 'invalid') return { status: 'invalid', missing: fresh.missing };
  session.setPenRoot(fresh);

  const toAdd: TransferPlanItem[] = [];
  const conflicts: TransferConflictItem[] = [];
  const rejected: TransferToPenPlan['rejected'] = [];

  for (const fileName of fileNames) {
    if (!isEligibleMp3FileName(fileName)) {
      rejected.push({ fileName, reason: 'not-mp3' });
      continue;
    }
    const sourceResolution = resolveContainedFile(computerFolder, fileName);
    if (sourceResolution.status === 'not-found') {
      rejected.push({ fileName, reason: 'not-found' });
      continue;
    }
    if (sourceResolution.status !== 'ok') {
      rejected.push({ fileName, reason: 'security-rejected' });
      continue;
    }

    let sizeBytes: number;
    try {
      sizeBytes = (await fs.promises.stat(sourceResolution.realPath)).size;
    } catch {
      rejected.push({ fileName, reason: 'not-found' });
      continue;
    }

    const targetPath = path.join(fresh.diyDirReal, fileName);
    if (fs.existsSync(targetPath)) {
      let existingSizeBytes = 0;
      try {
        existingSizeBytes = (await fs.promises.stat(targetPath)).size;
      } catch {
        // ignore — existence check above already confirmed it exists at this moment
      }
      conflicts.push({ fileName, sourceSizeBytes: sizeBytes, existingSizeBytes });
    } else {
      toAdd.push({ fileName, sizeBytes });
    }
  }

  const requiredBytes =
    toAdd.reduce((sum, i) => sum + i.sizeBytes, 0) + conflicts.reduce((sum, i) => sum + i.sourceSizeBytes, 0);
  let freeBytes = 0;
  try {
    freeBytes = await getFreeBytesFn(fresh.diyDirReal);
  } catch {
    // statfs unsupported/failed — report 0 free so hasEnoughSpace reads false, never assumed OK
  }

  return {
    status: 'ok',
    toAdd,
    conflicts,
    rejected,
    destinationVolumeLabel: path.basename(fresh.realPath),
    requiredBytes,
    freeBytes,
    hasEnoughSpace: freeBytes >= requiredBytes,
    penGeneration: session.getGeneration(),
  };
}

export async function executeTransferToPen(params: {
  fileNames: string[];
  decisions: Record<string, ConflictDecision>;
  penGeneration: number;
  backupRootDir: string;
  onProgress?: (event: CopyProgressEvent) => void;
  getFreeBytesFn?: (targetPath: string) => Promise<number>;
}): Promise<TransferToPenSummary> {
  const { fileNames, decisions, penGeneration, backupRootDir, onProgress } = params;
  const getFreeBytesFn = params.getFreeBytesFn ?? getFreeBytes;
  const empty = {
    added: [] as string[],
    replaced: [] as TransferToPenSummary['replaced'],
    skipped: [] as string[],
    failed: [] as TransferToPenSummary['failed'],
  };

  const penRoot = session.getPenRoot();
  if (!penRoot) return { status: 'no-pen-selected', ...empty };
  const computerFolder = session.getComputerFolder();
  if (!computerFolder) return { status: 'no-computer-folder-selected', ...empty };
  if (penGeneration !== session.getGeneration()) {
    return { status: 'stale-plan', ...empty, message: 'The pen changed since this plan was made — please recompute it.' };
  }

  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status === 'not-found') {
    session.setPenRoot(null);
    return { status: 'device-disconnected', ...empty };
  }
  if (fresh.status === 'invalid') {
    return { status: 'error', ...empty, message: `Expected folder(s) missing on the pen: ${fresh.missing.join(', ')}` };
  }
  const { changed } = session.setPenRoot(fresh);
  if (changed || session.getGeneration() !== penGeneration) {
    return { status: 'stale-plan', ...empty, message: 'The pen changed since this plan was made — please recompute it.' };
  }

  // Hard, server-side space check right before writing anything — the plan step's space
  // estimate is only advisory for the UI and may be stale; this is the authoritative gate.
  let requiredBytes = 0;
  for (const fileName of fileNames) {
    if (decisions[fileName] === 'skip') continue;
    const sourceResolution = resolveContainedFile(computerFolder, fileName);
    if (sourceResolution.status !== 'ok') continue;
    try {
      requiredBytes += (await fs.promises.stat(sourceResolution.realPath)).size;
    } catch {
      // will be reported as a per-file failure in the loop below
    }
  }
  let freeBytes = 0;
  try {
    freeBytes = await getFreeBytesFn(fresh.diyDirReal);
  } catch {
    // statfs unsupported/failed — treated as insufficient, never silently assumed OK
  }
  if (freeBytes < requiredBytes) {
    return { status: 'no-space', ...empty, message: 'Not enough free space on the pen for this batch.' };
  }

  const backupDir = makeBackupDir(backupRootDir);
  const added: string[] = [];
  const replaced: TransferToPenSummary['replaced'] = [];
  const skipped: string[] = [];
  const failed: TransferToPenSummary['failed'] = [];

  const fileCount = fileNames.length;
  for (let i = 0; i < fileCount; i++) {
    const fileName = fileNames[i];
    const decision = decisions[fileName];

    if (decision === 'skip') {
      skipped.push(fileName);
      onProgress?.({ fileIndex: i, fileCount, fileName, fileStatus: 'skipped' });
      continue;
    }

    if (!isEligibleMp3FileName(fileName)) {
      failed.push({ file: fileName, message: 'Not an eligible .mp3 file.', reason: 'security-rejected' });
      continue;
    }

    // A file that already exists at the target MUST have an explicit 'replace' decision —
    // never silently overwritten just because it fell through with no decision recorded.
    const targetExistsNow = fs.existsSync(path.join(fresh.diyDirReal, fileName));
    if (targetExistsNow && decision !== 'replace') {
      skipped.push(fileName);
      onProgress?.({ fileIndex: i, fileCount, fileName, fileStatus: 'skipped' });
      continue;
    }

    const sourceResolution = resolveContainedFile(computerFolder, fileName);
    if (sourceResolution.status !== 'ok') {
      const reason = sourceResolution.status === 'not-found' ? 'not-found' : 'security-rejected';
      failed.push({
        file: fileName,
        message: sourceResolution.status === 'not-found' ? 'Source file no longer exists.' : 'File name was rejected for security reasons.',
        reason,
      });
      continue;
    }

    onProgress?.({ fileIndex: i, fileCount, fileName, fileStatus: 'copying' });
    const result = await safeWriteFile({
      sourcePath: sourceResolution.realPath,
      targetDir: fresh.diyDirReal,
      targetFileName: fileName,
      backupDir,
      isTargetVolumeAvailable: () => fs.existsSync(fresh.diyDirReal),
    });

    if (result.ok) {
      if (result.backupPath) {
        replaced.push({ fileName, backupPath: result.backupPath });
        onProgress?.({ fileIndex: i, fileCount, fileName, fileStatus: 'replaced' });
      } else {
        added.push(fileName);
        onProgress?.({ fileIndex: i, fileCount, fileName, fileStatus: 'added' });
      }
    } else {
      failed.push({ file: fileName, message: result.message ?? 'Unknown error', reason: result.reason ?? 'other' });
      onProgress?.({ fileIndex: i, fileCount, fileName, fileStatus: 'failed', error: result.message });
    }
  }

  return { status: 'completed', added, replaced, skipped, failed, backupFolder: backupDir };
}

// ---------------------------------------------------------------------------------------
// Operation C: replace one existing sticker's audio with a teacher-recorded computer file
// ---------------------------------------------------------------------------------------

export async function planReplaceSticker(params: { penFileName: string; computerFileName: string }): Promise<ReplaceStickerPlanResult> {
  const { penFileName, computerFileName } = params;
  const penRoot = session.getPenRoot();
  if (!penRoot) return { status: 'no-pen-selected' };
  const computerFolder = session.getComputerFolder();
  if (!computerFolder) return { status: 'no-computer-folder-selected' };

  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status === 'not-found') {
    session.setPenRoot(null);
    return { status: 'device-disconnected' };
  }
  if (fresh.status === 'invalid') return { status: 'invalid', missing: fresh.missing };
  session.setPenRoot(fresh);

  if (!isEligibleMp3FileName(penFileName)) return { status: 'not-found', which: 'pen-file' };
  const penFileResolution = resolveContainedFile(fresh.diyDirReal, penFileName);
  if (penFileResolution.status !== 'ok') return { status: 'not-found', which: 'pen-file' };

  if (!isEligibleMp3FileName(computerFileName)) return { status: 'not-found', which: 'computer-file' };
  const computerFileResolution = resolveContainedFile(computerFolder, computerFileName);
  if (computerFileResolution.status !== 'ok') return { status: 'not-found', which: 'computer-file' };

  const [penStat, computerStat] = await Promise.all([
    fs.promises.stat(penFileResolution.realPath),
    fs.promises.stat(computerFileResolution.realPath),
  ]);

  return {
    status: 'ok',
    penFileName,
    penFileSizeBytes: penStat.size,
    computerFileName,
    computerFileSizeBytes: computerStat.size,
    penGeneration: session.getGeneration(),
  };
}

export async function executeReplaceSticker(params: {
  penFileName: string;
  computerFileName: string;
  penGeneration: number;
  backupRootDir: string;
  onProgress?: (event: CopyProgressEvent) => void;
  getFreeBytesFn?: (targetPath: string) => Promise<number>;
}): Promise<ReplaceStickerSummary> {
  const { penFileName, computerFileName, penGeneration, backupRootDir, onProgress } = params;
  const getFreeBytesFn = params.getFreeBytesFn ?? getFreeBytes;
  const penRoot = session.getPenRoot();
  if (!penRoot) return { status: 'error', message: 'No pen selected.' };
  const computerFolder = session.getComputerFolder();
  if (!computerFolder) return { status: 'error', message: 'No computer folder selected.' };
  if (penGeneration !== session.getGeneration()) {
    return { status: 'stale-plan', message: 'The pen changed since this was confirmed — please try again.' };
  }

  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status === 'not-found') {
    session.setPenRoot(null);
    return { status: 'device-disconnected' };
  }
  if (fresh.status === 'invalid') {
    return { status: 'error', message: `Expected folder(s) missing on the pen: ${fresh.missing.join(', ')}` };
  }
  const { changed } = session.setPenRoot(fresh);
  if (changed || session.getGeneration() !== penGeneration) {
    return { status: 'stale-plan', message: 'The pen changed since this was confirmed — please try again.' };
  }

  if (!isEligibleMp3FileName(penFileName)) return { status: 'error', message: 'Invalid target file name.' };
  const penFileResolution = resolveContainedFile(fresh.diyDirReal, penFileName);
  if (penFileResolution.status !== 'ok') {
    return { status: 'error', message: 'The sticker recording to replace no longer exists on the pen.' };
  }

  const computerFileResolution = resolveContainedFile(computerFolder, computerFileName);
  if (computerFileResolution.status !== 'ok') {
    return { status: 'error', message: 'The source recording on the computer is no longer available.' };
  }

  let freeBytes = 0;
  try {
    freeBytes = await getFreeBytesFn(fresh.diyDirReal);
  } catch {
    // fall through with freeBytes 0 — treated as insufficient below, never silently assumed OK
  }
  let requiredBytes = 0;
  try {
    requiredBytes = (await fs.promises.stat(computerFileResolution.realPath)).size;
  } catch {
    return { status: 'error', message: 'The source recording on the computer is no longer available.' };
  }
  if (freeBytes < requiredBytes) {
    return { status: 'no-space', message: 'Not enough free space on the pen for this replacement.' };
  }

  const backupDir = makeBackupDir(backupRootDir);
  onProgress?.({ fileIndex: 0, fileCount: 1, fileName: penFileName, fileStatus: 'copying' });
  const result = await safeWriteFile({
    sourcePath: computerFileResolution.realPath,
    targetDir: fresh.diyDirReal,
    targetFileName: penFileName, // preserve the STICKER's filename, not the computer source's own name
    backupDir,
    isTargetVolumeAvailable: () => fs.existsSync(fresh.diyDirReal),
  });

  if (!result.ok) {
    onProgress?.({ fileIndex: 0, fileCount: 1, fileName: penFileName, fileStatus: 'failed', error: result.message });
    if (result.reason === 'backup-failed') return { status: 'backup-failed', message: result.message };
    if (result.reason === 'disconnected') return { status: 'device-disconnected', message: result.message };
    return { status: 'error', message: result.message };
  }

  onProgress?.({ fileIndex: 0, fileCount: 1, fileName: penFileName, fileStatus: 'replaced' });
  return { status: 'completed', backupPath: result.backupPath };
}
