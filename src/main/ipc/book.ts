import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type {
  BookActionResult,
  BookBackupEntry,
  BookBackupSummary,
  BookCacheEntry,
  BookCatalogEntry,
  BookCatalogSnapshot,
  BookListResult,
  BookRemoveResult,
} from '@shared/types';
import { resolvePenRoot } from '../services/pathSecurity';
import * as session from '../services/session';
import { createJsonStore } from '../services/bookStore';
import { buildBookLibrary, listPenBookFiles } from '../services/bookReconcile';
import { validateCatalogEntries } from '../services/bookCatalogValidate';
import { createHttpBookCatalogClient } from '../services/bookCatalog/httpClient';
import { addToPen, reinstall, replaceWithOfficial } from '../services/bookInstall';
import { removeFromPen } from '../services/bookRemove';
import { restoreFromBackup } from '../services/bookRestore';
import { cancelDownload } from '../services/bookDownload';
import { makeBackupDir } from '../services/transferPlanner';

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
  };
}

const catalogStore = () => createJsonStore<BookCatalogSnapshot | null>(dirs().catalogFile, () => null);
const cacheManifestStore = () => createJsonStore<BookCacheEntry[]>(dirs().cacheManifestFile, () => []);
const backupManifestStore = () => createJsonStore<BookBackupEntry[]>(dirs().backupManifestFile, () => []);

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

async function currentList(): Promise<BookListResult> {
  const snapshot = catalogStore().get();
  const cacheEntries = cacheManifestStore().get();
  const { files, bookDirReal } = currentPenBookFiles();
  const items = await buildBookLibrary({ snapshot, cacheEntries, penFiles: files, bookDirReal });
  return {
    status: 'ok',
    items,
    meta: {
      fetchedAtMs: snapshot?.fetchedAtMs ?? null,
      source: snapshot?.source ?? 'none',
      offline: snapshot === null,
      conflicts: snapshot?.conflicts ?? [],
    },
  };
}

export function bookList(): Promise<BookListResult> {
  return currentList();
}

/** A failed refresh intentionally leaves the previous snapshot completely untouched — never
 *  clears it, never treated as "the server deleted everything." */
export async function bookCatalogRefresh(): Promise<BookListResult> {
  const client = createHttpBookCatalogClient({ baseUrl: BOOK_API_BASE_URL });
  const outcome = await client.fetchCatalog();
  if (outcome.status === 'ok') {
    const { entries, conflicts } = validateCatalogEntries(outcome.entries);
    catalogStore().set({ entries, fetchedAtMs: Date.now(), source: client.kind, conflicts });
  }
  return currentList();
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
  return action(entry, params.penGeneration, installDeps(window));
}

export const bookAdd = (window: BrowserWindow, params: { contentId: string; penGeneration: number }) => runInstallAction(addToPen, window, params);
export const bookUpdate = (window: BrowserWindow, params: { contentId: string; penGeneration: number }) =>
  runInstallAction(replaceWithOfficial, window, params);
export const bookReinstall = (window: BrowserWindow, params: { contentId: string; penGeneration: number }) =>
  runInstallAction(reinstall, window, params);

export async function bookRemove(params: { fileName: string; penGeneration: number }): Promise<BookRemoveResult> {
  const list = await currentList();
  const item = list.items.find((i) => i.filename === params.fileName && i.onPen);
  const reason =
    !item || item.status === 'not-in-catalog'
      ? ('uncatalogued' as const)
      : item.status === 'on-pen-current'
        ? ('pre-removal-current-version' as const)
        : ('differs-from-official' as const);

  return removeFromPen({
    fileName: params.fileName,
    penGeneration: params.penGeneration,
    reason,
    matchedContentId: item?.contentId ?? null,
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

export async function bookRestore(params: { backupId: string; penGeneration: number }): Promise<BookActionResult> {
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
