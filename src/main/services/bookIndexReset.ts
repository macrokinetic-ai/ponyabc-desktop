import fs from 'node:fs';
import path from 'node:path';
import { isEligibleAxbFileName, resolvePenRoot } from './pathSecurity';
import { runFirmwarePreflight, summarizePreflight } from './firmwarePreflight';
import * as internal from '@internal';

/**
 * The pen's book index, and when it has to be thrown away.
 *
 * **Established on real pens, 2026-09-29.** `BOOK/BOOKFILE.BIN` is written by the pen's own
 * firmware on power-on, from whatever `.axb` files it finds in `BOOK/`. It is a flat array of
 * 44-byte records — one per book, holding an OID code range and **no filename at all**. A book
 * is identified purely by its **position** in that array. `BOOK/1.BIN` is a zero-byte marker;
 * while the pair exists the pen trusts the index and does not rebuild it.
 *
 * That makes a stale index actively dangerous rather than merely unhelpful:
 *
 * - **Remove a book** and every later book shifts down one position, so touching a page plays
 *   **the wrong book's audio**. Nothing looks broken; it just reads the wrong story to a child.
 * - **Add a book** and it sits beyond the end of the index, so it is silent.
 * - **Replace a book with the same filename** changes nothing about position or order, so the
 *   index stays correct. (Benny tested this on a real pen; it works.)
 *
 * Hence the owner's rule, decided 2026-09-29:
 *
 *     add or remove  -> delete both index files, once, at the end of the batch
 *     same-name replace -> leave them alone
 *     a batch containing any add or remove -> delete once, even if it also replaced books
 *
 * The deletion deliberately reuses the firmware preflight, which already has every guard this
 * needs: the target must be a real pen, only the BOOK root, never recursive, case-insensitive
 * to match FAT, and each deletion recorded.
 */

/** The two files the pen keeps its book index in. */
export const BOOK_INDEX_FILES = ['1.BIN', 'BOOKFILE.BIN'] as const;

/** One record per book in BOOKFILE.BIN. Measured: 1,628 bytes for 37 books. */
export const BOOK_INDEX_RECORD_BYTES = 44;

/**
 * Extensions the firmware scans in `BOOK/`, read out of `app.bin` (`.axb .ax1 .smp .dic .bnf`,
 * upper and lower case). Anything we stage under a different extension is invisible to the pen,
 * which is what makes a staged write safe.
 */
export const PEN_SCANNED_BOOK_EXTENSIONS = ['.axb', '.ax1', '.smp', '.dic', '.bnf'] as const;

/**
 * ...but only `.axb` files get a record. Evidence: a real card holding 37 `.axb` **plus**
 * `english.dic` has exactly 37 records, and adding one `.axb` took it to 38. So `.dic` is read
 * for its own purpose and is not a book.
 */
export const INDEXED_BOOK_EXTENSION = '.axb';

export type IndexResetOutcome =
  | { ok: true; deleted: string[]; summary: string }
  | { ok: false; reason: 'not-a-pen' | 'book-dir-unreadable' | 'deletion-failed'; summary: string };

/**
 * Deletes the index so the pen rebuilds it on its next power-on.
 *
 * No backup is taken, deliberately: restoring the old index is precisely the thing that must not
 * happen — a rebuilt index is the goal, and the pen makes a fresh one for free. (This is the one
 * way it differs from the firmware preflight, where the pen stays on its old firmware if the
 * upgrade is abandoned and the old index is still the right one.)
 */
export function resetBookIndex(penRootPath: string): IndexResetOutcome {
  const result = runFirmwarePreflight(penRootPath, BOOK_INDEX_FILES);
  const summary = summarizePreflight(result.deletions);
  // The owner wanted to watch these two go without taking the card out. Internal build only —
  // in the Store build `technical` is an empty function and this line disappears.
  for (const deletion of result.deletions) {
    if (deletion.status === 'deleted') internal.technical('file-deleted', `BOOK/${deletion.matched ?? deletion.requested}`);
  }
  if (!result.ok) {
    internal.technical('index-reset-failed', result.reason);
    return { ok: false, reason: result.reason, summary: `${summary} — ${result.detail}` };
  }
  internal.technical('index-reset-done', summary);
  return { ok: true, deleted: result.deletions.filter((d) => d.status === 'deleted').map((d) => d.matched ?? d.requested), summary };
}

/** A name the pen will scan, i.e. one that must never appear until a write is complete. */
export function isPenScannedBookFileName(name: string): boolean {
  if (name.startsWith('._')) return false; // macOS sidecar, not content
  const lower = name.toLowerCase();
  return PEN_SCANNED_BOOK_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export interface BookIndexHealth {
  /** Records found in BOOKFILE.BIN, or null when there is no readable index. */
  recordCount: number | null;
  /** `.axb` files the pen would index. */
  bookCount: number;
  /** True when BOOKFILE.BIN's size is not a whole number of records — we cannot interpret it. */
  malformed: boolean;
  /** macOS sidecars sitting in BOOK/, which a customer's Finder copy leaves behind. */
  appleDoubleFiles: string[];
  /** `.DS_Store`, same reason. */
  hasDsStore: boolean;
  /**
   * What the UI should do. `ok` — nothing to say. `no-index` — the pen will rebuild by itself on
   * its next start, which is fine and not worth mentioning. `mismatch` — the index does not
   * describe what is on the pen, so books may play the wrong audio; offer the fix. `unreadable`
   * — the pen could not be inspected at all.
   */
  status: 'ok' | 'no-index' | 'mismatch' | 'unreadable';
}

/**
 * Compares the index against what is actually in `BOOK/`.
 *
 * This is how we catch the case we cannot otherwise see: a parent dragging a book in or out with
 * Explorer or Finder. Our own operations keep the index honest; theirs do not.
 */
export function checkBookIndexHealth(penRootPath: string): BookIndexHealth {
  const empty: BookIndexHealth = { recordCount: null, bookCount: 0, malformed: false, appleDoubleFiles: [], hasDsStore: false, status: 'unreadable' };

  const resolved = resolvePenRoot(penRootPath);
  if (resolved.status !== 'ok') return empty;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved.bookDirReal, { withFileTypes: true });
  } catch {
    return empty;
  }

  const files = entries.filter((e) => e.isFile() || e.isSymbolicLink());
  const bookCount = files.filter((e) => isEligibleAxbFileName(e.name)).length;
  const appleDoubleFiles = files.filter((e) => e.name.startsWith('._')).map((e) => e.name);
  const hasDsStore = files.some((e) => e.name === '.DS_Store');

  const indexEntry = files.find((e) => e.name.toLowerCase() === 'bookfile.bin');
  if (!indexEntry) {
    // Both gone (or never built): the pen rebuilds on its next power-on, which is the state we
    // deliberately leave it in after an add or remove. Not a problem to report.
    return { recordCount: null, bookCount, malformed: false, appleDoubleFiles, hasDsStore, status: 'no-index' };
  }

  let sizeBytes: number;
  try {
    sizeBytes = fs.statSync(path.join(resolved.bookDirReal, indexEntry.name)).size;
  } catch {
    return { ...empty, bookCount, appleDoubleFiles, hasDsStore };
  }

  const malformed = sizeBytes % BOOK_INDEX_RECORD_BYTES !== 0;
  const recordCount = Math.floor(sizeBytes / BOOK_INDEX_RECORD_BYTES);
  const status = malformed || recordCount !== bookCount ? 'mismatch' : 'ok';
  return { recordCount, bookCount, malformed, appleDoubleFiles, hasDsStore, status };
}

/**
 * Removes macOS droppings from `BOOK/` after one of our own operations.
 *
 * We copy with `fs.copyFile`, which does not carry extended attributes, so we do not create
 * AppleDouble files ourselves — but Finder does, the moment a customer opens the folder, and a
 * `._name.axb` sitting next to `name.axb` is a file the pen will try to read. `names` limits the
 * sweep to the files this operation actually wrote; anything else in there is the customer's.
 */
export function cleanMacSidecars(bookDirReal: string, names: readonly string[]): string[] {
  const removed: string[] = [];
  const targets = [...names.map((n) => `._${n}`), '.DS_Store'];
  for (const target of targets) {
    const full = path.join(bookDirReal, target);
    try {
      if (fs.existsSync(full)) {
        fs.unlinkSync(full);
        removed.push(target);
      }
    } catch {
      // Cosmetic cleanup — never fail an otherwise-successful book operation over it.
    }
  }
  return removed;
}
