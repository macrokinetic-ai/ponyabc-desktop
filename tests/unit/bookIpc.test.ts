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
import { bookRemove, bookRestore, bookVerifyCancel, bookVerifyContent } from '../../src/main/ipc/book';
import { createJsonStore } from '../../src/main/services/bookStore';
import { IPC } from '../../src/shared/ipcChannels';
import type { BookBackupEntry, BookCatalogSnapshot, BookVerifyRecord } from '../../src/shared/types';
import type { BrowserWindow } from 'electron';

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

function makeWindow() {
  const send = vi.fn();
  return { win: { webContents: { send } } as unknown as BrowserWindow, send };
}

async function waitForCall(send: ReturnType<typeof vi.fn>, channel: string, timeoutMs = 3000): Promise<unknown> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const call = send.mock.calls.find((c) => c[0] === channel);
    if (call) return call[1];
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`timed out waiting for a send() call on ${channel}`);
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

describe('bookVerifyContent / bookVerifyCancel (ipc/book.ts) — explicit, never automatic; never blocks the invoking call', () => {
  it('verifies a real matched pen file, persists a verify record, and pushes the resolved status for both panes', async () => {
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
          updatedAtMs: null,
          downloadUrl: 'https://x/download?id=b1',
        },
      ],
      fetchedAtMs: 1,
      source: 'fixture',
      conflicts: [],
    });
    fs.writeFileSync(path.join(penRoot, 'BOOK', '0451.axb'), bytes);

    const { win, send } = makeWindow();
    const started = await bookVerifyContent(win, { fileNames: ['0451.axb'], penGeneration: session.getGeneration() });
    expect(started.status).toBe('started');

    const update = await waitForCall(send, IPC.bookVerifyUpdate);
    expect(update).toEqual({
      fileName: '0451.axb',
      contentId: 'b1',
      result: { penStatus: 'verified-current', catalogStatus: 'on-pen-current' },
    });

    const index = createJsonStore<BookVerifyRecord[]>(path.join(h.userDataDir, 'bookVerifyIndex.json'), () => []).get();
    expect(index).toHaveLength(1);
    expect(index[0]).toMatchObject({ fileName: '0451.axb', contentId: 'b1', observedSha256: hash, officialSha256: hash });
  });

  it('a genuinely differing file resolves to verified-differs, not a guessed/default outcome', async () => {
    const crypto = await import('node:crypto');
    const officialHash = crypto.createHash('sha256').update('official content').digest('hex');
    writeCatalog({
      entries: [
        {
          contentId: 'b1',
          filename: '0451.axb',
          filenameSource: 'declared',
          sha256: officialHash,
          sizeBytes: 'different content on the pen'.length,
          friendlyName: 'Book One',
          friendlyNameI18n: null,
          contentLanguages: [],
          sortOrder: 0,
          updatedAtMs: null,
          downloadUrl: 'https://x/download?id=b1',
        },
      ],
      fetchedAtMs: 1,
      source: 'fixture',
      conflicts: [],
    });
    fs.writeFileSync(path.join(penRoot, 'BOOK', '0451.axb'), 'different content on the pen');

    const { win, send } = makeWindow();
    await bookVerifyContent(win, { fileNames: ['0451.axb'], penGeneration: session.getGeneration() });
    const update = await waitForCall(send, IPC.bookVerifyUpdate);
    expect(update).toMatchObject({ result: { penStatus: 'verified-differs', catalogStatus: 'on-pen-differs' } });
  });

  it('refuses when no pen is connected', async () => {
    session.setPenRoot(null);
    const { win } = makeWindow();
    const result = await bookVerifyContent(win, { fileNames: ['0451.axb'], penGeneration: session.getGeneration() });
    expect(result.status).toBe('no-pen-selected');
  });

  it('refuses a stale penGeneration', async () => {
    const { win } = makeWindow();
    const result = await bookVerifyContent(win, { fileNames: [], penGeneration: session.getGeneration() - 1 });
    expect(result.status).toBe('stale-plan');
  });

  it('never verifies an Unknown/unmatched file, even if its filename is requested directly', async () => {
    fs.writeFileSync(path.join(penRoot, 'BOOK', 'mystery.axb'), 'not in any catalog');
    const { win, send } = makeWindow();
    const started = await bookVerifyContent(win, { fileNames: ['mystery.axb'], penGeneration: session.getGeneration() });
    expect(started.status).toBe('started');
    // Give the detached batch a moment to run to completion — it should finish with nothing
    // to verify (the file was filtered out before any hashing), so no update/progress event
    // for it ever arrives.
    await new Promise((r) => setTimeout(r, 100));
    expect(send).not.toHaveBeenCalledWith(IPC.bookVerifyUpdate, expect.anything());
    expect(send).not.toHaveBeenCalledWith(IPC.bookVerifyProgress, expect.anything());
  });

  it('cancelling before the batch starts reading prevents it from ever touching the file', async () => {
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
          updatedAtMs: null,
          downloadUrl: 'https://x/download?id=b1',
        },
      ],
      fetchedAtMs: 1,
      source: 'fixture',
      conflicts: [],
    });
    fs.writeFileSync(path.join(penRoot, 'BOOK', '0451.axb'), bytes);

    const { win, send } = makeWindow();
    const started = await bookVerifyContent(win, { fileNames: ['0451.axb'], penGeneration: session.getGeneration() });
    expect(started.status).toBe('started');
    const cancelled = bookVerifyCancel();
    expect(cancelled.ok).toBe(true);

    await new Promise((r) => setTimeout(r, 100));
    expect(send).not.toHaveBeenCalledWith(IPC.bookVerifyUpdate, expect.anything());

    const index = createJsonStore<BookVerifyRecord[]>(path.join(h.userDataDir, 'bookVerifyIndex.json'), () => []).get();
    expect(index).toHaveLength(0);
  });

  it('bookVerifyCancel is a harmless no-op when nothing is running', () => {
    expect(bookVerifyCancel().ok).toBe(false);
  });
});
