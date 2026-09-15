import fs from 'node:fs';
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
  BookVerifyContentResult,
  BookVerifyProgressEvent,
  BookVerifyRecord,
  BookVerifyUpdateEvent,
  DiagnosticEntry,
} from '@shared/types';
import { resolvePenRoot } from '../services/pathSecurity';
import * as session from '../services/session';
import { createJsonStore } from '../services/bookStore';
import { buildBookLibrary, listPenBookFiles, type PenBookFile } from '../services/bookReconcile';
import { validateCatalogEntries } from '../services/bookCatalogValidate';
import { createHttpBookCatalogClient } from '../services/bookCatalog/httpClient';
import { addToPen, reinstall, replaceWithOfficial } from '../services/bookInstall';
import { removeFromPen } from '../services/bookRemove';
import { restoreFromBackup } from '../services/bookRestore';
import { cancelDownload } from '../services/bookDownload';
import { sha256FileWithProgress } from '../services/transferService';
import { upsertVerifyRecord } from '../services/bookVerificationIndex';
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
    // Never on the pen's own SD card — a local, App-managed accelerator only (see
    // bookVerificationIndex.ts). Capped, update-in-place, never an unbounded history.
    verifyRecordsFile: path.join(userData, 'bookVerifyIndex.json'),
  };
}

const catalogStore = () => createJsonStore<BookCatalogSnapshot | null>(dirs().catalogFile, () => null);
const cacheManifestStore = () => createJsonStore<BookCacheEntry[]>(dirs().cacheManifestFile, () => []);
const backupManifestStore = () => createJsonStore<BookBackupEntry[]>(dirs().backupManifestFile, () => []);
const verifyRecordsStore = () => createJsonStore<BookVerifyRecord[]>(dirs().verifyRecordsFile, () => []);
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

function currentPenBookFiles(): { files: PenBookFile[] | null; bookDirReal: string | null; penVolumeLabel: string | null } {
  const penRoot = session.getPenRoot();
  if (!penRoot) return { files: null, bookDirReal: null, penVolumeLabel: null };
  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status !== 'ok') return { files: null, bookDirReal: null, penVolumeLabel: null };
  const penVolumeLabel = path.basename(fresh.realPath) || fresh.realPath;
  return { files: listPenBookFiles(fresh.bookDirReal), bookDirReal: fresh.bookDirReal, penVolumeLabel };
}

/** Fast and hash-free: filenames/sizes/mtimes only (a stat, not a file read), plus whatever a
 *  prior explicit verification already recorded — see bookReconcile.ts. Never blocks on, or
 *  triggers, hashing a pen file's content. */
async function currentList(): Promise<BookListResult> {
  const snapshot = catalogStore().get();
  const cacheEntries = cacheManifestStore().get();
  const { files, penVolumeLabel } = currentPenBookFiles();
  const { penItems, catalogItems } = buildBookLibrary({
    snapshot,
    cacheEntries,
    penFiles: files,
    penVolumeLabel,
    penGeneration: session.getGeneration(),
    verifyRecords: verifyRecordsStore().get(),
  });
  return {
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
  };
}

export function bookList(): Promise<BookListResult> {
  return currentList();
}

/** A failed refresh intentionally leaves the previous snapshot completely untouched — never
 *  clears it, never treated as "the server deleted everything." The attempt's own outcome
 *  (success/failure, HTTP status, item count, duration) is tracked separately in
 *  lastCatalogCheck so the UI can always show what actually just happened, distinct from
 *  whether older cached data still exists to fall back on. This talks to the network for
 *  catalog metadata ONLY — it never downloads an AXB and never reads/hashes a pen file, so it
 *  finishes (and clears the "refreshing" busy state) as soon as that one HTTP request settles,
 *  regardless of how many or how large the files on the pen are. */
export async function bookCatalogRefresh(): Promise<BookListResult> {
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

  const result = await currentList();
  if (result.penItems !== null) {
    appendDiagnostic(diagnosticsStore(), 'pen-reconcile', {
      axbTotal: result.penItems.length,
      matched: result.penItems.filter((i) => i.status !== 'unknown' && i.status !== 'awaiting-catalog').length,
      unknown: result.penItems.filter((i) => i.status === 'unknown').length,
      awaitingCatalog: result.penItems.filter((i) => i.status === 'awaiting-catalog').length,
      ambiguousCatalogConflicts: result.meta.conflicts.length,
    });
  }
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

// ---------------------------------------------------------------------------------------
// Explicit on-pen content verification — a user-triggered batch action, never kicked off
// automatically by bookList/bookCatalogRefresh above. Only one batch runs at a time: starting
// a new one (or an explicit cancel) invalidates whatever's currently in flight via
// currentVerifyBatchId, so a stale batch's results can never land after a newer one started —
// its remaining work simply stops issuing progress/update events.
// ---------------------------------------------------------------------------------------

let currentVerifyBatchId = 0;
let currentVerifyAbort: AbortController | null = null;

export async function bookVerifyContent(window: BrowserWindow, params: { fileNames: string[]; penGeneration: number }): Promise<BookVerifyContentResult> {
  const penRoot = session.getPenRoot();
  if (!penRoot) return { status: 'no-pen-selected' };
  if (params.penGeneration !== session.getGeneration()) return { status: 'stale-plan' };
  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status !== 'ok') return { status: 'device-disconnected' };
  const penVolumeLabel = path.basename(fresh.realPath) || fresh.realPath;
  const bookDirReal = fresh.bookDirReal;
  const capturedGeneration = session.getGeneration();

  const myBatchId = ++currentVerifyBatchId;
  currentVerifyAbort?.abort();
  const abortController = new AbortController();
  currentVerifyAbort = abortController;

  const list = await currentList();
  const targets = params.fileNames
    .map((fileName) => list.penItems?.find((i) => i.fileName === fileName) ?? null)
    // Only ever verify a real, matched, single-catalog-entry pen item — never "unknown"/
    // "awaiting-catalog"/ambiguous, and never a stale/forged fileName the renderer supplies.
    .filter((i): i is NonNullable<typeof i> => i !== null && i.removable && i.contentId !== null);

  const startedAtMs = Date.now();
  let completedCount = 0;
  const totalCount = targets.length;

  void (async () => {
    for (const item of targets) {
      if (myBatchId !== currentVerifyBatchId) return; // superseded by a newer batch/cancel
      if (session.getGeneration() !== capturedGeneration) return; // pen changed — stale, stop silently

      const contentId = item.contentId;
      if (contentId === null) {
        completedCount += 1;
        continue;
      }
      const entry = findEntry(contentId);
      if (!entry || entry.sha256 === null) {
        completedCount += 1;
        continue;
      }

      let lastEmitMs = 0;
      let lastBytesRead = 0;
      const totalBytes = item.sizeBytes;
      const emitProgress = (bytesRead: number, phase: BookVerifyProgressEvent['phase']) => {
        lastBytesRead = bytesRead;
        const now = Date.now();
        if (phase === 'reading' && now - lastEmitMs < 150 && bytesRead < totalBytes) return;
        lastEmitMs = now;
        try {
          window.webContents.send(IPC.bookVerifyProgress, {
            fileName: item.fileName,
            contentId,
            bytesRead,
            totalBytes,
            completedCount,
            totalCount,
            phase,
          } satisfies BookVerifyProgressEvent);
        } catch {
          // window already gone — nothing left to notify
        }
      };

      let observedSha256: string | null = null;
      let readError = false;
      const readStartedAtMs = Date.now();
      try {
        observedSha256 = await sha256FileWithProgress(path.join(bookDirReal, item.fileName), {
          onProgress: (bytesRead) => emitProgress(bytesRead, 'reading'),
          signal: abortController.signal,
        });
      } catch {
        readError = true;
      }
      const readDurationMs = Date.now() - readStartedAtMs;

      if (myBatchId !== currentVerifyBatchId) return;
      completedCount += 1;

      if (abortController.signal.aborted) {
        appendDiagnostic(diagnosticsStore(), 'pen-verify', {
          fileName: item.fileName,
          sizeBytes: totalBytes,
          sdBytesRead: lastBytesRead,
          readDurationMs,
          outcome: 'cancelled',
        });
        emitProgress(lastBytesRead, 'cancelled');
        continue;
      }
      if (readError || observedSha256 === null) {
        appendDiagnostic(diagnosticsStore(), 'pen-verify', {
          fileName: item.fileName,
          sizeBytes: totalBytes,
          sdBytesRead: lastBytesRead,
          readDurationMs,
          outcome: 'read-error',
        });
        emitProgress(lastBytesRead, 'failed');
        const failEvent: BookVerifyUpdateEvent = { fileName: item.fileName, contentId, result: null };
        try {
          window.webContents.send(IPC.bookVerifyUpdate, failEvent);
        } catch {
          // ignore — window gone
        }
        continue;
      }

      emitProgress(totalBytes, 'done');

      let statNow: { sizeBytes: number; mtimeMs: number } | null = null;
      try {
        const s = fs.statSync(path.join(bookDirReal, item.fileName));
        statNow = { sizeBytes: s.size, mtimeMs: s.mtimeMs };
      } catch {
        statNow = null;
      }

      const outcome = observedSha256 === entry.sha256 ? 'current' : 'differs';
      appendDiagnostic(diagnosticsStore(), 'pen-verify', {
        fileName: item.fileName,
        sizeBytes: totalBytes,
        sdBytesRead: totalBytes,
        readDurationMs,
        outcome,
      });

      if (statNow) {
        upsertVerifyRecord(verifyRecordsStore(), {
          penVolumeLabel,
          penGenerationAtVerify: capturedGeneration,
          fileName: item.fileName,
          sizeBytes: statNow.sizeBytes,
          mtimeMs: statNow.mtimeMs,
          observedSha256,
          officialSha256: entry.sha256,
          contentId,
          verifiedAtMs: Date.now(),
        });
      }

      const updateEvent: BookVerifyUpdateEvent = {
        fileName: item.fileName,
        contentId,
        result: {
          penStatus: outcome === 'current' ? 'verified-current' : 'verified-differs',
          catalogStatus: outcome === 'current' ? 'on-pen-current' : 'on-pen-differs',
        },
      };
      try {
        window.webContents.send(IPC.bookVerifyUpdate, updateEvent);
      } catch {
        // ignore — window gone
      }
    }

    appendDiagnostic(diagnosticsStore(), 'pen-verify-batch', {
      requestedCount: params.fileNames.length,
      verifiedCount: totalCount,
      durationMs: Date.now() - startedAtMs,
      endStatus: myBatchId === currentVerifyBatchId ? (abortController.signal.aborted ? 'cancelled' : 'completed') : 'superseded',
    });
    // Only clear the shared "currently running" slot if a newer batch hasn't already claimed
    // it — otherwise this stale batch finishing late would incorrectly null out the new one.
    if (myBatchId === currentVerifyBatchId) currentVerifyAbort = null;
  })();

  return { status: 'started' };
}

/** Cancels whatever verification batch is currently running (a no-op if none is) — aborts the
 *  in-flight file read immediately, actually releasing its OS handle, not just abandoning the
 *  promise. */
export function bookVerifyCancel(): { ok: boolean } {
  const wasRunning = currentVerifyAbort !== null;
  currentVerifyAbort?.abort();
  currentVerifyAbort = null; // this cancel call is itself the authoritative "nothing running now"
  currentVerifyBatchId += 1; // also invalidates any remaining not-yet-started items in the loop
  return { ok: wasRunning };
}

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
  // Only a CONFIRMED (explicitly verified) current match skips the "differs from official"
  // framing — anything not confirmed current (present/verifying/differs/hash-unknown) is
  // treated the same, neutral way: it might differ, so it's always backed up the same.
  const reason = item.status === 'verified-current' ? ('pre-removal-current-version' as const) : ('differs-from-official' as const);

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
