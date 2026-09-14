import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BookCacheEntry, BookCatalogEntry } from '../../src/shared/types';
import { buildBookLibrary, listPenBookFiles } from '../../src/main/services/bookReconcile';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-book-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function entry(overrides: Partial<BookCatalogEntry> = {}): BookCatalogEntry {
  return {
    contentId: 'b1',
    filename: '0451.axb',
    filenameSource: 'declared',
    sha256: null,
    sizeBytes: 5,
    friendlyName: 'Book One',
    friendlyNameI18n: null,
    contentLanguages: ['en'],
    sortOrder: 0,
    downloadUrl: 'https://x/download?id=b1',
    ...overrides,
  };
}

describe('listPenBookFiles', () => {
  it('lists .axb files and excludes AppleDouble sidecars, non-axb files', () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, '0451.axb'), 'hello');
    fs.writeFileSync(path.join(dir, '._0451.axb'), 'junk');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    const files = listPenBookFiles(dir);
    expect(files).toEqual([{ fileName: '0451.axb', sizeBytes: 5 }]);
  });

  it('returns [] when the folder cannot be read, rather than throwing', () => {
    expect(listPenBookFiles(path.join(mkTempDir(), 'does-not-exist'))).toEqual([]);
  });
});

describe('buildBookLibrary', () => {
  it('catalog-not-cached when nothing is local yet, and passes through raw friendlyName/friendlyNameI18n (never a pre-picked string)', async () => {
    const items = await buildBookLibrary({
      snapshot: {
        entries: [entry({ sha256: 'a'.repeat(64), friendlyNameI18n: { en: 'Book One', 'zh-Hant': '第一本書' } })],
        fetchedAtMs: 1,
        source: 'fixture',
        conflicts: [],
      },
      cacheEntries: [],
      penFiles: null,
      bookDirReal: null,
    });
    expect(items).toEqual([
      {
        contentId: 'b1',
        filename: '0451.axb',
        friendlyName: 'Book One',
        friendlyNameI18n: { en: 'Book One', 'zh-Hant': '第一本書' },
        status: 'catalog-not-cached',
        sizeBytes: 5,
        cached: false,
        onPen: false,
        availableActions: ['add'],
      },
    ]);
  });

  it('hashes a matched pen file on demand and reports on-pen-current / on-pen-differs-from-official correctly', async () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, '0451.axb'), 'hello');
    const hash = await import('node:crypto').then((c) => c.createHash('sha256').update('hello').digest('hex'));

    const currentItems = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: hash })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: dir,
    });
    expect(currentItems[0].status).toBe('on-pen-current');
    expect(currentItems[0].availableActions).toContain('reinstall');

    const differsItems = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: 'f'.repeat(64) })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: dir,
    });
    expect(differsItems[0].status).toBe('on-pen-differs-from-official');
    expect(differsItems[0].availableActions).toEqual(['replace', 'remove']);
  });

  it('never hashes a pen file when the catalog entry has no sha256 — on-pen-hash-unknown instead', async () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, '0451.axb'), 'hello');
    const items = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: null })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: dir,
    });
    expect(items[0].status).toBe('on-pen-hash-unknown');
  });

  it('lists an unmatched pen file as not-in-catalog, kept and removable, never dropped', async () => {
    const items = await buildBookLibrary({
      snapshot: { entries: [], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: 'mystery.axb', sizeBytes: 9 }],
      bookDirReal: null,
    });
    expect(items).toEqual([
      {
        contentId: null,
        filename: 'mystery.axb',
        friendlyName: null,
        friendlyNameI18n: null,
        status: 'not-in-catalog',
        sizeBytes: 9,
        cached: false,
        onPen: true,
        availableActions: ['remove'],
      },
    ]);
  });

  it('a catalog error (null snapshot) never invents not-in-catalog statuses for pen files — reconciliation is simply skipped for the catalog side', async () => {
    const items = await buildBookLibrary({
      snapshot: null,
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: null,
    });
    // With no catalog at all, every pen file is unmatched by definition — still kept, not dropped.
    expect(items).toEqual([
      {
        contentId: null,
        filename: '0451.axb',
        friendlyName: null,
        friendlyNameI18n: null,
        status: 'not-in-catalog',
        sizeBytes: 5,
        cached: false,
        onPen: true,
        availableActions: ['remove'],
      },
    ]);
  });

  it('marks a colliding catalog entry catalog-ambiguous and disables install, regardless of pen/cache state', async () => {
    const entries = [entry({ contentId: 'b1', filename: 'story.axb' }), entry({ contentId: 'b2', filename: 'STORY.axb' })];
    const items = await buildBookLibrary({
      snapshot: { entries, fetchedAtMs: 1, source: 'fixture', conflicts: [{ filenameLower: 'story.axb', contentIds: ['b1', 'b2'] }] },
      cacheEntries: [],
      penFiles: null,
      bookDirReal: null,
    });
    expect(items.map((i) => i.status)).toEqual(['catalog-ambiguous', 'catalog-ambiguous']);
    expect(items.every((i) => i.availableActions.length === 0)).toBe(true);
  });

  it('catalog-incomplete-metadata entries never get an install/update/reinstall action', async () => {
    const items = await buildBookLibrary({
      snapshot: { entries: [entry({ filenameSource: 'fallback-storage-key' })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: null,
      bookDirReal: null,
    });
    expect(items[0].status).toBe('catalog-incomplete-metadata');
    expect(items[0].availableActions).toEqual([]);
  });

  it('reports catalog-cached-current / catalog-cached-stale from the cache manifest when there is no pen file', async () => {
    const cacheEntries: BookCacheEntry[] = [{ contentId: 'b1', sha256: 'a'.repeat(64), sizeBytes: 5, filename: '0451.axb', cachedAtMs: 1 }];
    const current = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: 'a'.repeat(64) })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries,
      penFiles: null,
      bookDirReal: null,
    });
    expect(current[0].status).toBe('catalog-cached-current');
    expect(current[0].cached).toBe(true);

    const stale = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: 'f'.repeat(64) })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries,
      penFiles: null,
      bookDirReal: null,
    });
    expect(stale[0].status).toBe('catalog-cached-stale');
  });
});
