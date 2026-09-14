import { describe, expect, it } from 'vitest';
import { isNewerVersion } from '../../src/shared/semver';

describe('isNewerVersion', () => {
  it('detects a newer patch, minor, and major version', () => {
    expect(isNewerVersion('0.2.3', '0.2.2')).toBe(true);
    expect(isNewerVersion('0.3.0', '0.2.9')).toBe(true);
    expect(isNewerVersion('1.0.0', '0.9.9')).toBe(true);
  });

  it('returns false for an equal or older version', () => {
    expect(isNewerVersion('0.2.2', '0.2.2')).toBe(false);
    expect(isNewerVersion('0.2.1', '0.2.2')).toBe(false);
    expect(isNewerVersion('0.1.9', '0.2.0')).toBe(false);
  });

  it('handles a leading "v" on either side', () => {
    expect(isNewerVersion('v0.2.3', '0.2.2')).toBe(true);
    expect(isNewerVersion('v0.2.2', 'v0.2.2')).toBe(false);
  });

  it('never throws on a malformed version string — treats missing/non-numeric parts as 0', () => {
    expect(() => isNewerVersion('not-a-version', '0.2.2')).not.toThrow();
    expect(isNewerVersion('', '0.0.0')).toBe(false);
    expect(isNewerVersion('1', '0.9.9')).toBe(true); // "1" -> 1.0.0
  });
});
