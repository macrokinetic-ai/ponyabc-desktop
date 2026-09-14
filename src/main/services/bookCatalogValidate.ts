import type { BookCatalogConflict, BookCatalogEntry } from '@shared/types';

/**
 * Groups catalog entries by filename.toLowerCase() (matches FAT32/exFAT's case-insensitive
 * semantics — the filesystem every SD card uses). Any group naming more than one distinct
 * content id is a real conflict: two different catalog entries that would collide on the
 * pen. Entries stay in the returned list (still visible/listed) but the caller marks them
 * 'catalog-ambiguous' via bookStatus.ts — never silently resolved by picking one.
 */
export function validateCatalogEntries(entries: BookCatalogEntry[]): {
  entries: BookCatalogEntry[];
  conflicts: BookCatalogConflict[];
} {
  const byLower = new Map<string, Set<string>>();
  for (const entry of entries) {
    const key = entry.filename.toLowerCase();
    const ids = byLower.get(key) ?? new Set<string>();
    ids.add(entry.contentId);
    byLower.set(key, ids);
  }
  const conflicts: BookCatalogConflict[] = [];
  for (const [filenameLower, ids] of byLower) {
    if (ids.size > 1) conflicts.push({ filenameLower, contentIds: [...ids] });
  }
  return { entries, conflicts };
}
