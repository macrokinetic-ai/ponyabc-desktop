import { resolveBookDisplayName } from '@shared/bookDisplay';
import type { BookCatalogEntry, BookItemStatus } from '@shared/types';

// Re-exported so main-process call sites can name-import from here alongside the other pure
// BOOK-status helpers; the renderer imports resolveBookDisplayName from @shared/bookDisplay
// directly to recompute display names locally on a UI language switch (no IPC round trip).
export { resolveBookDisplayName as resolveDisplayName };

/**
 * An install/update/reinstall action is only ever offered when the catalog has DECLARED
 * (not guessed) a filename and a trustworthy hash. This is the enforcement point used by
 * both the status/action computation (bookReconcile.ts) and the actual write path
 * (bookDownload.ts) — never just a UI hint.
 */
export function isInstallEligible(entry: BookCatalogEntry): boolean {
  return entry.filenameSource === 'declared' && entry.sha256 !== null;
}

/**
 * Pure status derivation. `penFile` is `null` when there is no pen file matching this
 * entry's filename; `{ sha256: null }` when a pen file exists but couldn't be hash-compared
 * (the catalog's own sha256 is null, or the pen file was unreadable) — deliberately distinct
 * from "no pen file at all".
 */
export function resolveBookItemStatus(params: {
  entry: BookCatalogEntry | null;
  isAmbiguous: boolean;
  cachedSha256: string | null;
  penFile: { sha256: string | null } | null;
}): BookItemStatus {
  const { entry, isAmbiguous, cachedSha256, penFile } = params;
  if (!entry) return 'not-in-catalog';
  if (isAmbiguous) return 'catalog-ambiguous';
  if (entry.filenameSource !== 'declared') return 'catalog-incomplete-metadata';

  if (penFile !== null) {
    if (entry.sha256 === null || penFile.sha256 === null) return 'on-pen-hash-unknown';
    return penFile.sha256 === entry.sha256 ? 'on-pen-current' : 'on-pen-differs-from-official';
  }

  if (cachedSha256 !== null && entry.sha256 !== null && cachedSha256 === entry.sha256) return 'catalog-cached-current';
  if (cachedSha256 !== null) return 'catalog-cached-stale';
  return 'catalog-not-cached';
}
