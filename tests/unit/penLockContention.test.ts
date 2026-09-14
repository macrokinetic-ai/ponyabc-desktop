import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BookCacheEntry, BookCatalogEntry } from '../../src/shared/types';
import { resolvePenRoot } from '../../src/main/services/pathSecurity';
import * as session from '../../src/main/services/session';
import { acquirePenLock } from '../../src/main/services/penOperationLock';
import { executeReplaceSticker } from '../../src/main/services/transferPlanner';
import { addToPen } from '../../src/main/services/bookInstall';
import { cacheFilePath } from '../../src/main/services/bookDownload';

const tempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

let penRoot: string;
let computerFolder: string;
let backupRootDir: string;
let cacheDir: string;

beforeEach(() => {
  session.setPenRoot(null);
  session.setComputerFolder(null);

  penRoot = mkTempDir('ponyabc-pen-');
  fs.mkdirSync(path.join(penRoot, 'BOOK'));
  fs.mkdirSync(path.join(penRoot, 'DIY'));
  const resolved = resolvePenRoot(penRoot);
  if (resolved.status !== 'ok') throw new Error('fixture pen root invalid');
  session.setPenRoot(resolved);

  computerFolder = fs.realpathSync(mkTempDir('ponyabc-computer-'));
  session.setComputerFolder(computerFolder);

  backupRootDir = mkTempDir('ponyabc-backuproot-');
  cacheDir = mkTempDir('ponyabc-cache-');
});
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('DIY and BOOK pen writes share one lock', () => {
  it('a BOOK install and a DIY sticker replace both wait for an externally-held pen lock, then both complete', async () => {
    // DIY fixture: an existing sticker on the pen, and a replacement source on the computer.
    fs.writeFileSync(path.join(penRoot, 'DIY', '0451.mp3'), 'old sticker audio');
    fs.writeFileSync(path.join(computerFolder, 'new.mp3'), 'new sticker audio');

    // BOOK fixture: a cache-ready entry, so addToPen's write step is reached without any
    // network dependency in this test.
    const bytes = Buffer.from('official book content');
    const bookEntry: BookCatalogEntry = {
      contentId: 'b1',
      filename: '0451.axb',
      filenameSource: 'declared',
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      sizeBytes: bytes.length,
      friendlyName: 'Book One',
      friendlyNameI18n: null,
      contentLanguages: [],
      sortOrder: 0,
      downloadUrl: 'https://x.test/download?id=b1',
    };
    const cacheEntry: BookCacheEntry = { contentId: 'b1', sha256: bookEntry.sha256 as string, sizeBytes: bytes.length, filename: bookEntry.filename, cachedAtMs: 1 };
    fs.writeFileSync(cacheFilePath(cacheDir, cacheEntry.contentId, cacheEntry.sha256), bytes);

    const gen = session.getGeneration();

    // A third, phantom operation holds the shared pen lock first.
    const releaseOuter = await acquirePenLock();

    const diyPromise = executeReplaceSticker({
      penFileName: '0451.mp3',
      computerFileName: 'new.mp3',
      penGeneration: gen,
      backupRootDir,
    });
    const bookPromise = addToPen(bookEntry, gen, {
      cacheDir,
      backupDir: mkTempDir('ponyabc-scratch-'),
      getCacheEntries: () => [cacheEntry],
      saveCacheEntry: () => {},
      getFreeBytesFn: async () => 10_000_000,
    });

    // Give both a chance to run up to (and block on) acquirePenLock() — neither should have
    // written anything yet, since the outer hold hasn't been released.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(fs.readFileSync(path.join(penRoot, 'DIY', '0451.mp3'), 'utf-8')).toBe('old sticker audio');
    expect(fs.existsSync(path.join(penRoot, 'BOOK', '0451.axb'))).toBe(false);

    releaseOuter();

    const [diyResult, bookResult] = await Promise.all([diyPromise, bookPromise]);
    expect(diyResult.status).toBe('completed');
    expect(bookResult.status).toBe('completed');
    expect(fs.readFileSync(path.join(penRoot, 'DIY', '0451.mp3'), 'utf-8')).toBe('new sticker audio');
    expect(fs.readFileSync(path.join(penRoot, 'BOOK', '0451.axb'), 'utf-8')).toBe('official book content');
  });
});
