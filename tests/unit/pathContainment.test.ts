import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isPathContained } from '../../src/main/services/pathSecurity';

// Pure-logic tests: pass path.win32 / path.posix explicitly so Windows drive-root and
// UNC behavior is verified without needing a real Windows filesystem. These sit
// alongside (not instead of) the real fs.realpathSync-based tests in
// pathSecurity.test.ts, which cover the actual symlink/junction-escape case.

describe('isPathContained — win32', () => {
  const win = path.win32;

  it('treats a drive root and its BOOK/DIY subfolder as contained', () => {
    expect(isPathContained('D:\\', 'D:\\BOOK', win)).toBe(true);
    expect(isPathContained('D:\\', 'D:\\DIY', win)).toBe(true);
  });

  it('treats the exact same location as contained, including case and trailing-slash differences', () => {
    expect(isPathContained('D:\\', 'D:\\', win)).toBe(true);
    expect(isPathContained('D:\\BOOK', 'D:\\BOOK\\', win)).toBe(true);
    expect(isPathContained('D:\\Foo', 'D:\\foo', win)).toBe(true); // Windows paths are case-insensitive
  });

  it('rejects a sibling folder', () => {
    expect(isPathContained('D:\\BOOK', 'D:\\OTHER', win)).toBe(false);
  });

  it('rejects the parent of the parent (an escape one level up)', () => {
    expect(isPathContained('D:\\BOOK\\Sub', 'D:\\BOOK', win)).toBe(false);
  });

  it('rejects a cross-drive escape', () => {
    expect(isPathContained('D:\\', 'E:\\BOOK', win)).toBe(false);
  });

  it('handles UNC paths', () => {
    expect(isPathContained('\\\\server\\share', '\\\\server\\share\\DIY', win)).toBe(true);
    expect(isPathContained('\\\\server\\share', '\\\\otherserver\\share\\DIY', win)).toBe(false);
  });
});

describe('isPathContained — posix (regression guard for mac/linux)', () => {
  const posix = path.posix;

  it('treats a volume root and its BOOK/DIY subfolder as contained', () => {
    expect(isPathContained('/Volumes/PEN', '/Volumes/PEN/BOOK', posix)).toBe(true);
  });

  it('treats a trailing-slash-only difference as the same location', () => {
    expect(isPathContained('/Volumes/PEN', '/Volumes/PEN/', posix)).toBe(true);
  });

  it('is case-sensitive on posix, unlike win32', () => {
    expect(isPathContained('/Volumes/Pen', '/Volumes/pen', posix)).toBe(false);
  });

  it('rejects a sibling and an escape', () => {
    expect(isPathContained('/Volumes/PEN/BOOK', '/Volumes/PEN/OTHER', posix)).toBe(false);
    expect(isPathContained('/Volumes/PEN/BOOK/Sub', '/Volumes/PEN/BOOK', posix)).toBe(false);
  });
});
