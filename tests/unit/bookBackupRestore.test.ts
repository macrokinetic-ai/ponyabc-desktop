import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BookBackupEntry } from '../../src/shared/types';
import { resolvePenRoot } from '../../src/main/services/pathSecurity';
import * as session from '../../src/main/services/session';
import { backupBeforeRemove, backupFilePath, type BookBackupDeps } from '../../src/main/services/bookBackup';
import { restoreFromBackup } from '../../src/main/services/bookRestore';

const tempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

let backupDir: string;
let cacheDir: string;
let backupEntries: BookBackupEntry[];
let cacheByHash: Map<string, { contentId: string; sha256: string }>;

function makeDeps(overrides: Partial<BookBackupDeps> = {}): BookBackupDeps {
  return {
    backupDir,
    cacheDir,
    getBackupEntries: () => backupEntries,
    saveBackupEntry: (e) => backupEntries.push(e),
    findCacheEntryByHash: (sha) => cacheByHash.get(sha) ?? null,
    ...overrides,
  };
}

beforeEach(() => {
  backupDir = mkTempDir('ponyabc-backup-');
  cacheDir = mkTempDir('ponyabc-cache-');
  backupEntries = [];
  cacheByHash = new Map();
});
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('backupBeforeRemove', () => {
  it('copies the file, verifies the copy, and records a manifest entry', async () => {
    const src = mkTempDir('ponyabc-src-');
    const file = path.join(src, 'mystery.axb');
    fs.writeFileSync(file, 'unknown content');

    const result = await backupBeforeRemove({
      sourcePath: file,
      originalFileName: 'mystery.axb',
      reason: 'uncatalogued',
      matchedContentId: null,
      deps: makeDeps(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.cacheRef).toBeNull();
    expect(backupEntries).toHaveLength(1);
    const backedUpPath = backupFilePath(makeDeps(), result.entry);
    expect(fs.readFileSync(backedUpPath, 'utf-8')).toBe('unknown content');
  });

  it('fails without touching anything if the source no longer exists', async () => {
    const result = await backupBeforeRemove({
      sourcePath: path.join(mkTempDir('ponyabc-src-'), 'gone.axb'),
      originalFileName: 'gone.axb',
      reason: 'uncatalogued',
      matchedContentId: null,
      deps: makeDeps(),
    });
    expect(result.ok).toBe(false);
    expect(backupEntries).toHaveLength(0);
  });

  it('fails on insufficient space without copying', async () => {
    const src = mkTempDir('ponyabc-src-');
    const file = path.join(src, 'x.axb');
    fs.writeFileSync(file, 'content');
    const result = await backupBeforeRemove({
      sourcePath: file,
      originalFileName: 'x.axb',
      reason: 'uncatalogued',
      matchedContentId: null,
      deps: makeDeps(),
      getFreeBytesFn: async () => 0,
    });
    expect(result.ok).toBe(false);
    expect(backupEntries).toHaveLength(0);
    expect(fs.readdirSync(path.join(backupDir, 'files').toString()).length).toBe(0);
  });

  it('references an already-verified cache file by hash instead of duplicating bytes', async () => {
    const src = mkTempDir('ponyabc-src-');
    const file = path.join(src, 'official.axb');
    fs.writeFileSync(file, 'same bytes');
    const hash = await import('node:crypto').then((c) => c.createHash('sha256').update('same bytes').digest('hex'));
    cacheByHash.set(hash, { contentId: 'b1', sha256: hash });

    const result = await backupBeforeRemove({
      sourcePath: file,
      originalFileName: 'official.axb',
      reason: 'pre-removal-current-version',
      matchedContentId: 'b1',
      deps: makeDeps(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entry.cacheRef).toEqual({ contentId: 'b1', sha256: hash });
    // No physical file duplicate was created under backups/book/files/.
    const filesDir = path.join(backupDir, 'files');
    expect(fs.existsSync(filesDir) ? fs.readdirSync(filesDir) : []).toEqual([]);
  });
});

describe('restoreFromBackup', () => {
  let penRoot: string;

  beforeEach(() => {
    session.setPenRoot(null);
    penRoot = mkTempDir('ponyabc-pen-');
    fs.mkdirSync(path.join(penRoot, 'BOOK'));
    fs.mkdirSync(path.join(penRoot, 'DIY'));
    const resolved = resolvePenRoot(penRoot);
    if (resolved.status !== 'ok') throw new Error('fixture pen root invalid');
    session.setPenRoot(resolved);
  });

  it('round-trips: back up a pen file, delete it, restore it under its original name', async () => {
    const bookFile = path.join(penRoot, 'BOOK', 'mystery.axb');
    fs.writeFileSync(bookFile, 'unknown content');

    const backup = await backupBeforeRemove({
      sourcePath: bookFile,
      originalFileName: 'mystery.axb',
      reason: 'uncatalogued',
      matchedContentId: null,
      deps: makeDeps(),
    });
    expect(backup.ok).toBe(true);
    if (!backup.ok) return;
    fs.unlinkSync(bookFile);
    expect(fs.existsSync(bookFile)).toBe(false);

    const scratch = mkTempDir('ponyabc-scratch-');
    const restoreResult = await restoreFromBackup({
      backupId: backup.entry.backupId,
      penGeneration: session.getGeneration(),
      backupDeps: makeDeps(),
      scratchBackupDir: scratch,
    });
    expect(restoreResult.status).toBe('completed');
    expect(fs.readFileSync(bookFile, 'utf-8')).toBe('unknown content');
  });

  it('a stale penGeneration is refused', async () => {
    const bookFile = path.join(penRoot, 'BOOK', 'mystery.axb');
    fs.writeFileSync(bookFile, 'unknown content');
    const backup = await backupBeforeRemove({
      sourcePath: bookFile,
      originalFileName: 'mystery.axb',
      reason: 'uncatalogued',
      matchedContentId: null,
      deps: makeDeps(),
    });
    if (!backup.ok) throw new Error('backup should have succeeded');
    const result = await restoreFromBackup({
      backupId: backup.entry.backupId,
      penGeneration: session.getGeneration() + 999,
      backupDeps: makeDeps(),
      scratchBackupDir: mkTempDir('ponyabc-scratch-'),
    });
    expect(result).toEqual({ status: 'stale-plan' });
  });

  it('an unknown backupId errors cleanly', async () => {
    const result = await restoreFromBackup({
      backupId: 'does-not-exist',
      penGeneration: session.getGeneration(),
      backupDeps: makeDeps(),
      scratchBackupDir: mkTempDir('ponyabc-scratch-'),
    });
    expect(result.status).toBe('error');
  });
});
