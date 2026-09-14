import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BookBackupEntry } from '../../src/shared/types';
import { resolvePenRoot } from '../../src/main/services/pathSecurity';
import * as session from '../../src/main/services/session';
import { removeFromPen } from '../../src/main/services/bookRemove';
import type { BookBackupDeps } from '../../src/main/services/bookBackup';

const tempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

let penRoot: string;
let backupDir: string;
let backupEntries: BookBackupEntry[];

function makeBackupDeps(): BookBackupDeps {
  return {
    backupDir,
    cacheDir: mkTempDir('ponyabc-cache-'),
    getBackupEntries: () => backupEntries,
    saveBackupEntry: (e) => backupEntries.push(e),
    findCacheEntryByHash: () => null,
  };
}

beforeEach(() => {
  session.setPenRoot(null);
  penRoot = mkTempDir('ponyabc-pen-');
  fs.mkdirSync(path.join(penRoot, 'BOOK'));
  fs.mkdirSync(path.join(penRoot, 'DIY'));
  const resolved = resolvePenRoot(penRoot);
  if (resolved.status !== 'ok') throw new Error('fixture pen root invalid');
  session.setPenRoot(resolved);

  backupDir = mkTempDir('ponyabc-backup-');
  backupEntries = [];
});
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('removeFromPen', () => {
  it('removes only the selected BOOK file — sibling BOOK files and DIY untouched', async () => {
    fs.writeFileSync(path.join(penRoot, 'BOOK', 'target.axb'), 'to remove');
    fs.writeFileSync(path.join(penRoot, 'BOOK', 'keep.axb'), 'keep me');
    fs.writeFileSync(path.join(penRoot, 'DIY', 'song.mp3'), 'diy content');

    const result = await removeFromPen({
      fileName: 'target.axb',
      penGeneration: session.getGeneration(),
      reason: 'uncatalogued',
      matchedContentId: null,
      backupDeps: makeBackupDeps(),
    });

    expect(result.status).toBe('completed');
    expect(result.freedBytes).toBe('to remove'.length);
    expect(fs.existsSync(path.join(penRoot, 'BOOK', 'target.axb'))).toBe(false);
    expect(fs.readFileSync(path.join(penRoot, 'BOOK', 'keep.axb'), 'utf-8')).toBe('keep me');
    expect(fs.readFileSync(path.join(penRoot, 'DIY', 'song.mp3'), 'utf-8')).toBe('diy content');
    expect(backupEntries).toHaveLength(1);
  });

  it('a backup failure blocks the removal — the original file is still present afterward', async () => {
    fs.writeFileSync(path.join(penRoot, 'BOOK', 'target.axb'), 'content');
    const deps = makeBackupDeps();
    // Force the backup's own "files" subdirectory creation to fail by pre-occupying that
    // path with a plain file instead of a directory.
    fs.writeFileSync(path.join(deps.backupDir, 'files'), 'not a directory');

    const result = await removeFromPen({
      fileName: 'target.axb',
      penGeneration: session.getGeneration(),
      reason: 'uncatalogued',
      matchedContentId: null,
      backupDeps: deps,
    });
    expect(result.status).toBe('backup-failed');
    expect(fs.existsSync(path.join(penRoot, 'BOOK', 'target.axb'))).toBe(true);
  });

  it('a stale penGeneration (pen swapped since the listing was fetched) is refused, never touches the new pen', async () => {
    fs.writeFileSync(path.join(penRoot, 'BOOK', 'target.axb'), 'content');
    const staleGeneration = session.getGeneration();

    // Simulate a pen swap: a different device now mounted, bumping the generation.
    const otherPenRoot = mkTempDir('ponyabc-other-pen-');
    fs.mkdirSync(path.join(otherPenRoot, 'BOOK'));
    fs.mkdirSync(path.join(otherPenRoot, 'DIY'));
    const otherResolved = resolvePenRoot(otherPenRoot);
    if (otherResolved.status !== 'ok') throw new Error('fixture pen root invalid');
    session.setPenRoot(otherResolved);

    const result = await removeFromPen({
      fileName: 'target.axb',
      penGeneration: staleGeneration,
      reason: 'uncatalogued',
      matchedContentId: null,
      backupDeps: makeBackupDeps(),
    });
    expect(result.status).toBe('stale-plan');
    // The original pen's file was never touched, and nothing was removed from the new pen either.
    expect(fs.existsSync(path.join(penRoot, 'BOOK', 'target.axb'))).toBe(true);
  });

  it('device-disconnected when the pen is gone before removal starts', async () => {
    const gen = session.getGeneration();
    fs.rmSync(penRoot, { recursive: true, force: true });
    const result = await removeFromPen({
      fileName: 'target.axb',
      penGeneration: gen,
      reason: 'uncatalogued',
      matchedContentId: null,
      backupDeps: makeBackupDeps(),
    });
    expect(result.status).toBe('device-disconnected');
  });

  it('aborts with target-changed-since-backup and does not delete if the file changed between backup and delete', async () => {
    const filePath = path.join(penRoot, 'BOOK', 'target.axb');
    fs.writeFileSync(filePath, 'original content');

    const deps = makeBackupDeps();
    const realSave = deps.saveBackupEntry;
    deps.saveBackupEntry = (e) => {
      // Simulate something else overwriting the pen file in the gap right after the backup
      // copy completes but before the delete step re-verifies it.
      fs.writeFileSync(filePath, 'different content written concurrently');
      realSave(e);
    };

    const result = await removeFromPen({
      fileName: 'target.axb',
      penGeneration: session.getGeneration(),
      reason: 'uncatalogued',
      matchedContentId: null,
      backupDeps: deps,
    });
    expect(result.status).toBe('target-changed-since-backup');
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('different content written concurrently');
  });
});
