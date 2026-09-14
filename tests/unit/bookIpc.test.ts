import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userDataDir : '') },
}));

import { resolvePenRoot } from '../../src/main/services/pathSecurity';
import * as session from '../../src/main/services/session';
import { bookRemove, bookRestore } from '../../src/main/ipc/book';
import { createJsonStore } from '../../src/main/services/bookStore';
import type { BookBackupEntry, BookCatalogSnapshot } from '../../src/shared/types';

const tempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

let penRoot: string;

beforeEach(() => {
  session.setPenRoot(null);
  h.userDataDir = mkTempDir('ponyabc-userdata-');
  penRoot = mkTempDir('ponyabc-pen-');
  fs.mkdirSync(path.join(penRoot, 'BOOK'));
  fs.mkdirSync(path.join(penRoot, 'DIY'));
  const resolved = resolvePenRoot(penRoot);
  if (resolved.status !== 'ok') throw new Error('fixture pen root invalid');
  session.setPenRoot(resolved);
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeCatalog(snapshot: BookCatalogSnapshot) {
  const store = createJsonStore<BookCatalogSnapshot | null>(path.join(h.userDataDir, 'bookCatalogCache', 'catalog.json'), () => null);
  store.set(snapshot);
}

describe('bookRemove (ipc/book.ts) — main-process enforcement, not just a hidden button', () => {
  it('refuses to remove a file with no catalog at all (every pen file is "unknown")', async () => {
    fs.writeFileSync(path.join(penRoot, 'BOOK', 'mystery.axb'), 'unknown content');
    const result = await bookRemove({ fileName: 'mystery.axb', penGeneration: session.getGeneration() });
    expect(result.status).toBe('unknown-content');
    expect(fs.existsSync(path.join(penRoot, 'BOOK', 'mystery.axb'))).toBe(true);
  });

  it('refuses to remove a file that does not match any catalog entry, even with a catalog loaded', async () => {
    writeCatalog({
      entries: [
        {
          contentId: 'b1',
          filename: '0451.axb',
          filenameSource: 'declared',
          sha256: null,
          sizeBytes: 5,
          friendlyName: 'Book One',
          friendlyNameI18n: null,
          contentLanguages: [],
          sortOrder: 0,
          downloadUrl: 'https://x/download?id=b1',
        },
      ],
      fetchedAtMs: 1,
      source: 'fixture',
      conflicts: [],
    });
    fs.writeFileSync(path.join(penRoot, 'BOOK', 'mystery.axb'), 'unknown content');
    const result = await bookRemove({ fileName: 'mystery.axb', penGeneration: session.getGeneration() });
    expect(result.status).toBe('unknown-content');
    expect(fs.existsSync(path.join(penRoot, 'BOOK', 'mystery.axb'))).toBe(true);
  });

  it('a request for a filename that is not even on the pen is refused the same way, never falls through to deleting something else', async () => {
    const result = await bookRemove({ fileName: 'does-not-exist.axb', penGeneration: session.getGeneration() });
    expect(result.status).toBe('unknown-content');
  });

  it('allows removal of a genuinely matched BOOK file', async () => {
    const crypto = await import('node:crypto');
    const bytes = 'official content';
    const hash = crypto.createHash('sha256').update(bytes).digest('hex');
    writeCatalog({
      entries: [
        {
          contentId: 'b1',
          filename: '0451.axb',
          filenameSource: 'declared',
          sha256: hash,
          sizeBytes: bytes.length,
          friendlyName: 'Book One',
          friendlyNameI18n: null,
          contentLanguages: [],
          sortOrder: 0,
          downloadUrl: 'https://x/download?id=b1',
        },
      ],
      fetchedAtMs: 1,
      source: 'fixture',
      conflicts: [],
    });
    fs.writeFileSync(path.join(penRoot, 'BOOK', '0451.axb'), bytes);
    const result = await bookRemove({ fileName: '0451.axb', penGeneration: session.getGeneration() });
    expect(result.status).toBe('completed');
    expect(fs.existsSync(path.join(penRoot, 'BOOK', '0451.axb'))).toBe(false);
  });
});

describe('bookRestore (ipc/book.ts) — retired Unknown-backup restore path is blocked', () => {
  it('refuses to restore a backup whose reason is "uncatalogued"', async () => {
    const backupManifestFile = path.join(h.userDataDir, 'backups', 'book', 'manifest.json');
    const entry: BookBackupEntry = {
      backupId: 'legacy-1',
      originalFileName: 'old-unknown.axb',
      sizeBytes: 5,
      sha256: 'a'.repeat(64),
      reason: 'uncatalogued',
      matchedContentId: null,
      createdAtMs: 1,
      cacheRef: null,
    };
    createJsonStore<BookBackupEntry[]>(backupManifestFile, () => []).set([entry]);

    const result = await bookRestore({ backupId: 'legacy-1', penGeneration: session.getGeneration() });
    expect(result.status).toBe('restore-not-allowed');
  });
});
