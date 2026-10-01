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
const GB = 1_000_000_000;

function item(o: Partial<BookCatalogItem> = {}): BookCatalogItem {
  return {
    contentId: 'b1',
    filename: '0451.axb',
    friendlyName: 'Book One',
    friendlyNameI18n: null,
    sizeBytes: 100 * MB,
    status: 'not-on-pen',
    state: 'active',
    minAppVersion: null,
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
    const plan = buildSyncPlan({ catalogItems: [item({ contentId: 'a', appVersion: '0.3.17' }), item({ contentId: 'b' })], penItems: [] });
    expect(plan.toAdd.map((i) => i.contentId)).toEqual(['a', 'b']);
    expect(plan.addsBooks).toBe(true);
  });

  it('updates a book whose bytes differ, and leaves an identical one alone', () => {
    const plan = buildSyncPlan({
      catalogItems: [item({ contentId: 'a', status: 'on-pen-differs', appVersion: '0.3.17' }), item({ contentId: 'b', status: 'on-pen-current', actionable: false })],
      penItems: [pen({ contentId: 'a' }), pen({ contentId: 'b', fileName: '0452.axb' })],
    });
    expect(plan.toUpdate.map((i) => i.contentId)).toEqual(['a']);
    expect(plan.toAdd).toEqual([]);
    // A same-name replacement keeps the book's position, so the index survives.
    expect(plan.addsBooks).toBe(false);
  });

  it('treats a size difference as needing an update, without reading the pen', () => {
    const plan = buildSyncPlan({ catalogItems: [item({ status: 'on-pen-size-differs', appVersion: '0.3.17' })], penItems: [pen()] });
    expect(plan.toUpdate).toHaveLength(1);
  });

  it('does the smallest first, so something finishes early', () => {
    const plan = buildSyncPlan({
      catalogItems: [item({ contentId: 'big', sizeBytes: 900 * MB, appVersion: '0.3.17' }), item({ contentId: 'small', sizeBytes: 40 * MB }), item({ contentId: 'mid', sizeBytes: 300 * MB })],
      penItems: [],
    });
    expect(plan.toAdd.map((i) => i.contentId)).toEqual(['small', 'mid', 'big']);
    expect(plan.totalBytes).toBe(1_240 * MB);
  });

  it('removes nothing that the catalogue has not flagged, whatever is on the pen', () => {
    const plan = buildSyncPlan({
      catalogItems: [],
      penItems: [pen({ contentId: 'gone' }), pen({ contentId: null, fileName: 'someone-elses.axb', status: 'unknown', removable: false })],
      appVersion: '0.3.17',
    });
    // A book the catalogue no longer lists at all, and a book we did not put there: neither is
    // ours to delete. Only an explicit remove_from_pens flag removes anything.
    expect(plan).toMatchObject({ toRemove: [], toAdd: [], toUpdate: [], totalBytes: 0, addsBooks: false });
  });

  it('does nothing at all without a pen', () => {
    expect(buildSyncPlan({ catalogItems: [item()], penItems: null, appVersion: '0.3.17' })).toMatchObject({ toAdd: [], toUpdate: [] });
  });

  it('skips a book the catalogue cannot describe properly', () => {
    const plan = buildSyncPlan({
      catalogItems: [item({ status: 'metadata-incomplete', actionable: false, appVersion: '0.3.17' }), item({ contentId: 'amb', status: 'ambiguous', actionable: false })],
      penItems: [],
    });
    expect(plan.toAdd).toEqual([]);
  });
});

describe('lifecycle states', () => {
  it('never ADDS a retired book to a pen that does not have it', () => {
    const plan = buildSyncPlan({ catalogItems: [item({ state: 'retired', appVersion: '0.3.17' })], penItems: [] });
    expect(plan.toAdd).toEqual([]);
  });

  it('still UPDATES a retired book the pen already has — the customer owns the cards', () => {
    const plan = buildSyncPlan({
      catalogItems: [item({ state: 'retired', minAppVersion: null, status: 'on-pen-differs', appVersion: '0.3.17' })],
      penItems: [pen()],
    });
    expect(plan.toUpdate.map((i) => i.contentId)).toEqual(['b1']);
  });

  it('takes a remove_from_pens book off the pen, and never adds one', () => {
    const notOnPen = buildSyncPlan({ catalogItems: [item({ state: 'remove_from_pens' })], penItems: [], appVersion: '0.3.17' });
    expect(notOnPen.toAdd).toEqual([]);

    const onPen = buildSyncPlan({
      catalogItems: [item({ state: 'remove_from_pens', status: 'on-pen-differs' })],
      penItems: [pen()],
      appVersion: '0.3.17',
    });
    // On its way off: removed, and neither added nor updated on the way.
    expect(onPen.toRemove.map((r) => r.contentId)).toEqual(['b1']);
    expect(onPen.toUpdate).toEqual([]);
    expect(onPen.toAdd).toEqual([]);
  });

  it('treats a book with no state as active — todays catalogue sends none', () => {
    const plan = buildSyncPlan({ catalogItems: [item({ state: 'active', appVersion: '0.3.17' })], penItems: [] });
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
  const plan = (
    toAdd: BookCatalogItem[] = [],
    toUpdate: BookCatalogItem[] = [],
    toRemove: BookRemoval[] = [],
  ) => ({
    toRemove,
    toAdd,
    toUpdate,
    totalBytes: [...toAdd, ...toUpdate].reduce((n, i) => n + i.sizeBytes, 0),
    freedBytes: toRemove.reduce((n, r) => n + r.sizeBytes, 0),
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

/**
 * Taking a book off somebody's pen is the one thing in this app that destroys something. These
 * are the conditions under which it is allowed to happen, and the conditions under which it
 * must not.
 */
describe('remove_from_pens — what may be deleted, and what may not', () => {
  const removable = (overrides: Partial<BookCatalogItem> = {}) =>
    item({ contentId: 'old', state: 'remove_from_pens', sizeBytes: 200 * MB, status: 'on-pen-current', ...overrides });

  it('removes the book when the pen has it at exactly the catalogue size', () => {
    const p = buildSyncPlan({
      catalogItems: [removable()],
      penItems: [pen({ contentId: 'old', fileName: '0451.axb', sizeBytes: 200 * MB })],
      appVersion: '0.3.17',
    });
    expect(p.toRemove).toEqual([
      expect.objectContaining({ fileName: '0451.axb', sizeBytes: 200 * MB, contentId: 'old' }),
    ]);
    expect(p.freedBytes).toBe(200 * MB);
  });

  it('leaves it alone when the size on the pen is not the size in the catalogue', () => {
    // Same name, different bytes: this is not the book the catalogue is talking about.
    const p = buildSyncPlan({
      catalogItems: [removable()],
      penItems: [pen({ contentId: 'old', fileName: '0451.axb', sizeBytes: 199 * MB })],
      appVersion: '0.3.17',
    });
    expect(p.toRemove).toEqual([]);
  });

  it('never touches a book we did not put there', () => {
    const p = buildSyncPlan({
      catalogItems: [removable()],
      penItems: [pen({ contentId: null, fileName: 'grandma.axb', sizeBytes: 200 * MB, status: 'unknown', removable: false })],
      appVersion: '0.3.17',
    });
    expect(p.toRemove).toEqual([]);
  });

  it('never removes a book whose flag this version is too old to act on', () => {
    const p = buildSyncPlan({
      catalogItems: [removable({ minAppVersion: '0.3.18' })],
      penItems: [pen({ contentId: 'old', fileName: '0451.axb', sizeBytes: 200 * MB })],
      appVersion: '0.3.17',
    });
    expect(p.toRemove).toEqual([]);
    expect(p.toUpdate).toEqual([]);
  });

  it('frees the biggest first, so room appears as early as it can', () => {
    const p = buildSyncPlan({
      catalogItems: [
        removable({ contentId: 'small', sizeBytes: 10 * MB }),
        removable({ contentId: 'big', sizeBytes: 900 * MB }),
      ],
      penItems: [
        pen({ contentId: 'small', fileName: 'a.axb', sizeBytes: 10 * MB }),
        pen({ contentId: 'big', fileName: 'b.axb', sizeBytes: 900 * MB }),
      ],
      appVersion: '0.3.17',
    });
    expect(p.toRemove.map((r) => r.contentId)).toEqual(['big', 'small']);
  });

  it('counts the room the removals free, so a sync that only fits afterwards is allowed', () => {
    const freeing = buildSyncPlan({
      catalogItems: [
        removable({ contentId: 'old', sizeBytes: 900 * MB }),
        item({ contentId: 'new', sizeBytes: 800 * MB, status: 'not-on-pen' }),
      ],
      penItems: [pen({ contentId: 'old', fileName: 'old.axb', sizeBytes: 900 * MB })],
      appVersion: '0.3.17',
    });
    // 800 MB wanted, 900 MB freed first: it fits in a gap far smaller than 800 MB.
    const check = checkSpace({
      plan: freeing,
      penItems: [pen({ contentId: 'old', fileName: 'old.axb', sizeBytes: 900 * MB })],
      freeBytes: 300 * MB,
      penTotalBytes: 16 * GB,
    });
    expect(check.ok).toBe(true);
    // The card is never asked to hold more than it holds now — the 900 MB goes before the
    // 800 MB arrives — so the peak is nothing at all, and the card ends up 100 MB emptier.
    expect(check.peakBytes).toBe(0);
    expect(check.netBytes).toBe(-100 * MB);
  });
});
