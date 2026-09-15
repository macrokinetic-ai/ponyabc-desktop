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

/**
 * Resolves only once the read stream's underlying file descriptor is actually closed (the
 * 'close' event), not merely once the last byte has been read ('end') — on Windows, deleting
 * or renaming a file whose read stream fired 'end' but hasn't yet released its OS-level
 * handle can fail (a real, reproducible failure caught via the actual Windows CI runner, not
 * assumed). 'end' still drives when the digest itself is computed; 'close' only gates when
 * the promise resolves, so a caller that immediately unlinks/renames this path next is safe.
 */
export function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    let digest: string | null = null;
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => {
      digest = hash.digest('hex');
    });
    stream.on('close', () => {
      if (digest !== null) resolve(digest);
    });
    stream.on('error', reject);
  });
}

/**
 * Same core contract as sha256File (digest computed at 'end', promise gated on 'close'), but
 * for an explicit, user-triggered, cancellable verification of a potentially very large file:
 * reports real bytes-read progress as data arrives, and a caller can abort mid-read via
 * `signal` — which destroys the read stream immediately, actually releasing the OS file
 * handle rather than just abandoning the promise. Never used on the safety-critical paths
 * (download verification, the immediately-before-delete re-hash) — those keep using the
 * plain, always-runs-to-completion sha256File above unchanged.
 */
export function sha256FileWithProgress(filePath: string, opts: { onProgress?: (bytesRead: number) => void; signal?: AbortSignal } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    let digest: string | null = null;
    let bytesRead = 0;
    let settled = false;

    function fail(err: unknown) {
      if (settled) return;
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      stream.destroy();
      reject(err);
    }
    function onAbort() {
      fail(new Error('cancelled'));
    }

    // Attach every listener — 'error' included — before any destroy() can possibly happen.
    // Node's EventEmitter throws an uncaught exception for an 'error' event with zero
    // listeners, so destroying the stream (e.g. an already-aborted signal, below) before this
    // point would crash the process instead of rejecting the promise.
    stream.on('data', (chunk) => {
      hash.update(chunk);
      bytesRead += chunk.length;
      opts.onProgress?.(bytesRead);
    });
    stream.on('end', () => {
      digest = hash.digest('hex');
    });
    stream.on('close', () => {
      if (settled) return;
      if (digest === null) return; // destroyed before 'end' — fail() already settled the promise
      settled = true;
      opts.signal?.removeEventListener('abort', onAbort);
      resolve(digest);
    });
    stream.on('error', fail);

    if (opts.signal) {
      if (opts.signal.aborted) {
        fail(new Error('cancelled'));
        return;
      }
      opts.signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

async function unlinkQuiet(p: string): Promise<void> {
  await fs.promises.unlink(p).catch(() => {});
}

export type DownloadFilePhase = 'downloading' | 'verifying' | 'done' | 'failed' | 'cancelled';

export interface DownloadFileProgressEvent {
  bytesReceived: number;
  totalBytes: number;
  phase: DownloadFilePhase;
}

export type DownloadFileOutcome =
  | { status: 'ok'; sizeBytes: number; sha256: string }
  | { status: 'cancelled' }
  /** actualSha256 is null when the size itself already didn't match (no point hashing). */
  | { status: 'hash-mismatch'; actualSizeBytes: number; actualSha256: string | null }
  | { status: 'network-error'; message: string };

/**
 * Generic streaming download + verify core, extracted (behavior-preserving) from
 * bookDownload.ts's original inline `runDownload` so firmwareDownload.ts can reuse the exact
 * same, already-hardened Electron stream-handling — see the comment on the WHATWG reader below,
 * which is the load-bearing part of this function and must never be replaced with
 * `Readable.fromWeb` + `stream/promises.pipeline`.
 *
 * Downloads `url` into `destTmpPath` (the caller picks the temp path and is responsible for
 * renaming it into its own final location on `status: 'ok'` — this function never renames).
 * `expectedSha256` may be null to skip hash verification (size is still checked) — used for a
 * release whose catalog entry doesn't carry a trustworthy hash.
 */
export async function downloadFile(params: {
  url: string;
  destTmpPath: string;
  expectedSize: number;
  expectedSha256: string | null;
  signal: AbortSignal;
  onProgress?: (e: DownloadFileProgressEvent) => void;
  fetchFn?: typeof fetch;
}): Promise<DownloadFileOutcome> {
  const { url, destTmpPath, expectedSize, expectedSha256, signal, onProgress } = params;
  const fetchFn = params.fetchFn ?? fetch;

  fs.mkdirSync(path.dirname(destTmpPath), { recursive: true });
  onProgress?.({ bytesReceived: 0, totalBytes: expectedSize, phase: 'downloading' });

  let response: Response;
  try {
    response = await fetchFn(url, { signal });
  } catch (err) {
    if (signal.aborted) return { status: 'cancelled' };
    return { status: 'network-error', message: err instanceof Error ? err.message : String(err) };
  }
  if (!response.ok || !response.body) {
    return { status: 'network-error', message: `Server returned ${response.status}.` };
  }

  let bytesReceived = 0;
  const writeStream = fs.createWriteStream(destTmpPath);
  try {
    // Deliberately NOT `Readable.fromWeb(response.body)` + `stream/promises.pipeline` — that
    // interop was confirmed (via a real Electron main-process run, reproduced against the
    // real live API: exact declared byte COUNT arrived, but the computed SHA-256 didn't match
    // — the identical code against the identical URL was byte-correct in plain Node) to
    // silently corrupt bytes somewhere in Electron's WHATWG-stream-to-Node-stream conversion,
    // without ever throwing or changing the total length. Reading the WHATWG stream directly
    // via its own reader avoids that conversion layer entirely.
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();
    // Race each read against the abort signal directly, rather than trusting reader.cancel()
    // to make a pending read() settle — cancellation propagation through a stream is exactly
    // the class of interop this file has already found to be unreliable in practice. This is
    // also why reader.cancel() is only ever called AFTER the race, as pure cleanup in the
    // catch block below — calling it as part of the race itself is actively wrong: per the
    // streams spec, canceling a reader makes its PENDING read() resolve as `{done: true}` (a
    // normal-completion signal), not reject — so if a cancel-on-abort listener fires before
    // the rejection listener below, the race can resolve as "finished successfully" with a
    // truncated read instead of surfacing as an abort (confirmed by a real failing test: it
    // silently produced a false 'hash-mismatch' instead of 'cancelled').
    let rejectOnAbort!: () => void;
    const abortRejection = new Promise<never>((_, reject) => {
      rejectOnAbort = () => reject(new DOMException('Aborted', 'AbortError'));
      if (signal.aborted) rejectOnAbort();
      else signal.addEventListener('abort', rejectOnAbort, { once: true });
    });
    abortRejection.catch(() => {}); // never left unhandled if it rejects after the loop already moved on
    try {
      for (;;) {
        const { done, value } = await Promise.race([reader.read(), abortRejection]);
        if (done) break;
        bytesReceived += value.byteLength;
        if (bytesReceived > expectedSize) {
          throw new Error('Downloaded more bytes than the declared size.');
        }
        onProgress?.({ bytesReceived, totalBytes: expectedSize, phase: 'downloading' });
        if (!writeStream.write(value)) {
          await new Promise<void>((resolve) => writeStream.once('drain', resolve));
        }
      }
    } finally {
      signal.removeEventListener('abort', rejectOnAbort);
      if (signal.aborted) reader.cancel().catch(() => {});
    }
    await new Promise<void>((resolve, reject) => {
      writeStream.end((err: NodeJS.ErrnoException | null | undefined) => (err ? reject(err) : resolve()));
    });
  } catch (err) {
    // Wait for the write stream to actually finish closing before unlinking — destroy() can
    // be called while the stream's own fs.open() is still in flight (e.g. the very first
    // chunk already failed validation, before any write() ever happened), and an unlink
    // issued immediately can race ahead of that pending open, missing the file it then
    // creates a moment later and leaving an orphaned empty temp file behind.
    await new Promise<void>((resolve) => {
      writeStream.once('close', resolve);
      writeStream.destroy();
    });
    await unlinkQuiet(destTmpPath);
    if (signal.aborted) {
      onProgress?.({ bytesReceived, totalBytes: expectedSize, phase: 'cancelled' });
      return { status: 'cancelled' };
    }
    onProgress?.({ bytesReceived, totalBytes: expectedSize, phase: 'failed' });
    return { status: 'network-error', message: err instanceof Error ? err.message : String(err) };
  }

  onProgress?.({ bytesReceived, totalBytes: expectedSize, phase: 'verifying' });

  const stagedStat = await fs.promises.stat(destTmpPath);
  if (stagedStat.size !== expectedSize) {
    await unlinkQuiet(destTmpPath);
    onProgress?.({ bytesReceived, totalBytes: expectedSize, phase: 'failed' });
    return { status: 'hash-mismatch', actualSizeBytes: stagedStat.size, actualSha256: null };
  }
  const stagedHash = await sha256File(destTmpPath);
  if (expectedSha256 !== null && stagedHash !== expectedSha256) {
    await unlinkQuiet(destTmpPath);
    onProgress?.({ bytesReceived, totalBytes: expectedSize, phase: 'failed' });
    return { status: 'hash-mismatch', actualSizeBytes: stagedStat.size, actualSha256: stagedHash };
  }

  onProgress?.({ bytesReceived, totalBytes: expectedSize, phase: 'done' });
  return { status: 'ok', sizeBytes: stagedStat.size, sha256: stagedHash };
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
