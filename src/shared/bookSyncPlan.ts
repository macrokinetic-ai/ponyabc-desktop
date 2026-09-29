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
 * Headroom left free on the pen, on top of everything the sync needs.
 *
 * FAT needs somewhere for its own bookkeeping, and a pen with literally zero bytes free is a pen
 * a parent cannot record on. 1% of the card, or 50 MB, whichever is larger — on a 16 GB card
 * that is about 160 MB.
 */
export const SYNC_MARGIN_MIN_BYTES = 50 * 1024 * 1024;
export const SYNC_MARGIN_FRACTION = 0.01;

export function safetyMarginBytes(penTotalBytes: number | null): number {
  if (penTotalBytes === null) return SYNC_MARGIN_MIN_BYTES;
  return Math.max(SYNC_MARGIN_MIN_BYTES, Math.ceil(penTotalBytes * SYNC_MARGIN_FRACTION));
}

/** What a file of `bytes` actually occupies on a card with `clusterBytes` allocation units. */
export function onDiskBytes(bytes: number, clusterBytes: number | null): number {
  if (clusterBytes === null || clusterBytes <= 0) return bytes;
  return Math.ceil(bytes / clusterBytes) * clusterBytes;
}

export interface SpaceCheck {
  ok: boolean;
  /** How much more room is needed. 0 when it fits. */
  shortfallBytes: number;
  /** The most the card is ever asked to hold during the sync, over what is on it now. */
  peakBytes: number;
  /** What the card holds extra once the sync has finished. Always ≤ peak. */
  netBytes: number;
  marginBytes: number;
}

/**
 * Whether the whole sync fits — measured at its **peak**, not at its net result.
 *
 * This is the distinction that matters, and it is invisible from the totals. Updating a book
 * writes the new copy to a temporary name **while the old copy is still there**, so for the
 * duration of that one file the card holds both. A 1 GB book replacing a 1 GB book has a net
 * cost of zero and a peak cost of 1 GB. Checking the net would let a sync start and then fail
 * twenty minutes in, which is exactly the experience this exists to prevent.
 *
 * So: walk the sequence in the order it will actually run, track what is held at each step, and
 * take the maximum.
 */
export function checkSpace(params: {
  plan: BookSyncPlan;
  penItems: readonly BookPenItem[] | null;
  freeBytes: number | null;
  penTotalBytes?: number | null;
  clusterBytes?: number | null;
}): SpaceCheck {
  const { plan, penItems, freeBytes, penTotalBytes = null, clusterBytes = null } = params;
  const margin = safetyMarginBytes(penTotalBytes);

  const existingByContentId = new Map((penItems ?? []).filter((p) => p.contentId).map((p) => [p.contentId as string, p.sizeBytes]));

  let held = 0; // extra bytes on the card, relative to now, after each completed step
  let peak = 0; // the worst moment across the whole sequence

  // Adds first, then updates — the same order runSync uses, and each list is smallest first.
  for (const item of [...plan.toAdd, ...plan.toUpdate]) {
    const incoming = onDiskBytes(item.sizeBytes, clusterBytes);
    const outgoing = onDiskBytes(existingByContentId.get(item.contentId) ?? 0, clusterBytes);

    // During the write the staged copy and the old file coexist.
    peak = Math.max(peak, held + incoming);
    // After the rename the old one is gone.
    held += incoming - outgoing;
  }

  const needed = peak + margin;
  if (freeBytes === null) {
    // Nothing to compare against. Proceed rather than refuse on a number we could not read —
    // the write itself still fails safely, and the mid-sync handling catches it.
    return { ok: true, shortfallBytes: 0, peakBytes: peak, netBytes: held, marginBytes: margin };
  }
  return {
    ok: needed <= freeBytes,
    shortfallBytes: Math.max(needed - freeBytes, 0),
    peakBytes: peak,
    netBytes: held,
    marginBytes: margin,
  };
}
