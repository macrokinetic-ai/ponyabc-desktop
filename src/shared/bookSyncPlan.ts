import type { BookCatalogItem, BookPenItem } from './types';

/**
 * What one press of **Sync books** would do.
 *
 * A parent does not choose books; they press one button and the pen ends up matching the
 * library. So the decision is ours, and it has to be made from cheap facts only: the pen's
 * directory listing (filenames and sizes — a `stat`, never a read) and the catalogue. Reading a
 * book back off the pen to be sure costs ~19 minutes each at the pen's ~1 MB/s, which is not a
 * price a sync may pay.
 *
 * Three rules, and the second is the one that needs stating:
 *
 * 1. **Add** every catalogue book the pen does not have.
 * 2. **Update** every book whose bytes differ — but a `retired` book is **never added**, while a
 *    retired book already on the pen **is still updated**. A customer owns the physical cards; a
 *    book leaving the catalogue must not stop working on the pen they already own.
 * 3. **Never delete.** Nothing in 0.3.17 removes a book, including `remove_from_pens`, which is
 *    deliberately ignored: shipping a half-understood deletion is worse than shipping none.
 *
 * Smallest first, so something finishes early rather than a parent watching one 19-minute bar.
 */

export interface BookSyncPlan {
  /** Books to add, smallest first. */
  toAdd: BookCatalogItem[];
  /** Books to replace in place, smallest first. Same filename, so no index reset. */
  toUpdate: BookCatalogItem[];
  /** Total bytes that will be written to the pen. */
  totalBytes: number;
  /** True when adding anything — the pen's book index is positional, so only an addition
   *  invalidates it. See bookIndexReset.ts. */
  addsBooks: boolean;
}

/** A book on the pen that we did not put there. Never touched, only counted. */
export function otherBooksOnPen(penItems: readonly BookPenItem[]): BookPenItem[] {
  return penItems.filter((p) => p.contentId === null);
}

/** PonyABC books currently on the pen. */
export function ourBooksOnPen(penItems: readonly BookPenItem[]): BookPenItem[] {
  return penItems.filter((p) => p.contentId !== null);
}

export function buildSyncPlan(params: {
  catalogItems: readonly BookCatalogItem[];
  penItems: readonly BookPenItem[] | null;
}): BookSyncPlan {
  const { catalogItems, penItems } = params;
  const empty: BookSyncPlan = { toAdd: [], toUpdate: [], totalBytes: 0, addsBooks: false };
  if (penItems === null) return empty;

  const onPen = new Set(penItems.map((p) => p.contentId).filter((id): id is string => id !== null));

  const toAdd: BookCatalogItem[] = [];
  const toUpdate: BookCatalogItem[] = [];

  for (const item of catalogItems) {
    // Never act on a book the catalogue cannot describe properly, or one whose filename two
    // entries claim — `actionable` already encodes both, and it is enforced again in the
    // install path rather than trusted from here.
    if (!item.actionable) continue;

    const alreadyThere = onPen.has(item.contentId);

    if (!alreadyThere) {
      // Retired means "no longer sold", not "take it away" — so it is never put on a pen that
      // does not already have it.
      if (item.lifecycleState === 'retired') continue;
      // Reserved, and ignored on purpose in 0.3.17.
      if (item.lifecycleState === 'remove_from_pens') continue;
      if (item.status === 'not-on-pen') toAdd.push(item);
      continue;
    }

    // Already on the pen: update it if the bytes differ, whatever its lifecycle state. A
    // retired book a customer owns the cards for still deserves to be correct.
    if (item.status === 'on-pen-differs' || item.status === 'on-pen-size-differs') toUpdate.push(item);
  }

  const bySize = (a: BookCatalogItem, b: BookCatalogItem) => a.sizeBytes - b.sizeBytes;
  toAdd.sort(bySize);
  toUpdate.sort(bySize);

  const totalBytes = [...toAdd, ...toUpdate].reduce((sum, i) => sum + i.sizeBytes, 0);
  return { toAdd, toUpdate, totalBytes, addsBooks: toAdd.length > 0 };
}

/**
 * Headroom kept free on the pen, on top of what the sync writes.
 *
 * FAT needs somewhere to put directory entries and its own bookkeeping, a staged write briefly
 * holds a second copy of the file being written, and a pen with literally zero bytes free is a
 * pen a parent cannot record on. 200 MB is comfortably more than a staged write of the largest
 * book we ship needs beyond the book itself.
 */
export const SYNC_FREE_SPACE_MARGIN_BYTES = 200 * 1024 * 1024;

export interface SpaceCheck {
  ok: boolean;
  /** How much more is needed, in bytes. 0 when it fits. */
  shortfallBytes: number;
}

/**
 * Whether the plan fits. Unknown free space is treated as **fits** rather than blocking a sync
 * on a number we could not read — the write itself still fails safely if it does not, and
 * refusing to sync because of a failed `statfs` would be worse than trying.
 */
export function checkSpace(totalBytes: number, freeBytes: number | null): SpaceCheck {
  if (freeBytes === null) return { ok: true, shortfallBytes: 0 };
  const needed = totalBytes + SYNC_FREE_SPACE_MARGIN_BYTES;
  return needed <= freeBytes ? { ok: true, shortfallBytes: 0 } : { ok: false, shortfallBytes: needed - freeBytes };
}
