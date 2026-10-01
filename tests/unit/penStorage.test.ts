import { describe, expect, it } from 'vitest';
import { formatGb, formatSpace, penStorage } from '../../src/shared/penStorage';

/**
 * How much room is left on the pen, in words a parent can read.
 *
 * The rule that matters here is the refusal: when the volume's figures cannot be read, this must
 * say so rather than show a number. A figure that is wrong has someone deleting recordings they
 * did not need to delete.
 */
describe('penStorage', () => {
  it('splits the used space into books, recordings and everything else', () => {
    const s = penStorage({
      totalBytes: 14_800_000_000,
      freeBytes: 2_400_000_000,
      bookSizes: [10_000_000_000, 1_000_000_000],
      recordingSizes: [200_000_000, 100_000_000],
    });

    expect(s).not.toBeNull();
    expect(s?.usedBytes).toBe(12_400_000_000);
    expect(s?.bookBytes).toBe(11_000_000_000);
    expect(s?.recordingBytes).toBe(300_000_000);
    expect(s?.otherBytes).toBe(1_100_000_000);
  });

  it('never reports a negative "everything else", which FAT cluster rounding would produce', () => {
    const s = penStorage({
      totalBytes: 1_000_000_000,
      freeBytes: 900_000_000,
      // The listings add up to more than the filesystem says is used — normal on a FAT card.
      bookSizes: [120_000_000],
      recordingSizes: [],
    });
    expect(s?.otherBytes).toBe(0);
  });

  it('says nothing at all when the pen could not be measured', () => {
    expect(penStorage({ totalBytes: null, freeBytes: 1, bookSizes: [], recordingSizes: [] })).toBeNull();
    expect(penStorage({ totalBytes: 1, freeBytes: null, bookSizes: [], recordingSizes: [] })).toBeNull();
    expect(penStorage({ totalBytes: 0, freeBytes: 0, bookSizes: [], recordingSizes: [] })).toBeNull();
  });

  it('refuses a figure that is absent or not a number, rather than printing NaN GB', () => {
    // How this went wrong: the first guard checked only for null, and a caller that left the
    // fields out put "NaN GB of NaN GB used on your pen" on screen.
    const missing = penStorage({
      totalBytes: undefined as unknown as number,
      freeBytes: undefined as unknown as number,
      bookSizes: [],
      recordingSizes: [],
    });
    expect(missing).toBeNull();
    expect(penStorage({ totalBytes: NaN, freeBytes: 1, bookSizes: [], recordingSizes: [] })).toBeNull();
  });

  it('ignores a nonsense size in a listing instead of poisoning the total', () => {
    const s = penStorage({
      totalBytes: 1_000_000_000,
      freeBytes: 500_000_000,
      bookSizes: [100_000_000, NaN, -5],
      recordingSizes: [],
    });
    expect(s?.bookBytes).toBe(100_000_000);
  });
});

describe('the words the sizes are written in', () => {
  it('uses one decimal place of GB, in the app language', () => {
    expect(formatGb(12_400_000_000, 'en-GB')).toBe('12.4 GB');
    expect(formatGb(14_800_000_000, 'en-GB')).toBe('14.8 GB');
  });

  it('drops to MB for the small parts, so nothing reads as 0.0 GB', () => {
    expect(formatSpace(300_000_000, 'en-GB')).toBe('300 MB');
    expect(formatSpace(1_500_000_000, 'en-GB')).toBe('1.5 GB');
    expect(formatSpace(0, 'en-GB')).toBe('0 MB');
  });
});
