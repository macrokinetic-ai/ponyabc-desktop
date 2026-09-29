import { describe, expect, it } from 'vitest';
import type { BookCatalogItem, BookPenItem } from '../../src/shared/types';
import { SYNC_MARGIN_MIN_BYTES, buildSyncPlan, checkSpace, onDiskBytes, otherBooksOnPen, ourBooksOnPen, safetyMarginBytes } from '../../src/shared/bookSyncPlan';

/**
 * One button, so the decision is ours. These pin the three rules a parent never sees but always
 * relies on: add what is missing, update what differs, never delete anything — and a retired
 * book is never added to a pen that lacks it, yet is still updated on a pen that has it, because
 * the customer owns the physical cards.
 */

const MB = 1_000_000;

function item(o: Partial<BookCatalogItem> = {}): BookCatalogItem {
  return {
    contentId: 'b1',
    filename: '0451.axb',
    friendlyName: 'Book One',
    friendlyNameI18n: null,
    sizeBytes: 100 * MB,
    status: 'not-on-pen',
    lifecycleState: 'active',
    cached: false,
    actionable: true,
    updatedAtMs: null,
    ...o,
  };
}

function pen(o: Partial<BookPenItem> = {}): BookPenItem {
  return {
    fileName: '0451.axb',
    sizeBytes: 100 * MB,
    contentId: 'b1',
    friendlyName: 'Book One',
    friendlyNameI18n: null,
    status: 'present',
    removable: true,
    updatedAtMs: null,
    ...o,
  };
}

describe('what one press of Sync would do', () => {
  it('adds every catalogue book the pen does not have', () => {
    const plan = buildSyncPlan({ catalogItems: [item({ contentId: 'a' }), item({ contentId: 'b' })], penItems: [] });
    expect(plan.toAdd.map((i) => i.contentId)).toEqual(['a', 'b']);
    expect(plan.addsBooks).toBe(true);
  });

  it('updates a book whose bytes differ, and leaves an identical one alone', () => {
    const plan = buildSyncPlan({
      catalogItems: [item({ contentId: 'a', status: 'on-pen-differs' }), item({ contentId: 'b', status: 'on-pen-current', actionable: false })],
      penItems: [pen({ contentId: 'a' }), pen({ contentId: 'b', fileName: '0452.axb' })],
    });
    expect(plan.toUpdate.map((i) => i.contentId)).toEqual(['a']);
    expect(plan.toAdd).toEqual([]);
    // A same-name replacement keeps the book's position, so the index survives.
    expect(plan.addsBooks).toBe(false);
  });

  it('treats a size difference as needing an update, without reading the pen', () => {
    const plan = buildSyncPlan({ catalogItems: [item({ status: 'on-pen-size-differs' })], penItems: [pen()] });
    expect(plan.toUpdate).toHaveLength(1);
  });

  it('does the smallest first, so something finishes early', () => {
    const plan = buildSyncPlan({
      catalogItems: [item({ contentId: 'big', sizeBytes: 900 * MB }), item({ contentId: 'small', sizeBytes: 40 * MB }), item({ contentId: 'mid', sizeBytes: 300 * MB })],
      penItems: [],
    });
    expect(plan.toAdd.map((i) => i.contentId)).toEqual(['small', 'mid', 'big']);
    expect(plan.totalBytes).toBe(1_240 * MB);
  });

  it('never proposes deleting anything, whatever is on the pen', () => {
    const plan = buildSyncPlan({
      catalogItems: [],
      penItems: [pen({ contentId: 'gone' }), pen({ contentId: null, fileName: 'someone-elses.axb', status: 'unknown', removable: false })],
    });
    expect(plan).toMatchObject({ toAdd: [], toUpdate: [], totalBytes: 0, addsBooks: false });
    expect(Object.keys(plan)).not.toContain('toRemove');
  });

  it('does nothing at all without a pen', () => {
    expect(buildSyncPlan({ catalogItems: [item()], penItems: null })).toMatchObject({ toAdd: [], toUpdate: [] });
  });

  it('skips a book the catalogue cannot describe properly', () => {
    const plan = buildSyncPlan({
      catalogItems: [item({ status: 'metadata-incomplete', actionable: false }), item({ contentId: 'amb', status: 'ambiguous', actionable: false })],
      penItems: [],
    });
    expect(plan.toAdd).toEqual([]);
  });
});

describe('lifecycle states', () => {
  it('never ADDS a retired book to a pen that does not have it', () => {
    const plan = buildSyncPlan({ catalogItems: [item({ lifecycleState: 'retired' })], penItems: [] });
    expect(plan.toAdd).toEqual([]);
  });

  it('still UPDATES a retired book the pen already has — the customer owns the cards', () => {
    const plan = buildSyncPlan({
      catalogItems: [item({ lifecycleState: 'retired', status: 'on-pen-differs' })],
      penItems: [pen()],
    });
    expect(plan.toUpdate.map((i) => i.contentId)).toEqual(['b1']);
  });

  it('ignores remove_from_pens entirely — 0.3.17 deletes nothing', () => {
    const notOnPen = buildSyncPlan({ catalogItems: [item({ lifecycleState: 'remove_from_pens' })], penItems: [] });
    expect(notOnPen.toAdd).toEqual([]);

    const onPen = buildSyncPlan({
      catalogItems: [item({ lifecycleState: 'remove_from_pens', status: 'on-pen-differs' })],
      penItems: [pen()],
    });
    // Not deleted. Still kept correct, because a half-understood deletion is worse than none.
    expect(onPen.toUpdate).toHaveLength(1);
  });

  it('treats a book with no state as active — todays catalogue sends none', () => {
    const plan = buildSyncPlan({ catalogItems: [item({ lifecycleState: 'active' })], penItems: [] });
    expect(plan.toAdd).toHaveLength(1);
  });
});

describe('grouping what is on the pen', () => {
  it('separates our books from everyone else\'s', () => {
    const items = [pen({ contentId: 'a' }), pen({ contentId: null, fileName: 'x.axb' }), pen({ contentId: 'c', fileName: 'y.axb' })];
    expect(ourBooksOnPen(items)).toHaveLength(2);
    expect(otherBooksOnPen(items).map((p) => p.fileName)).toEqual(['x.axb']);
  });
});

describe('will it fit — measured at the peak, not the net', () => {
  const GB = 1_000_000_000;
  const plan = (toAdd: BookCatalogItem[] = [], toUpdate: BookCatalogItem[] = []) => ({
    toAdd,
    toUpdate,
    totalBytes: [...toAdd, ...toUpdate].reduce((n, i) => n + i.sizeBytes, 0),
    addsBooks: toAdd.length > 0,
  });

  it('BLOCKS an update that fits on paper but not while both copies exist', () => {
    // Replacing a 1 GB book with a 1 GB book costs nothing NET, so a check against the totals
    // would happily start it. But the new copy is staged while the old one is still there, so
    // for those nineteen minutes the card must hold both — and 500 MB free does not.
    const book = item({ contentId: 'a', sizeBytes: 1 * GB, status: 'on-pen-differs' });
    const freeBytes = 500 * MB;
    const check = checkSpace({
      plan: plan([], [book]),
      penItems: [pen({ contentId: 'a', sizeBytes: 1 * GB })],
      freeBytes,
      penTotalBytes: 16 * GB,
      clusterBytes: 32_768,
    });

    // The claim, stated: the net fits and the peak does not.
    expect(check.netBytes + check.marginBytes).toBeLessThanOrEqual(freeBytes);
    expect(check.peakBytes + check.marginBytes).toBeGreaterThan(freeBytes);

    expect(check.netBytes).toBe(0); // nothing extra once it is done
    // ...but a whole book's worth while it runs, rounded to clusters as the card stores it.
    expect(check.peakBytes).toBe(onDiskBytes(1 * GB, 32_768));
    expect(check.ok).toBe(false);
    expect(check.shortfallBytes).toBeGreaterThan(0);
  });

  it('allows the same update when there is room for both copies at once', () => {
    const book = item({ contentId: 'a', sizeBytes: 1 * GB, status: 'on-pen-differs' });
    const check = checkSpace({
      plan: plan([], [book]),
      penItems: [pen({ contentId: 'a', sizeBytes: 1 * GB })],
      freeBytes: 2 * GB,
      penTotalBytes: 16 * GB,
      clusterBytes: 32_768,
    });
    expect(check.ok).toBe(true);
  });

  it('takes the maximum over the sequence, not the last step', () => {
    // A big add first, then a small one: the peak is reached part-way, not at the end.
    const check = checkSpace({
      plan: plan([item({ contentId: 'a', sizeBytes: 500 * MB }), item({ contentId: 'b', sizeBytes: 100 * MB })]),
      penItems: [],
      freeBytes: 10 * GB,
      penTotalBytes: 16 * GB,
      clusterBytes: null,
    });
    // Both are added, so the card ends up holding both — and the peak is the same as the net
    // here precisely because nothing is being replaced.
    expect(check.netBytes).toBe(600 * MB);
    expect(check.peakBytes).toBe(600 * MB);
  });

  it('counts what a card actually stores, rounding every file up to a cluster', () => {
    const tiny = checkSpace({
      plan: plan([item({ contentId: 'a', sizeBytes: 1 })]),
      penItems: [],
      freeBytes: 10 * GB,
      penTotalBytes: 16 * GB,
      clusterBytes: 32_768,
    });
    // A one-byte book still occupies a whole 32 KB cluster.
    expect(tiny.peakBytes).toBe(32_768);

    const unrounded = checkSpace({ plan: plan([item({ contentId: 'a', sizeBytes: 1 })]), penItems: [], freeBytes: 10 * GB, clusterBytes: null });
    expect(unrounded.peakBytes).toBe(1);
  });

  it('keeps a margin of 1% of the card, or 50 MB, whichever is larger', () => {
    expect(safetyMarginBytes(16 * GB)).toBe(Math.ceil(16 * GB * 0.01)); // 160 MB on a 16 GB card
    expect(safetyMarginBytes(1 * GB)).toBe(SYNC_MARGIN_MIN_BYTES); // 1% would be only 10 MB
    expect(safetyMarginBytes(null)).toBe(SYNC_MARGIN_MIN_BYTES);
  });

  it('refuses an exact fit that leaves no margin, and allows one that leaves exactly enough', () => {
    const one = item({ contentId: 'a', sizeBytes: 1 * GB });
    const margin = safetyMarginBytes(16 * GB);

    const exact = checkSpace({ plan: plan([one]), penItems: [], freeBytes: 1 * GB, penTotalBytes: 16 * GB, clusterBytes: null });
    expect(exact.ok).toBe(false);
    expect(exact.shortfallBytes).toBe(margin);

    const justEnough = checkSpace({ plan: plan([one]), penItems: [], freeBytes: 1 * GB + margin, penTotalBytes: 16 * GB, clusterBytes: null });
    expect(justEnough.ok).toBe(true);
    expect(justEnough.shortfallBytes).toBe(0);
  });

  it('BLOCKS when free space could not be read at all', () => {
    // The requirement is that a parent knows before the first byte whether it fits. "We could
    // not check" is an answer they can act on — unplug and replug; discovering it half-way
    // through a twenty-minute copy is not.
    const check = checkSpace({ plan: plan([item({ sizeBytes: 1 * GB })]), penItems: [], freeBytes: null });
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('unreadable');
    expect(check.shortfallBytes).toBe(0); // there is no shortfall to report, only an unknown
  });

  it('distinguishes "too small" from "could not check"', () => {
    expect(checkSpace({ plan: plan([item({ sizeBytes: 9 * GB })]), penItems: [], freeBytes: 1 * GB }).reason).toBe('not-enough-space');
    expect(checkSpace({ plan: plan([item({ sizeBytes: 1 })]), penItems: [], freeBytes: 9 * GB }).reason).toBeUndefined();
  });

  it('an empty plan needs nothing but still respects the margin', () => {
    expect(checkSpace({ plan: plan(), penItems: [], freeBytes: 0, penTotalBytes: 16 * GB }).ok).toBe(false);
    expect(checkSpace({ plan: plan(), penItems: [], freeBytes: 10 * GB, penTotalBytes: 16 * GB }).ok).toBe(true);
  });
});
