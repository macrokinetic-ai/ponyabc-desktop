/**
 * Time estimates for writing to the pen.
 *
 * The pen's USB is **1.x**. Measured on a real pen: a full-card `dd` image ran at **978 kB/s**.
 * So a 1.1 GB book takes about nineteen minutes, and a parent who is given no estimate and no
 * progress cannot tell a working copy from a hung one — they unplug, and a FAT volume is left
 * with a half-written book.
 *
 * Deliberately pessimistic and deliberately round. An estimate that reads "about 20 minutes" and
 * finishes in 17 is a pleasant surprise; one that says "12 minutes" and takes 19 is the app
 * lying to someone who then goes out.
 */

/** Measured, not assumed: 978 kB/s from a full-card image of a real pen. */
export const PEN_WRITE_BYTES_PER_SECOND = 978_000;

/**
 * Bytes read back from the pen to verify one book: the first and last 8 MB.
 *
 * It used to be the whole file, which doubled every transfer — ~19 minutes of writing followed
 * by ~19 minutes of reading. Now it is a flat ~16 MB, about sixteen seconds, however large the
 * book is. A file smaller than 16 MB is verified whole, which costs no more than its own size.
 */
export const VERIFY_READBACK_BYTES = 16 * 1024 * 1024;

/** Total bytes moved over USB for a set of books: each one written, then partly read back. */
export function transferBytesFor(sizesBytes: readonly number[]): number {
  return sizesBytes.reduce((sum, size) => sum + size + Math.min(size, VERIFY_READBACK_BYTES), 0);
}

/**
 * Whole minutes, rounded up, for a given number of bytes.
 *
 * Returns 0 for anything under a minute so the caller can offer "a minute or two" instead of a
 * precise-sounding "1 minute" for a job that might take fifteen seconds.
 */
export function estimateMinutes(totalBytes: number, bytesPerSecond: number = PEN_WRITE_BYTES_PER_SECOND): number {
  if (totalBytes <= 0) return 0;
  const seconds = totalBytes / bytesPerSecond;
  if (seconds < 90) return 0;
  const minutes = Math.ceil(seconds / 60);
  // Past a quarter of an hour, minute-precision is false precision — round to five so the number
  // reads as the approximation it is.
  return minutes > 15 ? Math.ceil(minutes / 5) * 5 : minutes;
}

/**
 * Minutes left, from what has actually been written so far.
 *
 * Uses the observed rate once enough has been written to trust it, and the measured baseline
 * before that — an estimate from the first two seconds of a twenty-minute copy is noise.
 */
export function remainingMinutes(bytesWritten: number, totalBytes: number, elapsedMs: number): number {
  const remainingBytes = Math.max(totalBytes - bytesWritten, 0);
  if (remainingBytes === 0) return 0;

  const observed = elapsedMs > 5_000 && bytesWritten > 2_000_000 ? bytesWritten / (elapsedMs / 1000) : 0;
  const rate = observed > 0 ? observed : PEN_WRITE_BYTES_PER_SECOND;
  return estimateMinutes(remainingBytes, rate);
}
