import fs from 'node:fs';
import path from 'node:path';

export interface CopyFileTask {
  /** Already security-resolved absolute real path — see pathSecurity.ts. Never a raw renderer string. */
  sourcePath: string;
  /** Display/original name, used for dest naming and reporting. */
  fileName: string;
}

export type CopyFailureReason = 'not-found' | 'permission' | 'no-space' | 'io-error' | 'disconnected' | 'other';

export interface CopyProgressEvent {
  fileIndex: number;
  fileCount: number;
  fileName: string;
  fileStatus: 'copying' | 'done' | 'renamed' | 'failed';
  savedAs?: string;
  error?: string;
}

export interface CopyResult {
  succeeded: string[];
  renamed: Array<{ original: string; savedAs: string }>;
  failed: Array<{ file: string; message: string; reason: CopyFailureReason }>;
  /** True if the batch stopped early because the source root disappeared (pen disconnected). */
  aborted: boolean;
}

function classifyError(err: unknown): { reason: CopyFailureReason; message: string } {
  const code = (err as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'ENOENT':
      return { reason: 'not-found', message: 'File no longer exists on the pen (it may have been deleted or renamed).' };
    case 'EACCES':
    case 'EPERM':
      return { reason: 'permission', message: 'Permission denied while reading or writing this file.' };
    case 'ENOSPC':
      return { reason: 'no-space', message: 'Not enough free space on the destination disk.' };
    case 'EIO':
      return { reason: 'io-error', message: 'A read/write error occurred (the device may be disconnected).' };
    default:
      return { reason: 'other', message: err instanceof Error ? err.message : String(err) };
  }
}

export function resolveCollisionFreeName(destDir: string, fileName: string): string {
  if (!fs.existsSync(path.join(destDir, fileName))) return fileName;
  const ext = path.extname(fileName);
  const base = path.basename(fileName, ext);
  let n = 1;
  let candidate: string;
  do {
    candidate = `${base} (${n})${ext}`;
    n += 1;
  } while (fs.existsSync(path.join(destDir, candidate)));
  return candidate;
}

/**
 * Copies each task's source file into destinationDir, never overwriting an existing
 * destination file (auto-renames on collision instead), and never modifying or removing
 * the source. One file's failure does not abort the batch — except when `isSourceRootAvailable`
 * (if provided) reports the source root itself is gone, which stops the batch immediately
 * and marks all remaining files as failed with reason 'disconnected'.
 */
export async function copyFiles(
  tasks: CopyFileTask[],
  destinationDir: string,
  options: {
    onProgress?: (event: CopyProgressEvent) => void;
    isSourceRootAvailable?: () => boolean;
  } = {},
): Promise<CopyResult> {
  const { onProgress, isSourceRootAvailable } = options;
  const result: CopyResult = { succeeded: [], renamed: [], failed: [], aborted: false };
  const fileCount = tasks.length;

  for (let i = 0; i < fileCount; i++) {
    const { sourcePath, fileName } = tasks[i];

    if (isSourceRootAvailable && !isSourceRootAvailable()) {
      for (let j = i; j < fileCount; j++) {
        const remaining = tasks[j];
        result.failed.push({
          file: remaining.fileName,
          message: 'The pen appears to be disconnected. Reconnect it and try again.',
          reason: 'disconnected',
        });
        onProgress?.({
          fileIndex: j,
          fileCount,
          fileName: remaining.fileName,
          fileStatus: 'failed',
          error: 'disconnected',
        });
      }
      result.aborted = true;
      break;
    }

    onProgress?.({ fileIndex: i, fileCount, fileName, fileStatus: 'copying' });
    try {
      if (!fs.existsSync(sourcePath)) {
        throw Object.assign(new Error('Source file no longer exists.'), { code: 'ENOENT' });
      }
      const targetName = resolveCollisionFreeName(destinationDir, fileName);
      const targetPath = path.join(destinationDir, targetName);
      await fs.promises.copyFile(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);

      if (targetName === fileName) {
        result.succeeded.push(fileName);
        onProgress?.({ fileIndex: i, fileCount, fileName, fileStatus: 'done', savedAs: targetName });
      } else {
        result.renamed.push({ original: fileName, savedAs: targetName });
        onProgress?.({ fileIndex: i, fileCount, fileName, fileStatus: 'renamed', savedAs: targetName });
      }
    } catch (err) {
      const { reason, message } = classifyError(err);
      result.failed.push({ file: fileName, message, reason });
      onProgress?.({ fileIndex: i, fileCount, fileName, fileStatus: 'failed', error: message });
    }

    // Yield to the event loop between files so IPC/UI stays responsive during large batches.
    await new Promise<void>((resolve) => setImmediate(resolve));
  }

  return result;
}
