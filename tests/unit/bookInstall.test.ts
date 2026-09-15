import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BookCacheEntry, BookCatalogEntry } from '../../src/shared/types';
import { resolvePenRoot } from '../../src/main/services/pathSecurity';
import * as session from '../../src/main/services/session';
import { cacheFilePath } from '../../src/main/services/bookDownload';
import { addToPen, downloadToCacheOnly, reinstall, replaceWithOfficial, type BookInstallDeps } from '../../src/main/services/bookInstall';

const tempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

let penRoot: string;
let cacheDir: string;
let scratchBackupDir: string;
let cacheEntries: BookCacheEntry[];

function makeDeps(overrides: Partial<BookInstallDeps> = {}): BookInstallDeps {
  return {
    cacheDir,
    backupDir: scratchBackupDir,
    getCacheEntries: () => cacheEntries,
    saveCacheEntry: (e) => {
      if (!cacheEntries.some((c) => c.contentId === e.contentId && c.sha256 === e.sha256)) cacheEntries.push(e);
    },
    getFreeBytesFn: async () => 10_000_000,
    ...overrides,
  };
}

function entry(overrides: Partial<BookCatalogEntry> = {}): BookCatalogEntry {
  const bytes = Buffer.from('official content');
  return {
    contentId: 'b1',
    filename: '0451.axb',
    filenameSource: 'declared',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    friendlyName: 'Book One',
    friendlyNameI18n: null,
    contentLanguages: [],
    sortOrder: 0,
    updatedAtMs: null,
    downloadUrl: 'https://x.test/download?id=b1',
    ...overrides,
  };
}

function immediateFetch(text: string, status = 200): typeof fetch {
  return (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from(text));
          controller.close();
        },
      }),
      { status },
    )) as unknown as typeof fetch;
}

beforeEach(() => {
  session.setPenRoot(null);
  penRoot = mkTempDir('ponyabc-pen-');
  fs.mkdirSync(path.join(penRoot, 'BOOK'));
  fs.mkdirSync(path.join(penRoot, 'DIY'));
  const resolved = resolvePenRoot(penRoot);
  if (resolved.status !== 'ok') throw new Error('fixture pen root invalid');
  session.setPenRoot(resolved);

  cacheDir = mkTempDir('ponyabc-cache-');
  scratchBackupDir = mkTempDir('ponyabc-scratch-');
  cacheEntries = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('addToPen', () => {
  it('downloads and writes to BOOK when nothing is cached, then leaves a usable cache entry', async () => {
    const fetchFn = vi.fn(immediateFetch('official content'));
    const gen = session.getGeneration();
    const result = await addToPen(entry(), gen, makeDeps({ fetchFn }));
    expect(result.status).toBe('completed');
    expect(fs.readFileSync(path.join(penRoot, 'BOOK', '0451.axb'), 'utf-8')).toBe('official content');
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(cacheEntries).toHaveLength(1);
  });

  it('a cache hit (matching contentId + sha256, file present on disk) skips the network entirely', async () => {
    const e = entry();
    fs.mkdirSync(cacheDir, { recursive: true });
    const p = cacheFilePath(cacheDir, e.contentId, e.sha256 as string);
    fs.writeFileSync(p, 'official content');
    cacheEntries.push({ contentId: e.contentId, sha256: e.sha256 as string, sizeBytes: 17, filename: e.filename, cachedAtMs: 1 });

    const fetchFn = vi.fn();
    const result = await addToPen(e, session.getGeneration(), makeDeps({ fetchFn: fetchFn as unknown as typeof fetch }));
    expect(result.status).toBe('completed');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(penRoot, 'BOOK', '0451.axb'), 'utf-8')).toBe('official content');
  });

  it('offline with a complete matching cache still succeeds (no network call at all)', async () => {
    const e = entry();
    const p = cacheFilePath(cacheDir, e.contentId, e.sha256 as string);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(p, 'official content');
    cacheEntries.push({ contentId: e.contentId, sha256: e.sha256 as string, sizeBytes: 17, filename: e.filename, cachedAtMs: 1 });

    const offlineFetch = vi.fn(async () => {
      throw new Error('offline');
    });
    const result = await addToPen(e, session.getGeneration(), makeDeps({ fetchFn: offlineFetch as unknown as typeof fetch }));
    expect(result.status).toBe('completed');
    expect(offlineFetch).not.toHaveBeenCalled();
  });

  it('no cache and no network reports a network error, not a silent failure', async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error('no network');
    });
    const result = await addToPen(entry(), session.getGeneration(), makeDeps({ fetchFn: failingFetch as unknown as typeof fetch }));
    expect(result).toEqual({ status: 'network-error', message: 'no network' });
  });

  it('refuses to install a metadata-incomplete entry', async () => {
    const fetchFn = vi.fn();
    const result = await addToPen(entry({ filenameSource: 'fallback-storage-key' }), session.getGeneration(), makeDeps({ fetchFn: fetchFn as unknown as typeof fetch }));
    expect(result).toEqual({ status: 'metadata-incomplete' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('checks free space on the PEN volume too, not just the cache download step', async () => {
    const e = entry();
    const p = cacheFilePath(cacheDir, e.contentId, e.sha256 as string);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(p, 'official content');
    cacheEntries.push({ contentId: e.contentId, sha256: e.sha256 as string, sizeBytes: 17, filename: e.filename, cachedAtMs: 1 });

    const result = await addToPen(e, session.getGeneration(), makeDeps({ getFreeBytesFn: async () => 1 }));
    expect(result).toEqual({ status: 'no-space' });
    expect(fs.existsSync(path.join(penRoot, 'BOOK', '0451.axb'))).toBe(false);
  });

  it('a stale penGeneration is refused before anything is written', async () => {
    const result = await addToPen(entry(), session.getGeneration() + 999, makeDeps({ fetchFn: vi.fn(immediateFetch('official content')) }));
    expect(result).toEqual({ status: 'stale-plan' });
  });
});

describe('reinstall', () => {
  it('always re-downloads, even when a valid matching cache entry already exists', async () => {
    const e = entry();
    const p = cacheFilePath(cacheDir, e.contentId, e.sha256 as string);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(p, 'official content');
    cacheEntries.push({ contentId: e.contentId, sha256: e.sha256 as string, sizeBytes: 17, filename: e.filename, cachedAtMs: 1 });

    const fetchFn = vi.fn(immediateFetch('official content'));
    const result = await reinstall(e, session.getGeneration(), makeDeps({ fetchFn }));
    expect(result.status).toBe('completed');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('downloadToCacheOnly', () => {
  it('downloads into the cache but never writes to the pen', async () => {
    const fetchFn = vi.fn(immediateFetch('official content'));
    const result = await downloadToCacheOnly(entry(), makeDeps({ fetchFn }));
    expect(result).toEqual({ status: 'completed', cacheHit: false });
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(path.join(penRoot, 'BOOK', '0451.axb'))).toBe(false); // never written to the pen
    expect(cacheEntries).toHaveLength(1);
  });

  it('a fully-matching existing cache entry is reused with zero network activity, reported as cacheHit: true', async () => {
    const e = entry();
    const p = cacheFilePath(cacheDir, e.contentId, e.sha256 as string);
    fs.mkdirSync(cacheDir, { recursive: true });
    fs.writeFileSync(p, 'official content');
    cacheEntries.push({ contentId: e.contentId, sha256: e.sha256 as string, sizeBytes: 17, filename: e.filename, cachedAtMs: 1 });

    const fetchFn = vi.fn();
    const result = await downloadToCacheOnly(e, makeDeps({ fetchFn: fetchFn as unknown as typeof fetch }));
    expect(result).toEqual({ status: 'completed', cacheHit: true });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses a metadata-incomplete entry without touching the network', async () => {
    const fetchFn = vi.fn();
    const result = await downloadToCacheOnly(entry({ filenameSource: 'fallback-storage-key' }), makeDeps({ fetchFn: fetchFn as unknown as typeof fetch }));
    expect(result).toEqual({ status: 'metadata-incomplete' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('a network failure with no usable cache reports network-error', async () => {
    const failingFetch = vi.fn(async () => {
      throw new Error('no network');
    });
    const result = await downloadToCacheOnly(entry(), makeDeps({ fetchFn: failingFetch as unknown as typeof fetch }));
    expect(result).toEqual({ status: 'network-error', message: 'no network' });
  });
});

describe('replaceWithOfficial', () => {
  it('overwrites an existing differing pen file with the official version, backing up the old bytes via safeWriteFile', async () => {
    fs.writeFileSync(path.join(penRoot, 'BOOK', '0451.axb'), 'old content');
    const fetchFn = vi.fn(immediateFetch('official content'));
    const result = await replaceWithOfficial(entry(), session.getGeneration(), makeDeps({ fetchFn }));
    expect(result.status).toBe('completed');
    expect(result.backupPath).toBeDefined();
    expect(fs.readFileSync(path.join(penRoot, 'BOOK', '0451.axb'), 'utf-8')).toBe('official content');
    expect(fs.readFileSync(result.backupPath as string, 'utf-8')).toBe('old content');
  });
});
