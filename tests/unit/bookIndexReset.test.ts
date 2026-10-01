import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  BOOK_INDEX_FILES,
  BOOK_INDEX_RECORD_BYTES,
  checkBookIndexHealth,
  cleanMacSidecars,
  isPenScannedBookFileName,
  resetBookIndex,
} from '../../src/main/services/bookIndexReset';

/**
 * Established on real pens 2026-09-29: BOOKFILE.BIN is a flat array of 44-byte records written
 * by the pen's firmware, one per .axb, identifying books by POSITION and holding no filenames.
 * So removing a book shifts every later book down one and the pen plays the wrong story; adding
 * one leaves it past the end of the index and silent. A same-name replacement changes neither.
 */

let tmp: string;
const write = (p: string, body: string | Buffer) => fs.writeFileSync(p, body);
/** A BOOKFILE.BIN describing `count` books. */
const indexOf = (count: number) => Buffer.alloc(count * BOOK_INDEX_RECORD_BYTES, 0xff);

function makePen(opts: { books?: string[]; records?: number | null; extra?: string[] } = {}): string {
  const root = path.join(tmp, 'PEN');
  const book = path.join(root, 'BOOK');
  fs.mkdirSync(book, { recursive: true });
  fs.mkdirSync(path.join(root, 'DIY'), { recursive: true });
  for (const name of opts.books ?? []) write(path.join(book, name), 'book bytes');
  for (const name of opts.extra ?? []) write(path.join(book, name), 'x');
  if (opts.records !== null && opts.records !== undefined) {
    write(path.join(book, '1.BIN'), '');
    write(path.join(book, 'BOOKFILE.BIN'), indexOf(opts.records));
  }
  return root;
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bookindex-'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('resetting the index', () => {
  it('deletes both files so the pen rebuilds them', () => {
    const root = makePen({ books: ['a.axb'], records: 1 });
    const book = path.join(root, 'BOOK');

    const r = resetBookIndex(root);

    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(book, '1.BIN'))).toBe(false);
    expect(fs.existsSync(path.join(book, 'BOOKFILE.BIN'))).toBe(false);
    expect(fs.existsSync(path.join(book, 'a.axb'))).toBe(true);
  });

  it('never touches the books themselves', () => {
    const root = makePen({ books: ['a.axb', 'b.axb'], records: 2, extra: ['english.dic', 'books.csv'] });
    resetBookIndex(root);
    expect(fs.readdirSync(path.join(root, 'BOOK')).sort()).toEqual(['a.axb', 'b.axb', 'books.csv', 'english.dic']);
  });

  it('succeeds when the files are already gone', () => {
    const root = makePen({ books: ['a.axb'], records: null });
    const r = resetBookIndex(root);
    expect(r.ok).toBe(true);
    expect(r.ok && r.deleted).toEqual([]);
  });

  it('refuses a drive that is not a pen', () => {
    const notAPen = path.join(tmp, 'USB');
    fs.mkdirSync(path.join(notAPen, 'BOOK'), { recursive: true }); // BOOK but no DIY
    write(path.join(notAPen, 'BOOK', '1.BIN'), '');

    const r = resetBookIndex(notAPen);

    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toBe('not-a-pen');
    expect(fs.existsSync(path.join(notAPen, 'BOOK', '1.BIN'))).toBe(true);
  });

  it('targets exactly the two index files', () => {
    expect([...BOOK_INDEX_FILES]).toEqual(['1.BIN', 'BOOKFILE.BIN']);
  });
});

describe('which files the pen scans', () => {
  it('knows the extensions read out of the firmware', () => {
    for (const name of ['a.axb', 'A.AXB', 'b.ax1', 'c.smp', 'english.dic', 'd.bnf']) {
      expect(isPenScannedBookFileName(name), name).toBe(true);
    }
  });

  it('treats a staged write as invisible', () => {
    // safeWriteFile stages as ".ponyabc-tmp-<hex>-<name>.part" with the real extension stripped,
    // so a half-written book cannot be picked up as a book however the firmware matches names.
    expect(isPenScannedBookFileName('.ponyabc-tmp-a1b2c3-phonics card.part')).toBe(false);
    expect(isPenScannedBookFileName('phonics card.axb.part')).toBe(false);
  });

  it('ignores macOS sidecars', () => {
    expect(isPenScannedBookFileName('._a.axb')).toBe(false);
  });
});

describe('self-heal check', () => {
  it('is happy when the record count matches the books', () => {
    const health = checkBookIndexHealth(makePen({ books: ['a.axb', 'b.axb'], records: 2 }));
    expect(health.status).toBe('ok');
    expect(health).toMatchObject({ recordCount: 2, bookCount: 2, malformed: false });
  });

  it('counts only .axb — a dictionary is not a book', () => {
    // Measured on a real card: 37 .axb plus english.dic gave exactly 37 records.
    const health = checkBookIndexHealth(makePen({ books: ['a.axb'], records: 1, extra: ['english.dic', 'books.csv'] }));
    expect(health.status).toBe('ok');
    expect(health.bookCount).toBe(1);
  });

  it('spots a book a parent added in Explorer', () => {
    const health = checkBookIndexHealth(makePen({ books: ['a.axb', 'b.axb', 'new.axb'], records: 2 }));
    expect(health.status).toBe('mismatch');
    expect(health).toMatchObject({ recordCount: 2, bookCount: 3 });
  });

  it('spots a book a parent deleted in Finder — the dangerous one', () => {
    // Every later book shifts down a position, so the pen reads the wrong story aloud.
    const health = checkBookIndexHealth(makePen({ books: ['a.axb'], records: 4 }));
    expect(health.status).toBe('mismatch');
  });

  it('reports no-index rather than a problem when both files are gone', () => {
    // This is the state we deliberately leave the pen in after an add or remove.
    const health = checkBookIndexHealth(makePen({ books: ['a.axb'], records: null }));
    expect(health.status).toBe('no-index');
    expect(health.recordCount).toBeNull();
  });

  it('treats an index of an impossible size as a mismatch, not as a record count', () => {
    const root = makePen({ books: ['a.axb'], records: 1 });
    write(path.join(root, 'BOOK', 'BOOKFILE.BIN'), Buffer.alloc(50, 0xff)); // not a whole number of records
    const health = checkBookIndexHealth(root);
    expect(health.malformed).toBe(true);
    expect(health.status).toBe('mismatch');
  });

  it('flags macOS leftovers a customer copied in', () => {
    const root = makePen({ books: ['a.axb'], records: 1, extra: ['._a.axb', '.DS_Store'] });
    const health = checkBookIndexHealth(root);
    expect(health.appleDoubleFiles).toEqual(['._a.axb']);
    expect(health.hasDsStore).toBe(true);
    // A sidecar is not a book, so it must not move the count.
    expect(health.bookCount).toBe(1);
  });

  it('says unreadable for something that is not a pen at all', () => {
    expect(checkBookIndexHealth(path.join(tmp, 'nope')).status).toBe('unreadable');
  });
});

describe('macOS cleanup', () => {
  it('removes only the sidecars for files we wrote, plus .DS_Store', () => {
    const root = makePen({ books: ['mine.axb', 'theirs.axb'], records: 2, extra: ['._mine.axb', '._theirs.axb', '.DS_Store'] });
    const book = path.join(root, 'BOOK');

    const removed = cleanMacSidecars(book, ['mine.axb']);

    expect(removed.sort()).toEqual(['.DS_Store', '._mine.axb']);
    // Not ours to delete — it was already on the pen before we touched it.
    expect(fs.existsSync(path.join(book, '._theirs.axb'))).toBe(true);
    expect(fs.existsSync(path.join(book, 'mine.axb'))).toBe(true);
  });

  it('does nothing when there is nothing to clean', () => {
    const root = makePen({ books: ['a.axb'], records: 1 });
    expect(cleanMacSidecars(path.join(root, 'BOOK'), ['a.axb'])).toEqual([]);
  });
});
