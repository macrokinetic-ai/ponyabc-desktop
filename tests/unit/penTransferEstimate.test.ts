import { describe, expect, it } from 'vitest';
import { PEN_WRITE_BYTES_PER_SECOND, VERIFY_READBACK_BYTES, estimateMinutes, remainingMinutes, transferBytesFor } from '../../src/renderer/screens/penTransferEstimate';

/**
 * The pen's USB is 1.x — 978 kB/s measured from a full-card image. Without an estimate a parent
 * cannot tell a twenty-minute copy from a hang, and unplugging mid-write is the one failure none
 * of the app's other guards can undo.
 */

const MB = 1_000_000;

describe('estimating a write to the pen', () => {
  it('uses the measured rate, not an assumption', () => {
    expect(PEN_WRITE_BYTES_PER_SECOND).toBe(978_000);
  });

  it('says a 1.1 GB book takes about twenty minutes', () => {
    // 1.1 GB / 978 kB/s ≈ 18.7 min, rounded to 5 because minute-precision here is false precision.
    expect(estimateMinutes(1_100 * MB)).toBe(20);
  });

  it('rounds up, never down — a low guess is the app lying to someone who then goes out', () => {
    for (const mb of [100, 300, 600, 900]) {
      const trueMinutes = (mb * MB) / PEN_WRITE_BYTES_PER_SECOND / 60;
      expect(estimateMinutes(mb * MB), `${mb} MB`).toBeGreaterThanOrEqual(trueMinutes);
    }
  });

  it('gives 0 for anything under a minute and a half, so the UI can say "a minute or two"', () => {
    expect(estimateMinutes(10)).toBe(0);
    expect(estimateMinutes(30 * MB)).toBe(0);
    expect(estimateMinutes(0)).toBe(0);
    expect(estimateMinutes(-5)).toBe(0);
  });

  it('keeps minute precision only while the number is small enough to mean something', () => {
    expect(estimateMinutes(200 * MB)).toBe(4);
    expect(estimateMinutes(700 * MB)).toBe(12);
    // Beyond a quarter of an hour it rounds to five.
    expect(estimateMinutes(1_500 * MB) % 5).toBe(0);
  });
});

describe('time remaining', () => {
  it('falls back to the measured rate before there is enough evidence', () => {
    // Two seconds into a twenty-minute copy, the observed rate is noise.
    expect(remainingMinutes(1 * MB, 1_100 * MB, 2_000)).toBe(estimateMinutes(1_099 * MB));
  });

  it('uses the observed rate once there is enough of it', () => {
    // 60 MB in 60s = 1 MB/s observed, with 540 MB to go -> ~9 minutes.
    expect(remainingMinutes(60 * MB, 600 * MB, 60_000)).toBe(9);
  });

  it('notices a pen slower than the baseline', () => {
    // Half the measured speed: the estimate must grow, not stay optimistic.
    const slow = remainingMinutes(30 * MB, 600 * MB, 60_000);
    const baseline = estimateMinutes(570 * MB);
    expect(slow).toBeGreaterThan(baseline);
  });

  it('is 0 when there is nothing left', () => {
    expect(remainingMinutes(600 * MB, 600 * MB, 60_000)).toBe(0);
    expect(remainingMinutes(700 * MB, 600 * MB, 60_000)).toBe(0);
  });
});

describe('what an estimate has to include', () => {
  it('counts the write plus the 16 MB read back, not a second full pass', () => {
    const book = 1_100 * MB;
    expect(transferBytesFor([book])).toBe(book + VERIFY_READBACK_BYTES);
    // The change this replaced would have been 2× the book — about forty minutes rather than twenty.
    expect(transferBytesFor([book])).toBeLessThan(book * 1.05);
  });

  it('never claims to read back more than the file holds', () => {
    expect(transferBytesFor([1_000])).toBe(2_000);
    expect(transferBytesFor([])).toBe(0);
  });

  it('adds up across a batch', () => {
    expect(transferBytesFor([100 * MB, 200 * MB])).toBe(300 * MB + 2 * VERIFY_READBACK_BYTES);
  });

  it('still says about twenty minutes for a 1.1 GB book', () => {
    // Verification adds ~16 s to ~19 min, so the rounded answer is unchanged — which is the
    // point: the parent-facing number got honest without getting worse.
    expect(estimateMinutes(transferBytesFor([1_100 * MB]))).toBe(20);
  });
});
