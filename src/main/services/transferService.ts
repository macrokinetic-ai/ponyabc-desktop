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
  /** Set only in the rare case a multi-step swap failed AFTER the original was moved aside —
   *  its bytes are intact at this path (not `finalPath`) and were not deleted. */
  originalPreservedAt?: string;
  /** True once we've confirmed the original was successfully moved back to its normal name
   *  despite the replace failing — i.e. the pen was left exactly as it started. */
  originalRestored?: boolean;
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

type SwapResult =
  | { ok: true }
  | { ok: false; reason: WriteFailureReason; message: string; originalPreservedAt?: string; originalRestored?: boolean };

/**
 * Puts the verified `tmpPath` in place at `finalPath`. A plain rename-over-existing is
 * atomic-or-nothing on both POSIX and Windows (libuv's rename uses MoveFileEx with
 * MOVEFILE_REPLACE_EXISTING there) and succeeds in the overwhelming majority of cases — a
 * failure here is NOT generally "this filesystem doesn't support overwrite", so it must
 * never be treated as license to unconditionally delete the original. If it does fail and
 * there IS an original to protect, this falls back to a safe multi-step swap: move the
 * original aside by renaming it (never deleting it), attempt the swap again, and — if that
 * second attempt also fails — rename the original straight back. The original's bytes are
 * never deleted at any point in this function; the worst case leaves it intact under a
 * differently-named file instead of its normal name, with that path reported back.
 */
async function swapIntoPlace(
  tmpPath: string,
  finalPath: string,
  existedBefore: boolean,
  verifyStillSameTarget: () => boolean,
): Promise<SwapResult> {
  try {
    await fs.promises.rename(tmpPath, finalPath);
    return { ok: true };
  } catch (firstErr) {
    if (!existedBefore) {
      const { reason, message } = classifyError(firstErr);
      return { ok: false, reason, message };
    }
    // else: an original exists to protect — fall through to the guarded recovery below.
  }

  // The direct overwrite failed and there's an original at stake. An EIO here can itself be
  // the first sign of a disconnect — re-confirm identity before touching anything further;
  // if it's no longer trusted, stop now and leave the original exactly where it is.
  if (!verifyStillSameTarget()) {
    return { ok: false, reason: 'device-changed', message: 'The pen changed while finishing the replace; the original file was left in place.' };
  }

  const heldPath = `${finalPath}.ponyabc-original-${crypto.randomBytes(4).toString('hex')}`;
  try {
    await fs.promises.rename(finalPath, heldPath); // move aside, never delete
  } catch (moveAsideErr) {
    const { message } = classifyError(moveAsideErr);
    return { ok: false, reason: 'io-error', message: `Could not complete the replace, and the original file is unchanged (${message}).` };
  }

  try {
    await fs.promises.rename(tmpPath, finalPath);
    // Succeeded — the held copy is now redundant (a proper backup already exists in
    // backupDir on the computer); remove this on-pen leftover rather than stray it there.
    await unlinkQuiet(heldPath);
    return { ok: true };
  } catch (secondErr) {
    const { message: secondMessage } = classifyError(secondErr);
    try {
      await fs.promises.rename(heldPath, finalPath); // restore the original
      return {
        ok: false,
        reason: 'io-error',
        message: `Could not finish replacing the file; the original was restored (${secondMessage}).`,
        originalRestored: true,
      };
    } catch (restoreErr) {
      // Worst case: the original is not back under its normal name, but it still exists,
      // completely intact, at heldPath — report that path explicitly. The backup made
      // earlier on the computer (if any) remains the ultimate safety net either way.
      const { message: restoreMessage } = classifyError(restoreErr);
      return {
        ok: false,
        reason: 'io-error',
        message: `Could not finish replacing the file (${secondMessage}), and could not restore the original to its normal name (${restoreMessage}).`,
        originalPreservedAt: heldPath,
        originalRestored: false,
      };
    }
  }
}

/**
 * Safely writes `sourcePath`'s content to `targetDir/targetFileName`, preserving the exact
 * target filename. Order of operations, chosen specifically so a crash, disconnect, or
 * mid-operation device swap at any point leaves a recoverable state and the original is
 * never deleted before its replacement is fully staged and verified:
 *
 *   1. `verifyStillSameTarget()` is checked before backing up, again right after backing up,
 *      again right after staging+verifying the new content, and again inside the final swap
 *      if the fast-path rename fails — never just once up front. The moment it returns
 *      false, nothing further is touched: a backup already made (it lives on the computer,
 *      not the pen) is harmless to keep, but no write/rename/delete happens on what might now
 *      be a *different* physical device mounted at the same path. `verifyStillSameTarget`
 *      must itself be based on more than raw path existence or a bare `stat.dev` snapshot —
 *      see session.ts's generation counter, which is what the callers here use.
 *   2. If a file already exists at the target, copy it (byte for byte, original name) into
 *      `backupDir` first. If that copy fails for any reason, stop — nothing on the target is
 *      touched, and the whole write is reported as failed with reason 'backup-failed'.
 *   3. Copy the source into a temp file *in the same target directory* (so the final swap is
 *      a same-volume rename, not a cross-volume copy).
 *   4. Verify the staged temp file's size and SHA-256 against the source.
 *   5. Only then swap the verified temp file into place — see swapIntoPlace() above for the
 *      failure-safe multi-step fallback if the direct rename doesn't succeed.
 *
 * This does not — and cannot — guarantee power-loss atomicity on FAT32/exFAT (the common SD
 * card filesystems): renames there are fast and typically near-atomic in practice, but
 * neither filesystem journals renames the way e.g. ext4 does. What IS guaranteed: the
 * original file's bytes are never deleted before either a verified replacement is safely in
 * place, or the original itself has been moved back / is reported at a known, intact path.
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

    const swap = await swapIntoPlace(tmpPath, finalPath, existedBefore, verifyStillSameTarget);
    if (!swap.ok) {
      if (swap.reason !== 'device-changed' && verifyStillSameTarget()) await unlinkQuiet(tmpPath);
      return { ok: false, reason: swap.reason, message: swap.message, backupPath, originalPreservedAt: swap.originalPreservedAt, originalRestored: swap.originalRestored };
    }
    return { ok: true, backupPath };
  } catch (err) {
    if (verifyStillSameTarget()) await unlinkQuiet(tmpPath);
    const { reason, message } = classifyError(err);
    return { ok: false, reason, message, backupPath };
  }
}
