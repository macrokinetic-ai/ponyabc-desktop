import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type WriteFailureReason =
  | 'not-found'
  | 'permission'
  | 'no-space'
  | 'io-error'
  | 'disconnected'
  | 'hash-mismatch'
  | 'backup-failed'
  | 'other';

export interface SafeWriteResult {
  ok: boolean;
  reason?: WriteFailureReason;
  message?: string;
  /** Set when a pre-existing file at the target was backed up before being replaced. */
  backupPath?: string;
}

function classifyError(err: unknown): { reason: WriteFailureReason; message: string } {
  const code = (err as NodeJS.ErrnoException)?.code;
  switch (code) {
    case 'ENOENT':
      return { reason: 'not-found', message: 'File no longer exists.' };
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

export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function unlinkQuiet(p: string): Promise<void> {
  await fs.promises.unlink(p).catch(() => {});
}

/**
 * Safely writes `sourcePath`'s content to `targetDir/targetFileName`, preserving the exact
 * target filename. Order of operations, chosen specifically so a crash or disconnect at any
 * point leaves a recoverable state and the original is never deleted before its replacement
 * is fully staged and verified:
 *
 *   1. If a file already exists at the target, copy it (byte for byte, original name) into
 *      `backupDir` first. If that copy fails for any reason, stop — nothing on the target is
 *      touched, and the whole write is reported as failed with reason 'backup-failed'.
 *   2. Copy the source into a temp file *in the same target directory* (so the final swap is
 *      a same-volume rename, not a cross-volume copy).
 *   3. Verify the staged temp file's size and SHA-256 against the source.
 *   4. Only then rename the verified temp file over the final target path.
 *
 * This does not — and cannot — guarantee power-loss atomicity on FAT32/exFAT (the common SD
 * card filesystems): a same-volume rename is fast and typically near-atomic in practice, but
 * neither filesystem journals renames the way e.g. ext4 does. What IS guaranteed: the
 * original file (or, for a replace, its backup copy on the computer) exists at every point
 * up until the new content has already been fully written and verified.
 */
export async function safeWriteFile(params: {
  sourcePath: string;
  targetDir: string;
  targetFileName: string;
  /** Must already exist; dedicated to this operation batch so backups never collide. */
  backupDir: string;
  isTargetVolumeAvailable: () => boolean;
}): Promise<SafeWriteResult> {
  const { sourcePath, targetDir, targetFileName, backupDir, isTargetVolumeAvailable } = params;
  const finalPath = path.join(targetDir, targetFileName);
  const tmpPath = path.join(targetDir, `.ponyabc-tmp-${crypto.randomBytes(6).toString('hex')}-${targetFileName}.part`);

  if (!isTargetVolumeAvailable()) {
    return { ok: false, reason: 'disconnected', message: 'The pen appears to be disconnected.' };
  }
  if (!fs.existsSync(sourcePath)) {
    return { ok: false, reason: 'not-found', message: 'Source file no longer exists.' };
  }

  let backupPath: string | undefined;
  const existedBefore = fs.existsSync(finalPath);
  if (existedBefore) {
    backupPath = path.join(backupDir, targetFileName);
    try {
      await fs.promises.copyFile(finalPath, backupPath, fs.constants.COPYFILE_EXCL);
    } catch (err) {
      const { message } = classifyError(err);
      return { ok: false, reason: 'backup-failed', message: `Could not back up the existing file before replacing it: ${message}` };
    }
  }

  try {
    const sourceStat = await fs.promises.stat(sourcePath);
    await fs.promises.copyFile(sourcePath, tmpPath, fs.constants.COPYFILE_EXCL);

    const stagedStat = await fs.promises.stat(tmpPath);
    if (stagedStat.size !== sourceStat.size) {
      await unlinkQuiet(tmpPath);
      return { ok: false, reason: 'hash-mismatch', message: 'Staged file size did not match the source; nothing was replaced.', backupPath };
    }

    const [sourceHash, stagedHash] = await Promise.all([sha256File(sourcePath), sha256File(tmpPath)]);
    if (sourceHash !== stagedHash) {
      await unlinkQuiet(tmpPath);
      return { ok: false, reason: 'hash-mismatch', message: 'Staged file did not verify against the source; nothing was replaced.', backupPath };
    }

    if (!isTargetVolumeAvailable()) {
      await unlinkQuiet(tmpPath);
      return { ok: false, reason: 'disconnected', message: 'The pen was disconnected before the write could complete.', backupPath };
    }

    try {
      await fs.promises.rename(tmpPath, finalPath);
    } catch {
      // A handful of FAT/exFAT driver combinations reject rename-over-an-existing-file.
      // The original is already safely backed up (if it existed), so removing it here and
      // retrying the rename is still safe — the verified new content already exists on disk.
      if (existedBefore) await unlinkQuiet(finalPath);
      await fs.promises.rename(tmpPath, finalPath);
    }

    return { ok: true, backupPath };
  } catch (err) {
    await unlinkQuiet(tmpPath);
    const { reason, message } = classifyError(err);
    return { ok: false, reason, message, backupPath };
  }
}
