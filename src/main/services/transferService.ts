import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type WriteFailureReason =
  | 'not-found'
  | 'permission'
  | 'no-space'
  | 'io-error'
  | 'disconnected'
  | 'device-changed'
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
 * target filename. Order of operations, chosen specifically so a crash or mid-operation
 * device swap at any point leaves a recoverable state and the original is never deleted
 * before its replacement is fully staged and verified:
 *
 *   1. `verifyStillSameTarget()` is checked before backing up, again right after backing up,
 *      again right after staging+verifying the new content, and again right before the final
 *      rename — never just once up front. The moment it returns false, nothing further is
 *      touched: a backup already made (it lives on the computer, not the pen) is harmless to
 *      keep, but no write/rename/delete happens on what might now be a *different* physical
 *      device mounted at the same path. `verifyStillSameTarget` must itself be based on more
 *      than raw path existence or a bare `stat.dev` snapshot — see session.ts's generation
 *      counter, which is what the callers here use.
 *   2. If a file already exists at the target, copy it (byte for byte, original name) into
 *      `backupDir` first. If that copy fails for any reason, stop — nothing on the target is
 *      touched, and the whole write is reported as failed with reason 'backup-failed'.
 *   3. Copy the source into a temp file *in the same target directory* (so the final swap is
 *      a same-volume rename, not a cross-volume copy).
 *   4. Verify the staged temp file's size and SHA-256 against the source.
 *   5. Attempt exactly ONE rename of the verified temp file over the final target path. This
 *      is atomic-or-nothing on both POSIX and Windows and succeeds in the overwhelming
 *      majority of cases. If it fails, this does NOT retry, move the original aside, or
 *      attempt any other recovery — the original is left completely untouched at its normal
 *      path, and the failure is reported as-is.
 *
 *      (An earlier version of this function fell back to a multi-step "move the original
 *      aside, retry the swap, move it back on failure" recovery. That introduced its own
 *      device-swap gap: nothing re-checked `verifyStillSameTarget()` between the move-aside
 *      succeeding and the retry, so a device change in that window could write onto a
 *      *different* device before deleting the moved-aside original from wherever it had
 *      ended up. A single attempt with no fallback is simpler and cannot have that gap.)
 *
 * Temp-file cleanup after a failed rename only happens if `verifyStillSameTarget()` still
 * confirms the same device — if the identity is no longer trusted, the temp file (which
 * never matches the .mp3 filter, so it can't appear as a recording) is left in place rather
 * than touching a disk that might now belong to a different pen.
 *
 * This does not — and cannot — guarantee power-loss atomicity on FAT32/exFAT (the common SD
 * card filesystems): a same-volume rename is fast and typically near-atomic in practice, but
 * neither filesystem journals renames the way e.g. ext4 does. What IS guaranteed: the
 * original file's bytes are never deleted, moved, or otherwise touched before a verified
 * replacement has already been renamed into place successfully.
 */
export async function safeWriteFile(params: {
  sourcePath: string;
  targetDir: string;
  targetFileName: string;
  /** Must already exist; dedicated to this operation batch so backups never collide. */
  backupDir: string;
  /** Returns false the instant the write target should no longer be trusted as the same
   *  device this operation started against (disconnected, or a different pen now mounted at
   *  the same path). Must be based on the caller's authoritative identity tracking (a
   *  generation/epoch counter), not solely on this function re-`stat`ing the path itself. */
  verifyStillSameTarget: () => boolean;
}): Promise<SafeWriteResult> {
  const { sourcePath, targetDir, targetFileName, backupDir, verifyStillSameTarget } = params;
  const finalPath = path.join(targetDir, targetFileName);
  const tmpPath = path.join(targetDir, `.ponyabc-tmp-${crypto.randomBytes(6).toString('hex')}-${targetFileName}.part`);

  if (!verifyStillSameTarget()) {
    return { ok: false, reason: 'device-changed', message: 'The pen changed before this file could be written; nothing was touched.' };
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

  if (!verifyStillSameTarget()) {
    // The backup (if made) lives on the computer and is harmless to keep — but the pen is no
    // longer trusted, so we stop here without staging or writing anything to it.
    return { ok: false, reason: 'device-changed', message: 'The pen changed right after backing up the original; nothing on the pen was modified.', backupPath };
  }

  try {
    const sourceStat = await fs.promises.stat(sourcePath);
    await fs.promises.copyFile(sourcePath, tmpPath, fs.constants.COPYFILE_EXCL);

    const stagedStat = await fs.promises.stat(tmpPath);
    if (stagedStat.size !== sourceStat.size) {
      if (verifyStillSameTarget()) await unlinkQuiet(tmpPath);
      return { ok: false, reason: 'hash-mismatch', message: 'Staged file size did not match the source; nothing was replaced.', backupPath };
    }

    const [sourceHash, stagedHash] = await Promise.all([sha256File(sourcePath), sha256File(tmpPath)]);
    if (sourceHash !== stagedHash) {
      if (verifyStillSameTarget()) await unlinkQuiet(tmpPath);
      return { ok: false, reason: 'hash-mismatch', message: 'Staged file did not verify against the source; nothing was replaced.', backupPath };
    }

    if (!verifyStillSameTarget()) {
      // A fully-verified replacement sits at tmpPath, but this is no longer the trusted
      // device — do NOT rename, delete, or otherwise touch it or `finalPath` further. The
      // original (if any) is completely untouched; tmpPath is left in place (its name never
      // matches the .mp3 filter, so it can't appear as a recording).
      return { ok: false, reason: 'device-changed', message: 'The pen changed before the write could be finalized; the original file was not modified.', backupPath };
    }

    try {
      await fs.promises.rename(tmpPath, finalPath);
      return { ok: true, backupPath };
    } catch (renameErr) {
      const { reason, message } = classifyError(renameErr);
      if (verifyStillSameTarget()) {
        // We never touched finalPath, and the device is still confirmed the same one — safe
        // to state the original is exactly as it was, and to clean up our own temp file.
        await unlinkQuiet(tmpPath);
        return { ok: false, reason, message: `${message} The original file was not modified.`, backupPath };
      }
      // The device is no longer trusted (it may have changed at the exact moment the rename
      // failed). Do NOT touch tmpPath — it may now sit on a different physical device — and
      // do NOT claim to know the original's state there; only report what's actually known.
      return {
        ok: false,
        reason: 'device-changed',
        message: `${message} The pen changed immediately after this failure; the original file's state on it could not be confirmed.`,
        backupPath,
      };
    }
  } catch (err) {
    if (verifyStillSameTarget()) await unlinkQuiet(tmpPath);
    const { reason, message } = classifyError(err);
    return { ok: false, reason, message, backupPath };
  }
}
