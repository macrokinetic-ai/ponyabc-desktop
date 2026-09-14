import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BookCacheEntry, BookCatalogEntry, BookDownloadProgressEvent } from '@shared/types';
import { isInstallEligible } from './bookStatus';
import { sha256File } from './transferService';

export type DownloadOutcome =
  | { status: 'ok'; cacheEntry: BookCacheEntry }
  | { status: 'no-space' }
  | { status: 'cancelled' }
  | { status: 'hash-mismatch' }
  | { status: 'metadata-incomplete' }
  | { status: 'network-error'; message: string };

export function cacheFilePath(cacheDir: string, contentId: string, sha256: string): string {
  return path.join(cacheDir, `${contentId}-${sha256}.axb`);
}

async function unlinkQuiet(p: string): Promise<void> {
  await fs.promises.unlink(p).catch(() => {});
}

async function defaultGetFreeBytes(targetPath: string): Promise<number> {
  const stat = await fs.promises.statfs(targetPath);
  return stat.bavail * stat.bsize;
}

interface InFlight {
  controller: AbortController;
  promise: Promise<DownloadOutcome>;
}

const inFlight = new Map<string, InFlight>();

export function isDownloadInFlight(contentId: string): boolean {
  return inFlight.has(contentId);
}

async function runDownload(params: {
  entry: BookCatalogEntry;
  cacheDir: string;
  fetchFn: typeof fetch;
  signal: AbortSignal;
  onProgress?: (e: BookDownloadProgressEvent) => void;
  getFreeBytesFn: (p: string) => Promise<number>;
}): Promise<DownloadOutcome> {
  const { entry, cacheDir, fetchFn, signal, onProgress, getFreeBytesFn } = params;

  fs.mkdirSync(cacheDir, { recursive: true });
  let freeBytes = 0;
  try {
    freeBytes = await getFreeBytesFn(cacheDir);
  } catch {
    freeBytes = 0;
  }
  if (freeBytes < entry.sizeBytes) return { status: 'no-space' };

  const tmpPath = path.join(cacheDir, `.ponyabc-dl-${crypto.randomBytes(6).toString('hex')}.part`);
  onProgress?.({ contentId: entry.contentId, bytesReceived: 0, totalBytes: entry.sizeBytes, phase: 'downloading' });

  let response: Response;
  try {
    response = await fetchFn(entry.downloadUrl, { signal });
  } catch (err) {
    if (signal.aborted) return { status: 'cancelled' };
    return { status: 'network-error', message: err instanceof Error ? err.message : String(err) };
  }
  if (!response.ok || !response.body) {
    return { status: 'network-error', message: `Server returned ${response.status}.` };
  }

  let bytesReceived = 0;
  const writeStream = fs.createWriteStream(tmpPath);
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
        if (bytesReceived > entry.sizeBytes) {
          throw new Error('Downloaded more bytes than the declared size.');
        }
        onProgress?.({ contentId: entry.contentId, bytesReceived, totalBytes: entry.sizeBytes, phase: 'downloading' });
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
    await unlinkQuiet(tmpPath);
    if (signal.aborted) {
      onProgress?.({ contentId: entry.contentId, bytesReceived, totalBytes: entry.sizeBytes, phase: 'cancelled' });
      return { status: 'cancelled' };
    }
    onProgress?.({ contentId: entry.contentId, bytesReceived, totalBytes: entry.sizeBytes, phase: 'failed' });
    return { status: 'network-error', message: err instanceof Error ? err.message : String(err) };
  }

  onProgress?.({ contentId: entry.contentId, bytesReceived, totalBytes: entry.sizeBytes, phase: 'verifying' });

  const stagedStat = await fs.promises.stat(tmpPath);
  if (stagedStat.size !== entry.sizeBytes) {
    await unlinkQuiet(tmpPath);
    onProgress?.({ contentId: entry.contentId, bytesReceived, totalBytes: entry.sizeBytes, phase: 'failed' });
    return { status: 'hash-mismatch' };
  }
  const stagedHash = await sha256File(tmpPath);
  if (entry.sha256 !== null && stagedHash !== entry.sha256) {
    await unlinkQuiet(tmpPath);
    onProgress?.({ contentId: entry.contentId, bytesReceived, totalBytes: entry.sizeBytes, phase: 'failed' });
    return { status: 'hash-mismatch' };
  }

  const finalPath = cacheFilePath(cacheDir, entry.contentId, stagedHash);
  await fs.promises.rename(tmpPath, finalPath);
  onProgress?.({ contentId: entry.contentId, bytesReceived, totalBytes: entry.sizeBytes, phase: 'done' });

  return {
    status: 'ok',
    cacheEntry: { contentId: entry.contentId, sha256: stagedHash, sizeBytes: stagedStat.size, filename: entry.filename, cachedAtMs: Date.now() },
  };
}

/**
 * Downloads `entry` into `cacheDir`, streaming (never reading the whole file into memory).
 * A second call for the same contentId while one is already in flight JOINS that same
 * promise rather than starting a duplicate transfer — unless `forceFresh` is set (used by
 * "reinstall"), in which case the existing in-flight download is aborted first and a brand
 * new one started. Refuses to start at all unless the catalog entry is install-eligible
 * (declared filename + a trustworthy hash) — this is the real enforcement point, not a UI
 * hint.
 */
export function downloadToCache(params: {
  entry: BookCatalogEntry;
  cacheDir: string;
  forceFresh?: boolean;
  fetchFn?: typeof fetch;
  onProgress?: (e: BookDownloadProgressEvent) => void;
  getFreeBytesFn?: (p: string) => Promise<number>;
}): Promise<DownloadOutcome> {
  const { entry, cacheDir, forceFresh, onProgress } = params;
  const fetchFn = params.fetchFn ?? fetch;
  const getFreeBytesFn = params.getFreeBytesFn ?? defaultGetFreeBytes;

  if (!isInstallEligible(entry)) return Promise.resolve({ status: 'metadata-incomplete' });

  const existing = inFlight.get(entry.contentId);
  if (existing && !forceFresh) return existing.promise;
  if (existing && forceFresh) existing.controller.abort();

  const controller = new AbortController();
  const promise = runDownload({ entry, cacheDir, fetchFn, signal: controller.signal, onProgress, getFreeBytesFn }).finally(() => {
    const cur = inFlight.get(entry.contentId);
    if (cur && cur.controller === controller) inFlight.delete(entry.contentId);
  });
  inFlight.set(entry.contentId, { controller, promise });
  return promise;
}

/** Aborts an in-flight download for contentId, if any. Returns false if none was in flight. */
export function cancelDownload(contentId: string): boolean {
  const cur = inFlight.get(contentId);
  if (!cur) return false;
  cur.controller.abort();
  return true;
}
