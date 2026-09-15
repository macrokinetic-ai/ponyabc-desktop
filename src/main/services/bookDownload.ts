import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { BookCacheEntry, BookCatalogEntry, BookDownloadProgressEvent } from '@shared/types';
import { isInstallEligible } from './bookStatus';
import { downloadFile } from './transferService';

export type DownloadOutcome =
  | { status: 'ok'; cacheEntry: BookCacheEntry }
  | { status: 'no-space' }
  | { status: 'cancelled' }
  /** actualSha256 is null when the size itself already didn't match (no point hashing).
   *  Carried through so a caller can report exactly which book failed and by how much,
   *  never just a generic "verification failed." */
  | { status: 'hash-mismatch'; actualSizeBytes: number; actualSha256: string | null }
  | { status: 'metadata-incomplete' }
  | { status: 'network-error'; message: string };

export function cacheFilePath(cacheDir: string, contentId: string, sha256: string): string {
  return path.join(cacheDir, `${contentId}-${sha256}.axb`);
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

  // The actual streaming download + verify core lives in transferService.ts's downloadFile()
  // now — shared with the official firmware download flow. See that function's own doc for why
  // it reads the WHATWG stream directly (never `Readable.fromWeb`).
  const outcome = await downloadFile({
    url: entry.downloadUrl,
    destTmpPath: tmpPath,
    expectedSize: entry.sizeBytes,
    expectedSha256: entry.sha256,
    signal,
    fetchFn,
    onProgress: (e) => onProgress?.({ contentId: entry.contentId, ...e }),
  });

  if (outcome.status !== 'ok') {
    // downloadFile() already unlinks its own tmp file on every non-'ok' outcome — nothing left
    // to clean up here. Every field/shape below matches what the inline implementation used to
    // return directly, so this mapping is a pure pass-through, not new behavior.
    return outcome;
  }

  const finalPath = cacheFilePath(cacheDir, entry.contentId, outcome.sha256);
  await fs.promises.rename(tmpPath, finalPath);

  return {
    status: 'ok',
    cacheEntry: { contentId: entry.contentId, sha256: outcome.sha256, sizeBytes: outcome.sizeBytes, filename: entry.filename, cachedAtMs: Date.now() },
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
