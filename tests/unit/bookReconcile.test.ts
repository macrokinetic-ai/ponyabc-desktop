import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BookCacheEntry, BookCatalogEntry, BookVerifyRecord } from '../../src/shared/types';
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
    updatedAtMs: null,
    downloadUrl: 'https://x/download?id=b1',
    ...overrides,
  };
}

const PEN_LABEL = 'PEN';
const PEN_GEN = 1;

/** Defaults penVolumeLabel/penGeneration/verifyRecords so most tests only need to specify
 *  what they actually care about. */
function buildLib(params: {
  snapshot: Parameters<typeof buildBookLibrary>[0]['snapshot'];
  cacheEntries?: BookCacheEntry[];
  penFiles: Parameters<typeof buildBookLibrary>[0]['penFiles'];
  penVolumeLabel?: string | null;
  penGeneration?: number;
  verifyRecords?: BookVerifyRecord[];
}) {
  return buildBookLibrary({
    snapshot: params.snapshot,
    cacheEntries: params.cacheEntries ?? [],
    penFiles: params.penFiles,
    penVolumeLabel: params.penVolumeLabel ?? (params.penFiles !== null ? PEN_LABEL : null),
    penGeneration: params.penGeneration ?? PEN_GEN,
    verifyRecords: params.verifyRecords ?? [],
  });
}

function writePenFile(dir: string, name: string, content: string): { fileName: string; sizeBytes: number; mtimeMs: number } {
  const full = path.join(dir, name);
  fs.writeFileSync(full, content);
  const stat = fs.statSync(full);
  return { fileName: name, sizeBytes: stat.size, mtimeMs: stat.mtimeMs };
}

describe('listPenBookFiles', () => {
  it('lists .axb files (with size + mtime) and excludes AppleDouble sidecars, non-axb files', () => {
    const dir = mkTempDir();
    fs.writeFileSync(path.join(dir, '0451.axb'), 'hello');
    fs.writeFileSync(path.join(dir, '._0451.axb'), 'junk');
    fs.writeFileSync(path.join(dir, 'notes.txt'), 'x');
    const files = listPenBookFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].fileName).toBe('0451.axb');
    expect(files[0].sizeBytes).toBe(5);
    expect(typeof files[0].mtimeMs).toBe('number');
  });

  it('returns [] when the folder cannot be read, rather than throwing', () => {
    expect(listPenBookFiles(path.join(mkTempDir(), 'does-not-exist'))).toEqual([]);
  });
});

describe('buildBookLibrary — never hashes, is synchronous/fast', () => {
  it('not-on-pen, actionable, when nothing is local yet — passes through raw friendlyName/friendlyNameI18n', () => {
    const { catalogItems } = buildLib({
      snapshot: {
        entries: [entry({ sha256: 'a'.repeat(64), friendlyNameI18n: { en: 'Book One', 'zh-Hant': '第一本書' } })],
        fetchedAtMs: 1,
        source: 'fixture',
        conflicts: [],
      },
      penFiles: null,
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
        updatedAtMs: null,
      },
    ]);
  });

  it('a matched, eligible entry is "on-pen-present"/"present" (unverified) when no verify record exists — no hashing occurs', () => {
    const dir = mkTempDir();
    const f = writePenFile(dir, '0451.axb', 'hello');
    const { penItems, catalogItems } = buildLib({
      snapshot: { entries: [entry({ sha256: 'a'.repeat(64) })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [f],
    });
    expect(catalogItems[0].status).toBe('on-pen-present');
    expect(catalogItems[0].actionable).toBe(true); // present-but-unverified is actionable (Replace offered)
    expect(penItems?.[0].status).toBe('present');
    expect(penItems?.[0].removable).toBe(true);
  });

  it('a valid verify record (matching pen/generation/size/mtime/officialHash) resolves to current/differs without hashing', () => {
    const dir = mkTempDir();
    const f = writePenFile(dir, '0451.axb', 'hello');
    const officialSha256 = 'a'.repeat(64);

    const matchingRecord: BookVerifyRecord = {
      penVolumeLabel: PEN_LABEL,
      penGenerationAtVerify: PEN_GEN,
      fileName: f.fileName,
      sizeBytes: f.sizeBytes,
      mtimeMs: f.mtimeMs,
      observedSha256: officialSha256,
      officialSha256,
      contentId: 'b1',
      verifiedAtMs: 1,
    };

    const current = buildLib({
      snapshot: { entries: [entry({ sha256: officialSha256 })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [f],
      verifyRecords: [matchingRecord],
    });
    expect(current.penItems?.[0].status).toBe('verified-current');
    expect(current.catalogItems[0].status).toBe('on-pen-current');
    expect(current.catalogItems[0].actionable).toBe(false); // nothing to do — already confirmed current

    const differsRecord: BookVerifyRecord = { ...matchingRecord, observedSha256: 'f'.repeat(64) };
    const differs = buildLib({
      snapshot: { entries: [entry({ sha256: officialSha256 })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [f],
      verifyRecords: [differsRecord],
    });
    expect(differs.penItems?.[0].status).toBe('verified-differs');
    expect(differs.catalogItems[0].status).toBe('on-pen-differs');
    expect(differs.catalogItems[0].actionable).toBe(true);
  });

  it.each([
    ['a different pen (volume label)', (r: BookVerifyRecord) => ({ ...r, penVolumeLabel: 'OTHER-PEN' })],
    ['a different pen generation (remount)', (r: BookVerifyRecord) => ({ ...r, penGenerationAtVerify: 999 })],
    ['a file that changed size since verifying', (r: BookVerifyRecord) => ({ ...r, sizeBytes: r.sizeBytes + 1 })],
    ['a file that changed mtime since verifying', (r: BookVerifyRecord) => ({ ...r, mtimeMs: r.mtimeMs + 1 })],
    ['a catalog whose official hash has since changed', (r: BookVerifyRecord) => ({ ...r, officialSha256: 'c'.repeat(64) })],
  ])('a stale verify record (%s) is never trusted — falls back to unverified "present", not a guessed outcome', (_label, mutate) => {
    const dir = mkTempDir();
    const f = writePenFile(dir, '0451.axb', 'hello');
    const officialSha256 = 'a'.repeat(64);
    const record: BookVerifyRecord = {
      penVolumeLabel: PEN_LABEL,
      penGenerationAtVerify: PEN_GEN,
      fileName: f.fileName,
      sizeBytes: f.sizeBytes,
      mtimeMs: f.mtimeMs,
      observedSha256: officialSha256,
      officialSha256,
      contentId: 'b1',
      verifiedAtMs: 1,
    };
    const { penItems } = buildLib({
      snapshot: { entries: [entry({ sha256: officialSha256 })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [f],
      verifyRecords: [mutate(record)],
    });
    expect(penItems?.[0].status).toBe('present');
  });

  it('a filename match with a differing SIZE is "size-differs"/"on-pen-size-differs" — decided by stat alone, no hashing, even with a matching verify record on file', () => {
    const dir = mkTempDir();
    const f = writePenFile(dir, '0451.axb', 'hello-extra-bytes'); // 18 bytes, catalog declares 5
    const officialSha256 = 'a'.repeat(64);
    // A verify record exists for this exact pen/file identity (stale relative to the new size,
    // but even if it somehow matched, size must still be checked first).
    const staleRecord: BookVerifyRecord = {
      penVolumeLabel: PEN_LABEL,
      penGenerationAtVerify: PEN_GEN,
      fileName: f.fileName,
      sizeBytes: f.sizeBytes,
      mtimeMs: f.mtimeMs,
      observedSha256: officialSha256,
      officialSha256,
      contentId: 'b1',
      verifiedAtMs: 1,
    };
    const { penItems, catalogItems } = buildLib({
      snapshot: { entries: [entry({ sha256: officialSha256, sizeBytes: 5 })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [f],
      verifyRecords: [staleRecord],
    });
    expect(penItems?.[0].status).toBe('size-differs');
    expect(penItems?.[0].removable).toBe(true); // still user-removable/replaceable, never auto-acted-on
    expect(catalogItems[0].status).toBe('on-pen-size-differs');
    expect(catalogItems[0].actionable).toBe(true); // "Replace with official version" is offered
  });

  it('on the pen side, a size mismatch takes priority over "matched-hash-unknown" (no catalog hash at all) — the catalog side still reports metadata-incomplete independent of the pen, since an ineligible entry is never actionable regardless of what is on the pen', () => {
    const dir = mkTempDir();
    const f = writePenFile(dir, '0451.axb', 'hello-extra-bytes');
    const { penItems, catalogItems } = buildLib({
      snapshot: { entries: [entry({ sha256: null, sizeBytes: 5 })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [f],
    });
    expect(penItems?.[0].status).toBe('size-differs');
    expect(catalogItems[0].status).toBe('metadata-incomplete');
  });

  it('metadata-incomplete is never actionable, even with a matching pen file', () => {
    const dir = mkTempDir();
    const f = writePenFile(dir, '0451.axb', 'hello');
    const { catalogItems } = buildLib({
      snapshot: { entries: [entry({ filenameSource: 'fallback-storage-key' })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [f],
    });
    expect(catalogItems[0].status).toBe('metadata-incomplete');
    expect(catalogItems[0].actionable).toBe(false);
  });

  it('ambiguous catalog entries are never actionable and never claim a pen-file match', () => {
    const entries = [entry({ contentId: 'b1', filename: 'story.axb' }), entry({ contentId: 'b2', filename: 'STORY.axb' })];
    const { catalogItems } = buildLib({
      snapshot: { entries, fetchedAtMs: 1, source: 'fixture', conflicts: [{ filenameLower: 'story.axb', contentIds: ['b1', 'b2'] }] },
      penFiles: null,
    });
    expect(catalogItems.map((i) => i.status)).toEqual(['ambiguous', 'ambiguous']);
    expect(catalogItems.every((i) => !i.actionable)).toBe(true);
  });

  it('cached flag reflects the cache manifest regardless of pen state', () => {
    const cacheEntries: BookCacheEntry[] = [{ contentId: 'b1', sha256: 'a'.repeat(64), sizeBytes: 5, filename: '0451.axb', cachedAtMs: 1 }];
    const { catalogItems } = buildLib({
      snapshot: { entries: [entry({ sha256: 'a'.repeat(64) })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      cacheEntries,
      penFiles: null,
    });
    expect(catalogItems[0].cached).toBe(true);
    expect(catalogItems[0].status).toBe('not-on-pen');
  });

  it('passes the catalog entry updatedAtMs through to both the catalog item and a matched pen item', () => {
    const dir = mkTempDir();
    const f = writePenFile(dir, '0451.axb', 'hello');
    const updatedAtMs = Date.parse('2026-09-01T00:00:00.000Z');
    const { penItems, catalogItems } = buildLib({
      snapshot: { entries: [entry({ sha256: 'a'.repeat(64), updatedAtMs })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [f],
    });
    expect(catalogItems[0].updatedAtMs).toBe(updatedAtMs);
    expect(penItems?.[0].updatedAtMs).toBe(updatedAtMs);
  });

  it('an unmatched pen file always has a null updatedAtMs, even when the catalog has entries', () => {
    const { penItems } = buildLib({
      snapshot: { entries: [entry({ updatedAtMs: Date.now() })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [{ fileName: 'mystery.axb', sizeBytes: 9, mtimeMs: 1 }],
      penVolumeLabel: null,
    });
    expect(penItems?.[0].updatedAtMs).toBeNull();
  });
});

describe('buildBookLibrary — penItems (left pane)', () => {
  it('null when no pen is connected', () => {
    const { penItems } = buildLib({ snapshot: null, penFiles: null });
    expect(penItems).toBeNull();
  });

  it('an unmatched pen file is "unknown" and never removable', () => {
    const { penItems } = buildLib({
      snapshot: { entries: [], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [{ fileName: 'mystery.axb', sizeBytes: 9, mtimeMs: 1 }],
    });
    expect(penItems).toEqual([
      { fileName: 'mystery.axb', sizeBytes: 9, contentId: null, friendlyName: null, friendlyNameI18n: null, status: 'unknown', removable: false, updatedAtMs: null },
    ]);
  });

  it('a catalog that has never been successfully fetched (null snapshot) shows unmatched pen files as "awaiting-catalog", not "unknown" — nothing has actually been checked against anything yet', () => {
    const { penItems } = buildLib({
      snapshot: null,
      penFiles: [{ fileName: '0451.axb', sizeBytes: 5, mtimeMs: 1 }],
    });
    expect(penItems).toEqual([
      { fileName: '0451.axb', sizeBytes: 5, contentId: null, friendlyName: null, friendlyNameI18n: null, status: 'awaiting-catalog', removable: false, updatedAtMs: null },
    ]);
  });

  it('present / matched-hash-unknown are both removable (the confirm+backup gate is enforced at removal time, not by hiding the checkbox)', () => {
    const dir = mkTempDir();
    const f = writePenFile(dir, '0451.axb', 'hello');

    const present = buildLib({
      snapshot: { entries: [entry({ sha256: 'f'.repeat(64) })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [f],
    });
    expect(present.penItems?.[0].status).toBe('present');
    expect(present.penItems?.[0].removable).toBe(true);

    const hashUnknown = buildLib({
      snapshot: { entries: [entry({ sha256: null })], fetchedAtMs: 1, source: 'fixture', conflicts: [] },
      penFiles: [f],
    });
    expect(hashUnknown.penItems?.[0].status).toBe('matched-hash-unknown');
    expect(hashUnknown.penItems?.[0].removable).toBe(true);
  });

  it('a pen file whose name only matches ambiguous catalog entries is "unknown", not arbitrarily assigned to either', () => {
    const dir = mkTempDir();
    const f = writePenFile(dir, 'story.axb', 'hello');
    const entries = [entry({ contentId: 'b1', filename: 'story.axb' }), entry({ contentId: 'b2', filename: 'STORY.axb' })];
    const { penItems } = buildLib({
      snapshot: { entries, fetchedAtMs: 1, source: 'fixture', conflicts: [{ filenameLower: 'story.axb', contentIds: ['b1', 'b2'] }] },
      penFiles: [f],
    });
    expect(penItems?.[0].status).toBe('unknown');
    expect(penItems?.[0].contentId).toBeNull();
    expect(penItems?.[0].removable).toBe(false);
  });
});
