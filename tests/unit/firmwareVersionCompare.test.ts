import { describe, expect, it } from 'vitest';
import { compareOfficialToOnPen } from '../../src/renderer/screens/firmwareVersionCompare';

describe('compareOfficialToOnPen', () => {
  it("'unknown' whenever onPenVersion is null — the only branch reachable via the shipped UI today", () => {
    expect(compareOfficialToOnPen(null, { version: '1.2.3' })).toBe('unknown');
  });

  it("'up-to-date' when versions match", () => {
    expect(compareOfficialToOnPen('1.2.3', { version: '1.2.3' })).toBe('up-to-date');
  });

  it("'update-available' when the official version is newer", () => {
    expect(compareOfficialToOnPen('1.2.3', { version: '1.3.0' })).toBe('update-available');
  });

  it("'on-pen-newer' when the on-pen version is (implausibly) newer than the official release", () => {
    expect(compareOfficialToOnPen('2.0.0', { version: '1.9.9' })).toBe('on-pen-newer');
  });
});
