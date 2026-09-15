import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BookVerifyRecord } from '../../src/shared/types';
import { createJsonStore } from '../../src/main/services/bookStore';
import { findValidVerifyRecord, upsertVerifyRecord } from '../../src/main/services/bookVerificationIndex';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-verifyidx-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function record(overrides: Partial<BookVerifyRecord> = {}): BookVerifyRecord {
  return {
    penVolumeLabel: 'PEN',
    penGenerationAtVerify: 1,
    fileName: '0451.axb',
    sizeBytes: 1000,
    mtimeMs: 500,
    observedSha256: 'a'.repeat(64),
    officialSha256: 'a'.repeat(64),
    contentId: 'b1',
    verifiedAtMs: 1,
    ...overrides,
  };
}

const lookupParams = {
  penVolumeLabel: 'PEN',
  penGeneration: 1,
  fileName: '0451.axb',
  sizeBytes: 1000,
  mtimeMs: 500,
  officialSha256: 'a'.repeat(64),
};

describe('findValidVerifyRecord', () => {
  it('finds a record whose pen/generation/size/mtime/officialHash all still match', () => {
    expect(findValidVerifyRecord([record()], lookupParams)).toEqual(record());
  });

  it('returns null when there is no record for this pen/filename at all', () => {
    expect(findValidVerifyRecord([], lookupParams)).toBeNull();
  });

  it('is case-insensitive on filename (matches the FAT32/exFAT semantics used elsewhere)', () => {
    expect(findValidVerifyRecord([record({ fileName: '0451.AXB' })], lookupParams)).not.toBeNull();
  });

  it.each([
    ['volume label changed (different pen)', { penVolumeLabel: 'OTHER' }],
    ['generation changed (remount)', { penGenerationAtVerify: 2 }],
    ['size changed (file modified)', { sizeBytes: 1001 }],
    ['mtime changed (file modified)', { mtimeMs: 501 }],
    ['official hash changed (catalog updated)', { officialSha256: 'b'.repeat(64) }],
  ])('never trusts a record when %s', (_label, mutation) => {
    expect(findValidVerifyRecord([record(mutation)], lookupParams)).toBeNull();
  });
});

describe('upsertVerifyRecord', () => {
  it('replaces the existing record for the same (pen, filename) rather than appending a second one', () => {
    const store = createJsonStore<BookVerifyRecord[]>(path.join(mkTempDir(), 'idx.json'), () => []);
    upsertVerifyRecord(store, record({ observedSha256: 'a'.repeat(64) }));
    upsertVerifyRecord(store, record({ observedSha256: 'b'.repeat(64) }));
    const all = store.get();
    expect(all).toHaveLength(1);
    expect(all[0].observedSha256).toBe('b'.repeat(64));
  });

  it('keeps separate records for different pens or different filenames', () => {
    const store = createJsonStore<BookVerifyRecord[]>(path.join(mkTempDir(), 'idx.json'), () => []);
    upsertVerifyRecord(store, record({ fileName: 'a.axb' }));
    upsertVerifyRecord(store, record({ fileName: 'b.axb' }));
    upsertVerifyRecord(store, record({ penVolumeLabel: 'OTHER-PEN', fileName: 'a.axb' }));
    expect(store.get()).toHaveLength(3);
  });

  it('caps the index at 300 records, evicting the oldest-verified entries first', () => {
    const store = createJsonStore<BookVerifyRecord[]>(path.join(mkTempDir(), 'idx.json'), () => []);
    for (let i = 0; i < 305; i++) {
      upsertVerifyRecord(store, record({ fileName: `f${i}.axb`, verifiedAtMs: i }));
    }
    const all = store.get();
    expect(all).toHaveLength(300);
    // The 5 oldest (verifiedAtMs 0..4) were evicted; the newest 300 (5..304) remain.
    expect(all.some((r) => r.fileName === 'f0.axb')).toBe(false);
    expect(all.some((r) => r.fileName === 'f304.axb')).toBe(true);
  });
});
