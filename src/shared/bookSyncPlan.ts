import { meetsMinimumVersion } from './contentContract';
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
 * Four rules, and the last two are the ones that need stating:
 *
 * 1. **Add** every catalogue book the pen does not have.
 * 2. **Update** every book whose bytes differ — but a `retired` book is **never added**, while a
 *    retired book already on the pen **is still updated**. A customer owns the physical cards; a
 *    book leaving the catalogue must not stop working on the pen they already own.
 * 3. **Remove** a book the catalogue marks `remove_from_pens`, and only when the pen's copy is
 *    demonstrably that book: the **filename matches and the size matches the catalogue's**. A
 *    file that merely shares a name is left alone. Nothing else is ever removed — not a book
 *    without the flag, not a book we did not put there, and nothing outside BOOK at all.
 * 4. **Removals run first.** They free room the adds may need, and the space check counts them
 *    that way rather than assuming the worst.
 *
 * Adds and updates are smallest first, so something finishes early rather than a parent watching
 * one 19-minute bar.
 */

export interface BookRemoval {
  /** The file on the pen, by name. */
  fileName: string;
  /** What it is called to a parent. */
  friendlyName: string;
  friendlyNameI18n: Record<string, string> | null;
  /** What removing it frees. */
  sizeBytes: number;
  contentId: string;
}

export interface BookSyncPlan {
  /** Books to take off the pen, because the catalogue says they should come off. */
  toRemove: BookRemoval[];
  /** Books to add, smallest first. */
  toAdd: BookCatalogItem[];
  /** Books to replace in place, smallest first. Same filename, so no index reset. */
  toUpdate: BookCatalogItem[];
  /** Total bytes that will be written to the pen. */
  totalBytes: number;
  /** Total bytes the removals free. */
  freedBytes: number;
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
  /** This build's version, for the per-item minimum check. */
  appVersion: string;
}): BookSyncPlan {
  const { catalogItems, penItems, appVersion } = params;
  const empty: BookSyncPlan = { toRemove: [], toAdd: [], toUpdate: [], totalBytes: 0, freedBytes: 0, addsBooks: false };
  if (penItems === null) return empty;

  const onPen = new Set(penItems.map((p) => p.contentId).filter((id): id is string => id !== null));
  const penByContentId = new Map(penItems.filter((p) => p.contentId).map((p) => [p.contentId as string, p]));

  const toRemove: BookRemoval[] = [];
  const toAdd: BookCatalogItem[] = [];
  const toUpdate: BookCatalogItem[] = [];

  for (const item of catalogItems) {
    // The server already filters by the version we send. This is the second guard: an item that
    // asks for a newer app than this one is skipped entirely — not added, not updated, and
    // above all not removed on the strength of a flag we may not understand.
    if (!meetsMinimumVersion(item.minAppVersion, appVersion)) continue;
    // Never act on a book the catalogue cannot describe properly, or one whose filename two
    // entries claim — `actionable` already encodes both, and it is enforced again in the
    // install path rather than trusted from here.
    if (!item.actionable) continue;

    const alreadyThere = onPen.has(item.contentId);

    if (item.state === 'remove_from_pens') {
      const pen = penByContentId.get(item.contentId);
      // Both must agree before anything is deleted: the pen has a file we recognise as this
      // book, and it is the size the catalogue says that book is. A file that merely shares a
      // name is somebody else's, and stays.
      if (pen && pen.sizeBytes === item.sizeBytes) {
        toRemove.push({
          fileName: pen.fileName,
          friendlyName: item.friendlyName,
          friendlyNameI18n: item.friendlyNameI18n,
          sizeBytes: pen.sizeBytes,
          contentId: item.contentId,
        });
      }
      // Never added, never updated — it is on its way off.
      continue;
    }

    if (!alreadyThere) {
      // Retired means "no longer sold", not "take it away" — so it is never put on a pen that
      // does not already have it.
      if (item.state === 'retired') continue;
      if (item.status === 'not-on-pen') toAdd.push(item);
      continue;
    }

    // Already on the pen: update it if the bytes differ, whatever its state. A retired book a
    // customer owns the cards for still deserves to be correct.
    if (item.status === 'on-pen-differs' || item.status === 'on-pen-size-differs') toUpdate.push(item);
  }

  const bySize = (a: BookCatalogItem, b: BookCatalogItem) => a.sizeBytes - b.sizeBytes;
  toAdd.sort(bySize);
  toUpdate.sort(bySize);

  // Biggest first: the one that frees the most room does so soonest.
  toRemove.sort((a, b) => b.sizeBytes - a.sizeBytes);

  const totalBytes = [...toAdd, ...toUpdate].reduce((sum, i) => sum + i.sizeBytes, 0);
  const freedBytes = toRemove.reduce((sum, r) => sum + r.sizeBytes, 0);
  return { toRemove, toAdd, toUpdate, totalBytes, freedBytes, addsBooks: toAdd.length > 0 };
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
  /** Set when the check could not be made at all, rather than made and failed. */
  reason?: 'not-enough-space' | 'unreadable';
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

  // Removals run first, so the room they free is room the adds may use. Counted as it really
  // happens — not assumed, and not ignored.
  for (const removal of plan.toRemove) {
    held -= onDiskBytes(removal.sizeBytes, clusterBytes);
  }

  // Then adds, then updates — the same order runSync uses, and each list is smallest first.
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
    // We cannot tell whether it fits, so we do not start. The requirement is that a parent
    // knows BEFORE anything is written — and "we could not check" is an answer they can act on,
    // whereas discovering it half-way through a twenty-minute copy is not.
    return { ok: false, reason: 'unreadable', shortfallBytes: 0, peakBytes: peak, netBytes: held, marginBytes: margin };
  }
  const fits = needed <= freeBytes;
  return {
    ok: fits,
    ...(fits ? {} : { reason: 'not-enough-space' as const }),
    shortfallBytes: Math.max(needed - freeBytes, 0),
    peakBytes: peak,
    netBytes: held,
    marginBytes: margin,
  };
}
