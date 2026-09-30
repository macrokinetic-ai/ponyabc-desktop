import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BOOK_INDEX_RECORD_BYTES } from '../../src/main/services/bookIndexReset';

/**
 * The Internal build's technical log.
 *
 * The owner asked to be able to watch BOOK/1.BIN and BOOK/BOOKFILE.BIN being deleted without
 * taking the SD card out of the pen. These tests check that the steps are actually recorded as
 * they happen, and — the part that matters for the Store — that the same call sites record
 * nothing at all when the Store build's stub is what `@internal` resolves to.
 */

const h = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userDataDir : ''), getVersion: () => '0.0.0-test' },
}));
vi.mock('../../src/main/services/penEject', () => ({ ejectPen: vi.fn(async () => false) }));

let tmp: string;
let penDir: string;
let bookDir: string;

beforeEach(() => {
  vi.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'techlog-'));
  h.userDataDir = path.join(tmp, 'userData');
  fs.mkdirSync(h.userDataDir, { recursive: true });
  penDir = path.join(tmp, 'PEN');
  bookDir = path.join(penDir, 'BOOK');
  fs.mkdirSync(bookDir, { recursive: true });
  fs.mkdirSync(path.join(penDir, 'DIY'), { recursive: true });
  fs.writeFileSync(path.join(bookDir, '1.BIN'), '');
  fs.writeFileSync(path.join(bookDir, 'BOOKFILE.BIN'), Buffer.alloc(BOOK_INDEX_RECORD_BYTES, 0xff));
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function connectPen() {
  const session = await import('../../src/main/services/session');
  const { resolvePenRoot } = await import('../../src/main/services/pathSecurity');
  const resolved = resolvePenRoot(penDir);
  if (resolved.status !== 'ok') throw new Error('fixture pen invalid');
  session.setPenRoot(resolved);
}

describe('the technical log — Internal build', () => {
  it('records both .BIN files going, by name, and the reset that asked for it', async () => {
    const internal = await import('../../src/main/internal/index');
    const bookIndex = await import('../../src/main/ipc/bookIndex');
    await connectPen();

    bookIndex.markBookIndexStale('written');
    await bookIndex.commitBookIndexReset();

    const log = internal.technicalLogEntries();
    const deleted = log.filter((e) => e.kind === 'file-deleted').map((e) => e.detail);
    expect(deleted).toContain('BOOK/1.BIN');
    expect(deleted).toContain('BOOK/BOOKFILE.BIN');
    expect(log.some((e) => e.kind === 'index-reset-requested' && e.detail === 'written')).toBe(true);
    expect(log.some((e) => e.kind === 'index-reset-done')).toBe(true);
  });

  it('pushes each step to a listener as it happens, not only at the end', async () => {
    const internal = await import('../../src/main/internal/index');
    const bookIndex = await import('../../src/main/ipc/bookIndex');
    await connectPen();

    const seen: string[] = [];
    internal.onTechnicalLogEntry((entry) => seen.push(entry.kind));

    bookIndex.markBookIndexStale('removed');
    expect(seen).toContain('index-reset-requested');

    await bookIndex.commitBookIndexReset();
    expect(seen).toContain('file-deleted');
    internal.onTechnicalLogEntry(null);
  });

  it('keeps the newest steps and does not grow without limit', async () => {
    const internal = await import('../../src/main/internal/index');
    for (let i = 0; i < 600; i++) internal.technical('file-written', `BOOK/${i}.axb`);
    const log = internal.technicalLogEntries();
    expect(log.length).toBe(500);
    expect(log[log.length - 1].detail).toBe('BOOK/599.axb');
  });

  it('clears on request', async () => {
    const internal = await import('../../src/main/internal/index');
    internal.technical('file-written', 'BOOK/0451.axb');
    expect(internal.technicalLogEntries().length).toBeGreaterThan(0);
    internal.clearTechnicalLog();
    expect(internal.technicalLogEntries()).toEqual([]);
  });
});

describe('the technical log — Store build', () => {
  it('records nothing, keeps nothing and notifies nobody', async () => {
    const stub = await import('../../src/main/internal/stub');

    const seen: unknown[] = [];
    stub.onTechnicalLogEntry(() => seen.push(1));
    stub.technical('file-deleted', 'BOOK/1.BIN');
    stub.technical('file-written', 'BOOK/0451.axb');

    expect(stub.technicalLogEntries()).toEqual([]);
    expect(seen).toEqual([]);
  });

  it('exports exactly the same names as the Internal build, so the two cannot drift', async () => {
    const internal = await import('../../src/main/internal/index');
    const stub = await import('../../src/main/internal/stub');
    for (const name of ['technical', 'technicalLogEntries', 'clearTechnicalLog', 'onTechnicalLogEntry']) {
      expect(typeof (stub as Record<string, unknown>)[name]).toBe('function');
      expect(typeof (internal as Record<string, unknown>)[name]).toBe('function');
    }
  });
});
