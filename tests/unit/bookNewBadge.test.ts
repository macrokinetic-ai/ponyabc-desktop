import { describe, expect, it } from 'vitest';
import { isRecentlyUpdated } from '../../src/shared/bookNewBadge';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('isRecentlyUpdated', () => {
  const now = Date.parse('2026-09-15T12:00:00.000Z');

  it('true for something updated a moment ago', () => {
    expect(isRecentlyUpdated(now - 1000, now)).toBe(true);
  });

  it('true exactly at the 14-day boundary', () => {
    expect(isRecentlyUpdated(now - 14 * DAY_MS, now)).toBe(true);
  });

  it('false just past the 14-day boundary', () => {
    expect(isRecentlyUpdated(now - 14 * DAY_MS - 1, now)).toBe(false);
  });

  it('false for something updated long ago', () => {
    expect(isRecentlyUpdated(now - 30 * DAY_MS, now)).toBe(false);
  });

  it('never guesses on a missing timestamp', () => {
    expect(isRecentlyUpdated(null, now)).toBe(false);
  });

  it('tolerates small clock skew (a few minutes in the future)', () => {
    expect(isRecentlyUpdated(now + 60 * 1000, now)).toBe(true);
  });

  it('rejects a bogus far-future timestamp rather than treating it as new', () => {
    expect(isRecentlyUpdated(now + 30 * DAY_MS, now)).toBe(false);
  });
});
