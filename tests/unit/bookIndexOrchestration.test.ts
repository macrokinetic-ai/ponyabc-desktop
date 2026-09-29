import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BOOK_INDEX_RECORD_BYTES } from '../../src/main/services/bookIndexReset';

/**
 * The owner's rule, decided 2026-09-29 and tested here end to end:
 *
 *   add or remove a book                 -> delete the index, once, at the end of the batch
 *   replace a book under the same name   -> leave the index alone
 *   a batch containing any add or remove -> one reset, even if it also replaced books
 *
 * The reset is deliberately the LAST step. Doing it first would leave a window where the pen has
 * neither a valid index nor the books the new one is supposed to describe.
 */

const h = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userDataDir : ''), getVersion: () => '0.0.0-test' },
}));
// Never let a test shell out to diskutil.
vi.mock('../../src/main/services/penEject', () => ({ ejectPen: vi.fn(async () => false) }));

let tmp: string;
let penDir: string;
let bookDir: string;

const indexOf = (count: number) => Buffer.alloc(count * BOOK_INDEX_RECORD_BYTES, 0xff);

function writeIndex(records: number) {
  fs.writeFileSync(path.join(bookDir, '1.BIN'), '');
  fs.writeFileSync(path.join(bookDir, 'BOOKFILE.BIN'), indexOf(records));
}
const indexPresent = () => fs.existsSync(path.join(bookDir, '1.BIN')) && fs.existsSync(path.join(bookDir, 'BOOKFILE.BIN'));

beforeEach(() => {
  vi.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bookindex-ipc-'));
  h.userDataDir = path.join(tmp, 'userData');
  fs.mkdirSync(h.userDataDir, { recursive: true });
  penDir = path.join(tmp, 'PEN');
  bookDir = path.join(penDir, 'BOOK');
  fs.mkdirSync(bookDir, { recursive: true });
  fs.mkdirSync(path.join(penDir, 'DIY'), { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function load() {
  const session = await import('../../src/main/services/session');
  const { resolvePenRoot } = await import('../../src/main/services/pathSecurity');
  const bookIndex = await import('../../src/main/ipc/bookIndex');
  const resolved = resolvePenRoot(penDir);
  if (resolved.status !== 'ok') throw new Error('fixture pen invalid');
  session.setPenRoot(resolved);
  return { session, bookIndex };
}

describe('the rule', () => {
  it('ADD: the index is deleted, once, at the end of the batch', async () => {
    fs.writeFileSync(path.join(bookDir, 'old.axb'), 'a');
    writeIndex(1);
    const { bookIndex } = await load();

    bookIndex.markBookIndexStale('added');
    expect(indexPresent()).toBe(true); // not yet — books first, index last

    const result = await bookIndex.commitBookIndexReset();

    expect(result.status).toBe('reset');
    expect(indexPresent()).toBe(false);
    expect(fs.existsSync(path.join(bookDir, 'old.axb'))).toBe(true);
  });

  it('REMOVE: the index is deleted', async () => {
    writeIndex(3);
    const { bookIndex } = await load();
    bookIndex.markBookIndexStale('removed');
    expect((await bookIndex.commitBookIndexReset()).status).toBe('reset');
    expect(indexPresent()).toBe(false);
  });

  it('REPLACE ONLY: the index is left completely alone', async () => {
    fs.writeFileSync(path.join(bookDir, 'a.axb'), 'replaced');
    writeIndex(1);
    const before = fs.readFileSync(path.join(bookDir, 'BOOKFILE.BIN'));
    const { bookIndex } = await load();

    // Nothing marked the index stale, because no position changed.
    const result = await bookIndex.commitBookIndexReset();

    expect(result.status).toBe('not-needed');
    expect(indexPresent()).toBe(true);
    expect(fs.readFileSync(path.join(bookDir, 'BOOKFILE.BIN'))).toEqual(before);
  });

  it('MIXED batch: one reset, not one per book', async () => {
    writeIndex(2);
    const { bookIndex } = await load();

    bookIndex.markBookIndexStale('added'); // a new book
    bookIndex.markBookIndexStale('removed'); // and one taken away
    bookIndex.markBookIndexStale('added'); // and another new one

    expect((await bookIndex.commitBookIndexReset()).status).toBe('reset');
    expect(indexPresent()).toBe(false);
    // The batch is finished; a second commit has nothing left to do.
    expect((await bookIndex.commitBookIndexReset()).status).toBe('not-needed');
  });
});

/**
 * A read-only directory is how a deletion is made to fail here. That only works where POSIX
 * permissions are enforced: Windows ignores the mode bits for this, and root bypasses them — in
 * either case the delete would succeed and the test would assert the opposite of what it claims.
 * Skipping is honest; a silently-inverted test is not.
 */
const canBlockDeletes = process.platform !== 'win32' && typeof process.getuid === 'function' && process.getuid() !== 0;

describe('when things go wrong', () => {
  it('a failed batch that never marked anything leaves the index intact', async () => {
    // e.g. the copy failed half way: no book was added, so no position changed.
    fs.writeFileSync(path.join(bookDir, 'a.axb'), 'a');
    writeIndex(1);
    const { bookIndex } = await load();

    expect((await bookIndex.commitBookIndexReset()).status).toBe('not-needed');
    expect(indexPresent()).toBe(true);
  });

  it.skipIf(!canBlockDeletes)('a failed deletion keeps the reset pending instead of forgetting it', async () => {
    writeIndex(1);
    const { bookIndex } = await load();
    bookIndex.markBookIndexStale('added');

    fs.chmodSync(bookDir, 0o500); // can list, cannot unlink
    const result = await bookIndex.commitBookIndexReset();
    fs.chmodSync(bookDir, 0o755);

    expect(result.status).toBe('still-pending');
    expect(bookIndex.isBookIndexStale()).toBe(true);
    // The books are all correct on the pen; only the index is stale.
    expect(indexPresent()).toBe(true);
  });

  it('completes an owed reset the next time the pen connects', async () => {
    writeIndex(1);
    const { bookIndex } = await load();
    // The app is closed (or the pen pulled) straight after the add, before the batch could
    // finish. No chmod needed: the point is that the flag was persisted at the add, not at the
    // end of the batch, so it survives to the next session.
    bookIndex.markBookIndexStale('added');

    vi.resetModules();
    const again = await load();
    expect(again.bookIndex.isBookIndexStale()).toBe(true);
    expect((await again.bookIndex.completePendingBookIndexReset()).status).toBe('reset');
    expect(indexPresent()).toBe(false);
  });

  it('keeps each pen\'s pending reset to itself', async () => {
    writeIndex(1);
    const { session, bookIndex } = await load();
    bookIndex.markBookIndexStale('added');

    const other = path.join(tmp, 'OTHER-PEN');
    fs.mkdirSync(path.join(other, 'BOOK'), { recursive: true });
    fs.mkdirSync(path.join(other, 'DIY'), { recursive: true });
    const { resolvePenRoot } = await import('../../src/main/services/pathSecurity');
    const resolved = resolvePenRoot(other);
    if (resolved.status !== 'ok') throw new Error('bad fixture');
    session.setPenRoot(resolved);

    expect(bookIndex.isBookIndexStale()).toBe(false);
    expect((await bookIndex.commitBookIndexReset()).status).toBe('not-needed');
  });

  it('does nothing at all without a pen', async () => {
    const { session, bookIndex } = await load();
    session.setPenRoot(null);
    expect((await bookIndex.commitBookIndexReset()).status).toBe('no-pen-selected');
    expect(bookIndex.getBookIndexStatus()).toEqual({ status: 'no-pen-selected' });
  });
});

describe('self-heal', () => {
  it('reports a mismatch a parent caused with Finder, and never fixes it silently', async () => {
    fs.writeFileSync(path.join(bookDir, 'a.axb'), 'a');
    fs.writeFileSync(path.join(bookDir, 'b.axb'), 'b');
    writeIndex(1); // the index only knows about one book
    const { bookIndex } = await load();

    const status = bookIndex.getBookIndexStatus();
    expect(status).toMatchObject({ status: 'mismatch', recordCount: 1, bookCount: 2, resetPending: false });
    // Merely looking never changes the pen.
    expect(indexPresent()).toBe(true);

    // ...only the explicit action does.
    expect((await bookIndex.fixBookIndex()).status).toBe('reset');
    expect(indexPresent()).toBe(false);
  });

  it.skipIf(!canBlockDeletes)('a fix that fails stays owed, so it completes on the next connection', async () => {
    fs.writeFileSync(path.join(bookDir, 'a.axb'), 'a');
    writeIndex(5);
    const { bookIndex } = await load();

    fs.chmodSync(bookDir, 0o500);
    expect((await bookIndex.fixBookIndex()).status).toBe('still-pending');
    fs.chmodSync(bookDir, 0o755);

    expect(bookIndex.isBookIndexStale()).toBe(true);
    expect((await bookIndex.completePendingBookIndexReset()).status).toBe('reset');
  });
});

describe('the firmware upgrade', () => {
  it('settles a reset we owed, because it deletes the same two files', async () => {
    writeIndex(1);
    const { bookIndex } = await load();
    bookIndex.markBookIndexStale('added');

    bookIndex.noteFirmwareClearedBookIndex();

    expect(bookIndex.isBookIndexStale()).toBe(false);
  });
});
