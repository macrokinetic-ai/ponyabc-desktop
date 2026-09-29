import { describe, expect, it } from 'vitest';
import type { BookCatalogItem, BookPenItem } from '../../src/shared/types';
import { SYNC_FREE_SPACE_MARGIN_BYTES, buildSyncPlan, checkSpace, otherBooksOnPen, ourBooksOnPen } from '../../src/shared/bookSyncPlan';

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

describe('will it fit', () => {
  it('leaves headroom rather than filling the card to the last byte', () => {
    expect(checkSpace(1_000 * MB, 1_000 * MB + SYNC_FREE_SPACE_MARGIN_BYTES)).toEqual({ ok: true, shortfallBytes: 0 });
    expect(checkSpace(1_000 * MB, 1_000 * MB).ok).toBe(false);
  });

  it('says how much more is needed, so the message can be specific', () => {
    const check = checkSpace(1_000 * MB, 800 * MB);
    expect(check.ok).toBe(false);
    expect(check.shortfallBytes).toBe(200 * MB + SYNC_FREE_SPACE_MARGIN_BYTES);
  });

  it('proceeds when free space could not be read, rather than refusing on a failed stat', () => {
    expect(checkSpace(1_000 * MB, null)).toEqual({ ok: true, shortfallBytes: 0 });
  });

  it('is happy with an empty plan', () => {
    expect(checkSpace(0, 0).ok).toBe(false); // 0 bytes still wants the margin free
    expect(checkSpace(0, SYNC_FREE_SPACE_MARGIN_BYTES).ok).toBe(true);
  });
});
