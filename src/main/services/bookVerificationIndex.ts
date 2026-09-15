import type { BookVerifyRecord } from '@shared/types';
import type { JsonStore } from './bookStore';

/** Capped, update-in-place — a single record per (pen volume label, filename), never an
 *  unbounded append-only history. Comfortably above any real catalog's size (a few dozen
 *  books), so eviction only ever trims genuinely stale entries. */
const MAX_RECORDS = 300;

function keyFor(penVolumeLabel: string, fileName: string): string {
  return `${penVolumeLabel}::${fileName.toLowerCase()}`;
}

/** Replaces any existing record for the same (pen, filename) — never appends a second one —
 *  then evicts the oldest-verified entries if still over the cap. */
export function upsertVerifyRecord(store: JsonStore<BookVerifyRecord[]>, record: BookVerifyRecord): void {
  store.update((cur) => {
    const key = keyFor(record.penVolumeLabel, record.fileName);
    const next = [...cur.filter((r) => keyFor(r.penVolumeLabel, r.fileName) !== key), record];
    if (next.length <= MAX_RECORDS) return next;
    return next.sort((a, b) => b.verifiedAtMs - a.verifiedAtMs).slice(0, MAX_RECORDS);
  });
}

/**
 * Returns the cached record only if it's still trustworthy for the exact file being asked
 * about — never merely because the volume label/path matches. All of the following must hold:
 * the pen's device identity hasn't changed since verification (penGeneration), the file's own
 * size and mtime are unchanged (content wasn't touched), and the catalog's official hash for
 * this content id is still the one that was verified against. Any mismatch means "unknown
 * again" — this is a cache-validity check, not a trust decision about the record's origin.
 */
export function findValidVerifyRecord(
  records: BookVerifyRecord[],
  params: { penVolumeLabel: string; penGeneration: number; fileName: string; sizeBytes: number; mtimeMs: number; officialSha256: string },
): BookVerifyRecord | null {
  const key = keyFor(params.penVolumeLabel, params.fileName);
  const record = records.find((r) => keyFor(r.penVolumeLabel, r.fileName) === key);
  if (!record) return null;
  if (
    record.penGenerationAtVerify !== params.penGeneration ||
    record.sizeBytes !== params.sizeBytes ||
    record.mtimeMs !== params.mtimeMs ||
    record.officialSha256 !== params.officialSha256
  ) {
    return null;
  }
  return record;
}
