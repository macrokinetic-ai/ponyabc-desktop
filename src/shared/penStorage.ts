/**
 * What a pen's space looks like, in words a parent can read.
 *
 * The owner asked for this on both the Books and My Recordings screens: how much the pen holds,
 * how much is used and how much is left, with books and recordings counted separately, because
 * "your pen is full" is useless without knowing what is taking the room.
 *
 * Everything here is derived from numbers the app already has — the pen's total and free bytes,
 * the sizes of the books on it, the sizes of the recordings on it. Nothing new is read from the
 * pen to produce it.
 */

export interface PenStorage {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  bookBytes: number;
  recordingBytes: number;
  /** Everything else on the card: the pen's own firmware, its index, a parent's own files. */
  otherBytes: number;
}

export function penStorage(params: {
  totalBytes: number | null;
  freeBytes: number | null;
  bookSizes: readonly number[];
  recordingSizes: readonly number[];
}): PenStorage | null {
  const { totalBytes, freeBytes } = params;
  // Either number missing means we did not manage to read the volume, and a made-up total is
  // worse than no figure at all: a parent would delete things they did not need to.
  //
  // `Number.isFinite` rather than a null check: a field that is absent, undefined or NaN must
  // reach the "we could not check" line too. A null check alone put "NaN GB of NaN GB used" on
  // screen the first time a caller left the figures out.
  if (!Number.isFinite(totalBytes) || !Number.isFinite(freeBytes)) return null;
  if (totalBytes === null || freeBytes === null || totalBytes <= 0 || freeBytes < 0) return null;

  const sum = (xs: readonly number[]) => xs.reduce((n, x) => n + (Number.isFinite(x) && x > 0 ? x : 0), 0);
  const bookBytes = sum(params.bookSizes);
  const recordingBytes = sum(params.recordingSizes);
  const usedBytes = Math.max(0, totalBytes - freeBytes);

  return {
    totalBytes,
    usedBytes,
    freeBytes,
    bookBytes,
    recordingBytes,
    // Never negative: the used figure comes from the filesystem and the two sums from file
    // listings, and on a FAT card those disagree slightly by design (cluster rounding).
    otherBytes: Math.max(0, usedBytes - bookBytes - recordingBytes),
  };
}

/**
 * A size in the units a parent thinks in, one decimal place at most.
 *
 * GB throughout for the pen's own capacity, because mixing MB and GB in one sentence — "12.4 GB
 * of 14.8 GB used, 840 MB free" — makes two numbers that cannot be compared at a glance.
 */
export function formatGb(bytes: number, locale: string): string {
  const gb = bytes / 1_000_000_000;
  const fmt = new Intl.NumberFormat(locale, { maximumFractionDigits: gb < 10 ? 1 : 1, minimumFractionDigits: 1 });
  return `${fmt.format(gb)} GB`;
}

/** For the per-part figures, where a small number in GB reads as "0.0 GB". */
export function formatSpace(bytes: number, locale: string): string {
  if (bytes >= 1_000_000_000) return formatGb(bytes, locale);
  const mb = bytes / 1_000_000;
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: mb < 10 ? 1 : 0 }).format(mb)} MB`;
}
