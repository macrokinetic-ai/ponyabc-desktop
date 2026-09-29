import fs from 'node:fs';
import path from 'node:path';
import { isPathContained, resolvePenRoot } from './pathSecurity';

/**
 * Pre-flash cleanup, required before EVERY firmware upgrade.
 *
 * The vendor's documentation does not mention this. Confirmed with the vendor and
 * verified on a real pen on 2026-09-30: a firmware upgrade does NOT take effect unless
 * `1.BIN` and `BOOKFILE.BIN` are deleted from the pen's BOOK directory first. With the
 * deletion it works; without it, it silently does not. They appear to be a stale content
 * index that the old firmware leaves behind and the new firmware will not rebuild while
 * they exist.
 *
 * Scope, deliberately narrow:
 *   - ONLY firmware upgrades. Updating .axb books does NOT need this and must never do
 *     it — a book update that deleted the content index would be destructive for no
 *     reason.
 *   - ONLY the BOOK directory's own root, not recursively. A `1.BIN` inside a
 *     subdirectory is somebody's content, not the index.
 *   - ONLY the exact names in the list. Nothing else on the pen is touched — not
 *     recordings, not .axb books, not DIY.
 *
 * The list is a parameter rather than a constant so a future release can carry its own
 * preflight steps from the catalogue (see docs/design/firmware-preflight-metadata.md)
 * without shipping a new app build. `DEFAULT_FIRMWARE_PREFLIGHT_DELETIONS` is what runs
 * when a release specifies nothing.
 */

/** The two files every known firmware release must have removed before flashing. */
export const DEFAULT_FIRMWARE_PREFLIGHT_DELETIONS = ['1.BIN', 'BOOKFILE.BIN'] as const;

export type PreflightDeletionStatus =
  /** Matched a real file and it is now gone. */
  | 'deleted'
  /** No file of that name was present. Expected and fine — a pen that has never had books. */
  | 'absent'
  /** Present but could not be removed. This ABORTS the upgrade. */
  | 'failed';

export interface PreflightDeletion {
  /** The name as requested, e.g. `1.BIN`. */
  requested: string;
  /** The actual on-disk name that matched, preserving the pen's own casing, or null. */
  matched: string | null;
  status: PreflightDeletionStatus;
  /** Present only for `failed`. */
  error?: string;
}

export type FirmwarePreflightResult =
  | { ok: true; bookDir: string; deletions: PreflightDeletion[] }
  | {
      ok: false;
      reason: 'not-a-pen' | 'book-dir-unreadable' | 'deletion-failed';
      /** Human-readable detail for diagnostics; never a raw secret. */
      detail: string;
      bookDir: string | null;
      deletions: PreflightDeletion[];
    };

/**
 * Runs the pre-flash cleanup against `penRootPath`.
 *
 * Returns `ok: false` WITHOUT having flashed anything if the target is not a real pen or
 * if any present file could not be deleted. The caller must treat that as fatal and abort
 * before launching the flasher: flashing over a stale index is precisely the failure this
 * exists to prevent, and a half-done cleanup is worse than none.
 */
export function runFirmwarePreflight(
  penRootPath: string,
  fileNames: readonly string[] = DEFAULT_FIRMWARE_PREFLIGHT_DELETIONS,
): FirmwarePreflightResult {
  // 1. Confirm this really is a PonyABC pen before deleting anything from it. resolvePenRoot
  //    canonicalizes the path and requires BOTH BOOK and DIY to exist, which is the same
  //    check the rest of the app uses to accept a drive as a pen. Deleting BOOK/1.BIN from
  //    an arbitrary removable drive because the user picked the wrong one is the worst
  //    outcome available here, so this is not optional and not skippable.
  const resolved = resolvePenRoot(penRootPath);
  if (resolved.status !== 'ok') {
    const detail =
      resolved.status === 'not-found'
        ? `pen root not found: ${penRootPath}`
        : `not a pen (missing ${resolved.missing.join(' and ')}): ${penRootPath}`;
    return { ok: false, reason: 'not-a-pen', detail, bookDir: null, deletions: [] };
  }

  const bookDir = resolved.bookDirReal;

  // 2. One listing of the BOOK directory root. Non-recursive on purpose.
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(bookDir, { withFileTypes: true });
  } catch (err) {
    return {
      ok: false,
      reason: 'book-dir-unreadable',
      detail: err instanceof Error ? err.message : String(err),
      bookDir,
      deletions: [],
    };
  }

  const deletions: PreflightDeletion[] = [];

  for (const requested of fileNames) {
    // FAT is case-insensitive, so the pen may hold `1.BIN`, `1.bin` or `1.Bin`. Match on a
    // case-folded comparison but delete using the name the filesystem actually reports.
    const hit = entries.find((e) => e.name.toLowerCase() === requested.toLowerCase() && !e.isDirectory());

    if (!hit) {
      deletions.push({ requested, matched: null, status: 'absent' });
      continue;
    }

    const target = path.join(bookDir, hit.name);

    // Belt and braces: never unlink anything that does not resolve inside the BOOK
    // directory. A symlink is not expected on a FAT volume, but this costs nothing and the
    // failure it prevents is deleting a file elsewhere on the user's machine.
    let targetReal: string;
    try {
      targetReal = fs.realpathSync(target);
    } catch (err) {
      deletions.push({
        requested,
        matched: hit.name,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      break;
    }
    if (!isPathContained(bookDir, targetReal)) {
      deletions.push({
        requested,
        matched: hit.name,
        status: 'failed',
        error: `resolves outside the BOOK directory: ${targetReal}`,
      });
      break;
    }

    try {
      fs.unlinkSync(target);
      deletions.push({ requested, matched: hit.name, status: 'deleted' });
    } catch (err) {
      deletions.push({
        requested,
        matched: hit.name,
        status: 'failed',
        error: err instanceof Error ? err.message : String(err),
      });
      // Stop at the first failure. Carrying on would leave the pen in a partially cleaned
      // state while still ending in an abort, and the second deletion tells us nothing we
      // would act on.
      break;
    }
  }

  const failed = deletions.filter((d) => d.status === 'failed');
  if (failed.length > 0) {
    return {
      ok: false,
      reason: 'deletion-failed',
      detail: failed.map((f) => `${f.matched ?? f.requested}: ${f.error ?? 'unknown error'}`).join('; '),
      bookDir,
      deletions,
    };
  }

  return { ok: true, bookDir, deletions };
}

/** One-line summary for the diagnostics log and the session log. */
export function summarizePreflight(deletions: readonly PreflightDeletion[]): string {
  if (deletions.length === 0) return 'no preflight deletions requested';
  return deletions
    .map((d) => `${d.requested}=${d.status}${d.matched && d.matched !== d.requested ? ` (as ${d.matched})` : ''}`)
    .join(', ');
}
