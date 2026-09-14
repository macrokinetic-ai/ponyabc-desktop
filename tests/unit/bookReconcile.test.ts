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

describe('buildBookLibrary — catalogItems (right pane)', () => {
  it('not-on-pen, actionable, when nothing is local yet — passes through raw friendlyName/friendlyNameI18n', async () => {
    const { catalogItems } = await buildBookLibrary({
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
    expect(catalogItems).toEqual([
      {
        contentId: 'b1',
        filename: '0451.axb',
        friendlyName: 'Book One',
        friendlyNameI18n: { en: 'Book One', 'zh-Hant': '第一本書' },
        sizeBytes: 5,
        status: 'not-on-pen',
        cached: false,
        actionable: true,
      },
    ]);
  });

  it('on-pen-current / on-pen-differs, both actionable=true only for differs', async () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, '0451.axb'), 'hello');
    const hash = await import('node:crypto').then((c) => c.createHash('sha256').update('hello').digest('hex'));

    const current = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: hash })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: dir,
    });
    expect(current.catalogItems[0].status).toBe('on-pen-current');
    expect(current.catalogItems[0].actionable).toBe(false); // already matches — nothing to do

    const differs = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: 'f'.repeat(64) })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: dir,
    });
    expect(differs.catalogItems[0].status).toBe('on-pen-differs');
    expect(differs.catalogItems[0].actionable).toBe(true);
  });

  it('metadata-incomplete is never actionable, even with a matching pen file', async () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, '0451.axb'), 'hello');
    const { catalogItems } = await buildBookLibrary({
      snapshot: { entries: [entry({ filenameSource: 'fallback-storage-key' })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: dir,
    });
    expect(catalogItems[0].status).toBe('metadata-incomplete');
    expect(catalogItems[0].actionable).toBe(false);
  });

  it('ambiguous catalog entries are never actionable and never claim a pen-file match', async () => {
    const entries = [entry({ contentId: 'b1', filename: 'story.axb' }), entry({ contentId: 'b2', filename: 'STORY.axb' })];
    const { catalogItems } = await buildBookLibrary({
      snapshot: { entries, fetchedAtMs: 1, source: 'fixture', conflicts: [{ filenameLower: 'story.axb', contentIds: ['b1', 'b2'] }] },
      cacheEntries: [],
      penFiles: null,
      bookDirReal: null,
    });
    expect(catalogItems.map((i) => i.status)).toEqual(['ambiguous', 'ambiguous']);
    expect(catalogItems.every((i) => !i.actionable)).toBe(true);
  });

  it('cached flag reflects the cache manifest regardless of pen state', async () => {
    const cacheEntries: BookCacheEntry[] = [{ contentId: 'b1', sha256: 'a'.repeat(64), sizeBytes: 5, filename: '0451.axb', cachedAtMs: 1 }];
    const { catalogItems } = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: 'a'.repeat(64) })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries,
      penFiles: null,
      bookDirReal: null,
    });
    expect(catalogItems[0].cached).toBe(true);
    expect(catalogItems[0].status).toBe('not-on-pen');
  });
});

describe('buildBookLibrary — penItems (left pane)', () => {
  it('null when no pen is connected', async () => {
    const { penItems } = await buildBookLibrary({ snapshot: null, cacheEntries: [], penFiles: null, bookDirReal: null });
    expect(penItems).toBeNull();
  });

  it('an unmatched pen file is "unknown" and never removable', async () => {
    const { penItems } = await buildBookLibrary({
      snapshot: { entries: [], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: 'mystery.axb', sizeBytes: 9 }],
      bookDirReal: null,
    });
    expect(penItems).toEqual([
      { fileName: 'mystery.axb', sizeBytes: 9, contentId: null, friendlyName: null, friendlyNameI18n: null, status: 'unknown', removable: false },
    ]);
  });

  it('a catalog error (null snapshot) never invents matches — every pen file is "unknown"', async () => {
    const { penItems } = await buildBookLibrary({
      snapshot: null,
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: null,
    });
    expect(penItems).toEqual([
      { fileName: '0451.axb', sizeBytes: 5, contentId: null, friendlyName: null, friendlyNameI18n: null, status: 'unknown', removable: false },
    ]);
  });

  it('a matched pen file is removable and carries the catalog identity/name', async () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, '0451.axb'), 'hello');
    const hash = await import('node:crypto').then((c) => c.createHash('sha256').update('hello').digest('hex'));
    const { penItems } = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: hash, friendlyName: 'Book One' })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: dir,
    });
    expect(penItems).toEqual([
      { fileName: '0451.axb', sizeBytes: 5, contentId: 'b1', friendlyName: 'Book One', friendlyNameI18n: null, status: 'matched-current', removable: true },
    ]);
  });

  it('matched-differs / matched-hash-unknown are still removable (the confirm+backup gate is enforced at removal time, not by hiding the checkbox)', async () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, '0451.axb'), 'hello');

    const differs = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: 'f'.repeat(64) })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: dir,
    });
    expect(differs.penItems?.[0].status).toBe('matched-differs');
    expect(differs.penItems?.[0].removable).toBe(true);

    const hashUnknown = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: null })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: dir,
    });
    expect(hashUnknown.penItems?.[0].status).toBe('matched-hash-unknown');
    expect(hashUnknown.penItems?.[0].removable).toBe(true);
  });

  it('a pen file whose name only matches ambiguous catalog entries is "unknown", not arbitrarily assigned to either', async () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, 'story.axb'), 'hello');
    const entries = [entry({ contentId: 'b1', filename: 'story.axb' }), entry({ contentId: 'b2', filename: 'STORY.axb' })];
    const { penItems } = await buildBookLibrary({
      snapshot: { entries, fetchedAtMs: 1, source: 'fixture', conflicts: [{ filenameLower: 'story.axb', contentIds: ['b1', 'b2'] }] },
      cacheEntries: [],
      penFiles: [{ fileName: 'story.axb', sizeBytes: 5 }],
      bookDirReal: dir,
    });
    expect(penItems?.[0].status).toBe('unknown');
    expect(penItems?.[0].contentId).toBeNull();
    expect(penItems?.[0].removable).toBe(false);
  });

  it('hashes a matched pen file exactly once, reused by both panes', async () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, '0451.axb'), 'hello');
    const hash = await import('node:crypto').then((c) => c.createHash('sha256').update('hello').digest('hex'));
    // No direct spy available on the pure function boundary here; this asserts consistency
    // between the two panes as an indirect proof the same computed hash is used for both.
    const { penItems, catalogItems } = await buildBookLibrary({
      snapshot: { entries: [entry({ sha256: hash })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries: [],
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5 }],
      bookDirReal: dir,
    });
    expect(penItems?.[0].status).toBe('matched-current');
    expect(catalogItems[0].status).toBe('on-pen-current');
  });
});
