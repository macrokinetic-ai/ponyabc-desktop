import { resolveBookDisplayName } from '@shared/bookDisplay';
import type { BookCatalogEntry } from '@shared/types';

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
