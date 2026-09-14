import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type {
  BookActionResult,
  BookBackupEntry,
  BookBackupSummary,
  BookCacheEntry,
  BookCatalogCheck,
  BookCatalogEntry,
  BookCatalogSnapshot,
  BookListResult,
  BookRemoveResult,
  BookVerifyUpdateEvent,
  DiagnosticEntry,
} from '@shared/types';
import { resolvePenRoot } from '../services/pathSecurity';
import * as session from '../services/session';
import { createJsonStore } from '../services/bookStore';
import { buildBookLibrary, listPenBookFiles, verifyPendingHash, type PendingVerification } from '../services/bookReconcile';
import { validateCatalogEntries } from '../services/bookCatalogValidate';
import { createHttpBookCatalogClient } from '../services/bookCatalog/httpClient';
import { addToPen, reinstall, replaceWithOfficial } from '../services/bookInstall';
import { removeFromPen } from '../services/bookRemove';
import { restoreFromBackup } from '../services/bookRestore';
import { cancelDownload } from '../services/bookDownload';
import { makeBackupDir } from '../services/transferPlanner';
import { appendDiagnostic } from '../services/diagnostics';

// Hardcoded — the renderer has no way to influence which host this reads from. Secret-free
// public endpoint (Option A): no Authorization header, nothing embedded to protect.
const BOOK_API_BASE_URL = 'https://register.ponyabc.uk';

function dirs() {
  const userData = app.getPath('userData');
  return {
    catalogFile: path.join(userData, 'bookCatalogCache', 'catalog.json'),
    cacheDir: path.join(userData, 'bookCache'),
    cacheManifestFile: path.join(userData, 'bookCache', 'manifest.json'),
    backupDir: path.join(userData, 'backups', 'book'),
    backupManifestFile: path.join(userData, 'backups', 'book', 'manifest.json'),
    scratchBackupRootDir: path.join(userData, 'backups', 'book-scratch'),
    diagnosticsFile: path.join(userData, 'diagnostics.json'),
  };
}

const catalogStore = () => createJsonStore<BookCatalogSnapshot | null>(dirs().catalogFile, () => null);
const cacheManifestStore = () => createJsonStore<BookCacheEntry[]>(dirs().cacheManifestFile, () => []);
const backupManifestStore = () => createJsonStore<BookBackupEntry[]>(dirs().backupManifestFile, () => []);
export const diagnosticsStore = () => createJsonStore<DiagnosticEntry[]>(dirs().diagnosticsFile, () => []);

/** The outcome of the most recent catalog fetch attempt this run — kept in memory only (a
 *  fresh attempt always happens again on the next launch via the renderer's mount effect, so
 *  there is no need to persist this across restarts, and doing so would risk showing a
 *  stale "ok" from a previous session before that fresh attempt has actually run). */
let lastCatalogCheck: BookCatalogCheck | null = null;

function findCacheEntryByHash(sha256: string): { contentId: string; sha256: string } | null {
  const c = cacheManifestStore()
    .get()
    .find((e) => e.sha256 === sha256);
  return c ? { contentId: c.contentId, sha256: c.sha256 } : null;
}

function backupDeps() {
  const { backupDir, cacheDir } = dirs();
  return {
    backupDir,
    cacheDir,
    getBackupEntries: () => backupManifestStore().get(),
    saveBackupEntry: (e: BookBackupEntry) => backupManifestStore().update((cur) => [...cur, e]),
    findCacheEntryByHash,
  };
}

function currentPenBookFiles(): { files: ReturnType<typeof listPenBookFiles> | null; bookDirReal: string | null } {
  const penRoot = session.getPenRoot();
  if (!penRoot) return { files: null, bookDirReal: null };
  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status !== 'ok') return { files: null, bookDirReal: null };
  return { files: listPenBookFiles(fresh.bookDirReal), bookDirReal: fresh.bookDirReal };
}

/** Fast: never hashes a pen file's content, so listing is never blocked on a large AXB —
 *  matched files whose current/differs status still needs a hash come back 'verifying', and
 *  the caller (bookList/bookCatalogRefresh, which have a window to push to) kicks off
 *  verifyPendingList for whatever's pending. */
function computeCurrentList(): { result: BookListResult; pending: PendingVerification[]; bookDirReal: string | null } {
  const snapshot = catalogStore().get();
  const cacheEntries = cacheManifestStore().get();
  const { files, bookDirReal } = currentPenBookFiles();
  const { penItems, catalogItems, pending } = buildBookLibrary({ snapshot, cacheEntries, penFiles: files, bookDirReal });
  return {
    result: {
      status: 'ok',
      penItems,
      catalogItems,
      meta: {
        fetchedAtMs: snapshot?.fetchedAtMs ?? null,
        source: snapshot?.source ?? 'none',
        offline: snapshot === null,
        conflicts: snapshot?.conflicts ?? [],
        lastCheck: lastCatalogCheck,
      },
    },
    pending,
    bookDirReal,
  };
}

async function currentList(): Promise<BookListResult> {
  return computeCurrentList().result;
}

/** Guards against hashing the same pen file twice concurrently (e.g. the renderer's mount
 *  effect calls bookList() then bookCatalogRefresh() moments later, each producing the same
 *  pending file) — a second request for a fileName already being verified is simply skipped,
 *  never a duplicate read/hash of a potentially very large AXB. */
const verifyInFlight = new Set<string>();

async function verifyPendingList(window: BrowserWindow, bookDirReal: string, pending: PendingVerification[], capturedGeneration: number): Promise<void> {
  for (const item of pending) {
    if (verifyInFlight.has(item.fileName)) continue;
    verifyInFlight.add(item.fileName);
    try {
      if (session.getGeneration() !== capturedGeneration) return; // pen changed/disconnected — stale, abort silently
      const outcome = await verifyPendingHash(bookDirReal, item);
      if (session.getGeneration() !== capturedGeneration) return;
      const event: BookVerifyUpdateEvent =
        outcome === null
          ? { fileName: item.fileName, contentId: item.contentId, result: null }
          : {
              fileName: item.fileName,
              contentId: item.contentId,
              result: {
                penStatus: outcome === 'current' ? 'matched-current' : 'matched-differs',
                catalogStatus: outcome === 'current' ? 'on-pen-current' : 'on-pen-differs',
              },
            };
      try {
        window.webContents.send(IPC.bookVerifyUpdate, event);
      } catch {
        return; // window already gone — nothing left to notify
      }
    } finally {
      verifyInFlight.delete(item.fileName);
    }
  }
}

export function bookList(window: BrowserWindow): Promise<BookListResult> {
  const { result, pending, bookDirReal } = computeCurrentList();
  if (bookDirReal && pending.length > 0) void verifyPendingList(window, bookDirReal, pending, session.getGeneration());
  return Promise.resolve(result);
}

/** A failed refresh intentionally leaves the previous snapshot completely untouched — never
 *  clears it, never treated as "the server deleted everything." The attempt's own outcome
 *  (success/failure, HTTP status, item count, duration) is tracked separately in
 *  lastCatalogCheck so the UI can always show what actually just happened, distinct from
 *  whether older cached data still exists to fall back on. */
export async function bookCatalogRefresh(window: BrowserWindow): Promise<BookListResult> {
  const client = createHttpBookCatalogClient({ baseUrl: BOOK_API_BASE_URL });
  const requestUrl = `${BOOK_API_BASE_URL}/api/public/books`;
  const startedAtMs = Date.now();
  const outcome = await client.fetchCatalog();
  const durationMs = Date.now() - startedAtMs;

  if (outcome.status === 'ok') {
    const { entries, conflicts } = validateCatalogEntries(outcome.entries);
    catalogStore().set({ entries, fetchedAtMs: Date.now(), source: client.kind, conflicts });
    lastCatalogCheck = { state: 'ok', atMs: Date.now(), httpStatus: 200, itemCount: entries.length, message: null, durationMs };
    appendDiagnostic(diagnosticsStore(), 'catalog-fetch', {
      url: requestUrl,
      httpStatus: 200,
      durationMs,
      outcome: 'ok',
      itemCount: entries.length,
      conflictCount: conflicts.length,
    });
  } else {
    lastCatalogCheck = {
      state: 'error',
      atMs: Date.now(),
      httpStatus: outcome.httpStatus ?? null,
      itemCount: null,
      message: outcome.message,
      durationMs,
    };
    appendDiagnostic(diagnosticsStore(), 'catalog-fetch', {
      url: requestUrl,
      httpStatus: outcome.httpStatus ?? 'unreachable',
      durationMs,
      outcome: 'error',
      message: outcome.message,
    });
  }

  const { result, pending, bookDirReal } = computeCurrentList();
  if (result.penItems !== null) {
    appendDiagnostic(diagnosticsStore(), 'pen-reconcile', {
      axbTotal: result.penItems.length,
      matched: result.penItems.filter((i) => i.status !== 'unknown' && i.status !== 'awaiting-catalog').length,
      unknown: result.penItems.filter((i) => i.status === 'unknown').length,
      awaitingCatalog: result.penItems.filter((i) => i.status === 'awaiting-catalog').length,
      ambiguousCatalogConflicts: result.meta.conflicts.length,
    });
  }
  if (bookDirReal && pending.length > 0) void verifyPendingList(window, bookDirReal, pending, session.getGeneration());
  return result;
}

function findEntry(contentId: string): BookCatalogEntry | null {
  return catalogStore().get()?.entries.find((e) => e.contentId === contentId) ?? null;
}

function installDeps(window: BrowserWindow) {
  const { cacheDir, scratchBackupRootDir } = dirs();
  return {
    cacheDir,
    backupDir: makeBackupDir(scratchBackupRootDir),
    getCacheEntries: () => cacheManifestStore().get(),
    saveCacheEntry: (e: BookCacheEntry) =>
      cacheManifestStore().update((cur) => (cur.some((c) => c.contentId === e.contentId && c.sha256 === e.sha256) ? cur : [...cur, e])),
    onProgress: (event: import('@shared/types').BookDownloadProgressEvent) => window.webContents.send(IPC.bookDownloadProgress, event),
  };
}

async function runInstallAction(
  action: (entry: BookCatalogEntry, penGeneration: number, deps: ReturnType<typeof installDeps>) => Promise<BookActionResult>,
  window: BrowserWindow,
  params: { contentId: string; penGeneration: number },
): Promise<BookActionResult> {
  const entry = findEntry(params.contentId);
  if (!entry) return { status: 'error', message: 'Unknown content id — refresh the catalog and try again.' };
  const result = await action(entry, params.penGeneration, installDeps(window));
  appendDiagnostic(diagnosticsStore(), 'book-download', {
    contentId: entry.contentId,
    filename: entry.filename,
    expectedSizeBytes: entry.sizeBytes,
    expectedSha256: entry.sha256 ?? 'null',
    outcome: result.status,
    message: result.message ?? 'null',
  });
  return result;
}

export const bookAdd = (window: BrowserWindow, params: { contentId: string; penGeneration: number }) => runInstallAction(addToPen, window, params);
export const bookUpdate = (window: BrowserWindow, params: { contentId: string; penGeneration: number }) =>
  runInstallAction(replaceWithOfficial, window, params);
export const bookReinstall = (window: BrowserWindow, params: { contentId: string; penGeneration: number }) =>
  runInstallAction(reinstall, window, params);

/**
 * Removal is categorically refused for anything the pen-reconciliation pass didn't resolve
 * to a matched, removable BOOK — this is the actual enforcement point for "Unknown content
 * is read-only," not merely which button the renderer happens to show. A stale or forged
 * fileName that no longer matches a removable pen item is refused the same way.
 */
export async function bookRemove(params: { fileName: string; penGeneration: number }): Promise<BookRemoveResult> {
  const list = await currentList();
  const item = list.penItems?.find((i) => i.fileName === params.fileName) ?? null;
  // removable is false for every non-matched status ('unknown', 'awaiting-catalog') — this is
  // the actual enforcement, not a specific status string, so a future new non-matched status
  // is refused the same way without needing this check updated again.
  if (!item || !item.removable) {
    return { status: 'unknown-content', message: 'This file is not recognized as a catalog BOOK and cannot be removed here.' };
  }
  const reason = item.status === 'matched-current' ? ('pre-removal-current-version' as const) : ('differs-from-official' as const);

  return removeFromPen({
    fileName: params.fileName,
    penGeneration: params.penGeneration,
    reason,
    matchedContentId: item.contentId,
    backupDeps: backupDeps(),
  });
}

export function bookBackups(): BookBackupSummary[] {
  return backupManifestStore()
    .get()
    .map((e) => ({
      backupId: e.backupId,
      originalFileName: e.originalFileName,
      sizeBytes: e.sizeBytes,
      reason: e.reason,
      matchedContentId: e.matchedContentId,
      createdAtMs: e.createdAtMs,
    }))
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/**
 * Restore is refused for a backup whose reason is 'uncatalogued' — the retired Unknown-
 * content backup/restore path. Existing backup files/manifest entries of that kind are left
 * on disk untouched (never deleted by this change); this only blocks the restore ACTION
 * itself, enforced here rather than merely by omitting a "Restore" button.
 */
export async function bookRestore(params: { backupId: string; penGeneration: number }): Promise<BookActionResult> {
  const backupEntry = backupManifestStore()
    .get()
    .find((e) => e.backupId === params.backupId);
  if (backupEntry && backupEntry.reason === 'uncatalogued') {
    return { status: 'restore-not-allowed', message: 'Restoring unrecognized content back onto the pen is no longer supported.' };
  }
  const { scratchBackupRootDir } = dirs();
  return restoreFromBackup({
    backupId: params.backupId,
    penGeneration: params.penGeneration,
    backupDeps: backupDeps(),
    scratchBackupDir: makeBackupDir(scratchBackupRootDir),
  });
}

export function bookDownloadCancel(contentId: string): { ok: boolean } {
  return { ok: cancelDownload(contentId) };
}
