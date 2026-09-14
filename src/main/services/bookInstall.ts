import fs from 'node:fs';
import type { BookActionResult, BookCacheEntry, BookCatalogEntry, BookDownloadProgressEvent } from '@shared/types';
import { resolvePenRoot } from './pathSecurity';
import { safeWriteFile } from './transferService';
import { cacheFilePath, downloadToCache } from './bookDownload';
import { acquirePenLock } from './penOperationLock';
import { getFreeBytes } from './transferPlanner';
import * as session from './session';

export interface BookInstallDeps {
  cacheDir: string;
  /** A fresh, non-conflicting scratch dir for safeWriteFile's own crash-safety backup of
   *  whatever it overwrites — not the durable un-catalogued-content backup (bookBackup.ts). */
  backupDir: string;
  getCacheEntries: () => BookCacheEntry[];
  saveCacheEntry: (entry: BookCacheEntry) => void;
  onProgress?: (e: BookDownloadProgressEvent) => void;
  fetchFn?: typeof fetch;
  getFreeBytesFn?: (p: string) => Promise<number>;
}

async function resolveCacheFile(
  entry: BookCatalogEntry,
  deps: BookInstallDeps,
  forceFresh: boolean,
): Promise<{ ok: true; path: string } | { ok: false; result: BookActionResult }> {
  if (!forceFresh && entry.sha256 !== null) {
    const existing = deps.getCacheEntries().find((c) => c.contentId === entry.contentId && c.sha256 === entry.sha256);
    if (existing) {
      const cachedPath = cacheFilePath(deps.cacheDir, existing.contentId, existing.sha256);
      if (fs.existsSync(cachedPath)) return { ok: true, path: cachedPath };
    }
  }

  const outcome = await downloadToCache({
    entry,
    cacheDir: deps.cacheDir,
    forceFresh,
    fetchFn: deps.fetchFn,
    onProgress: deps.onProgress,
    getFreeBytesFn: deps.getFreeBytesFn,
  });
  if (outcome.status === 'ok') {
    deps.saveCacheEntry(outcome.cacheEntry);
    return { ok: true, path: cacheFilePath(deps.cacheDir, outcome.cacheEntry.contentId, outcome.cacheEntry.sha256) };
  }
  if (outcome.status === 'no-space') return { ok: false, result: { status: 'no-space' } };
  if (outcome.status === 'cancelled') return { ok: false, result: { status: 'cancelled' } };
  if (outcome.status === 'metadata-incomplete') return { ok: false, result: { status: 'metadata-incomplete' } };
  if (outcome.status === 'network-error') return { ok: false, result: { status: 'network-error', message: outcome.message } };
  // hash-mismatch
  return { ok: false, result: { status: 'error', message: 'Downloaded content did not verify against the declared checksum.' } };
}

async function writeToPen(entry: BookCatalogEntry, cacheFileRealPath: string, penGeneration: number, deps: BookInstallDeps): Promise<BookActionResult> {
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

  const getFreeBytesFn = deps.getFreeBytesFn ?? getFreeBytes;
  let freeBytes = 0;
  try {
    freeBytes = await getFreeBytesFn(fresh.bookDirReal);
  } catch {
    freeBytes = 0;
  }
  if (freeBytes < entry.sizeBytes) return { status: 'no-space' };

  const capturedGeneration = session.getGeneration();
  const bookDirReal = fresh.bookDirReal;
  const verifyStillSameTarget = () => session.getGeneration() === capturedGeneration && fs.existsSync(bookDirReal);

  const release = await acquirePenLock();
  try {
    if (!verifyStillSameTarget()) return { status: 'device-disconnected' };
    const result = await safeWriteFile({
      sourcePath: cacheFileRealPath,
      targetDir: bookDirReal,
      targetFileName: entry.filename,
      backupDir: deps.backupDir,
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

/** "Add to pen": uses a hash-matching cache file directly if one exists, otherwise
 *  downloads first. */
export async function addToPen(entry: BookCatalogEntry, penGeneration: number, deps: BookInstallDeps): Promise<BookActionResult> {
  const cache = await resolveCacheFile(entry, deps, false);
  if (!cache.ok) return cache.result;
  return writeToPen(entry, cache.path, penGeneration, deps);
}

/** "Replace with official version" — identical mechanics to addToPen; the neutral framing
 *  (never "update", never "this is newer") lives in the UI/i18n layer, not here. */
export async function replaceWithOfficial(entry: BookCatalogEntry, penGeneration: number, deps: BookInstallDeps): Promise<BookActionResult> {
  return addToPen(entry, penGeneration, deps);
}

/** "Re-download and reinstall": always fetches fresh, never reuses any existing cache entry
 *  for this content id, even a matching one — for suspected local corruption. */
export async function reinstall(entry: BookCatalogEntry, penGeneration: number, deps: BookInstallDeps): Promise<BookActionResult> {
  const cache = await resolveCacheFile(entry, deps, true);
  if (!cache.ok) return cache.result;
  return writeToPen(entry, cache.path, penGeneration, deps);
}
