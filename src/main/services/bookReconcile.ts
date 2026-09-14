import fs from 'node:fs';
import path from 'node:path';
import type {
  BookCacheEntry,
  BookCatalogEntry,
  BookCatalogItem,
  BookCatalogItemStatus,
  BookCatalogSnapshot,
  BookPenItem,
  BookPenMatchStatus,
} from '@shared/types';
import { isEligibleAxbFileName } from './pathSecurity';
import { isInstallEligible } from './bookStatus';
import { sha256File } from './transferService';

export interface PenBookFile {
  fileName: string;
  sizeBytes: number;
}

/** A matched pen file whose content hash still needs verifying before its status can move
 *  past "verifying" — deliberately NOT computed inside buildBookLibrary, so listing the pane
 *  is never blocked on hashing a large (100s of MB) AXB; callers verify these afterward
 *  (see verifyPendingHash) and push the resolved status once it's known. */
export interface PendingVerification {
  fileName: string;
  contentId: string;
  expectedSha256: string;
}

/** Lists eligible .axb files directly in the pen's BOOK folder (excludes AppleDouble
 *  sidecars). Returns [] rather than throwing when the folder can't be read. */
export function listPenBookFiles(bookDirReal: string): PenBookFile[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(bookDirReal, { withFileTypes: true });
  } catch {
    return [];
  }
  const files: PenBookFile[] = [];
  for (const entry of entries) {
    if (!isEligibleAxbFileName(entry.name)) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;
    try {
      const stat = fs.statSync(path.join(bookDirReal, entry.name));
      if (!stat.isFile()) continue;
      files.push({ fileName: entry.name, sizeBytes: stat.size });
    } catch {
      // vanished between readdir and stat — skip it, next refresh will pick up reality
    }
  }
  return files;
}

/**
 * Merges catalog + local cache + pen state into the two panes the renderer shows side by
 * side. Deliberately synchronous/fast — it never reads or hashes a pen file's content, only
 * filenames and sizes already known from listPenBookFiles, so a large (100s of MB) AXB on the
 * pen can never delay the catalog/filename-match display from appearing. Any matched file
 * whose current-vs-differs status actually requires a hash comparison is returned as
 * "verifying" (pending) instead — the caller is expected to resolve each pending entry via
 * verifyPendingHash afterward and push the final status once known.
 *
 * A pen file that doesn't match anything is "awaiting-catalog" (not "unknown") for as long as
 * NO catalog has ever been successfully fetched (snapshot === null) — there's nothing yet to
 * judge it against, so it must never be presented as if it had already been checked and found
 * unrecognized. Only once a real catalog snapshot exists (even one with zero entries) does a
 * non-matching file become "unknown". Either way it's always non-removable — structurally,
 * this function never produces a removable=true result for an unmatched file.
 */
export function buildBookLibrary(params: {
  snapshot: BookCatalogSnapshot | null;
  cacheEntries: BookCacheEntry[];
  penFiles: PenBookFile[] | null;
  bookDirReal: string | null;
}): { penItems: BookPenItem[] | null; catalogItems: BookCatalogItem[]; pending: PendingVerification[] } {
  const { snapshot, cacheEntries, penFiles, bookDirReal } = params;
  const entries = snapshot?.entries ?? [];
  const conflicts = snapshot?.conflicts ?? [];
  const ambiguousIds = new Set(conflicts.flatMap((c) => c.contentIds));
  const cacheByContentId = new Map(cacheEntries.map((c) => [c.contentId, c]));
  const pending: PendingVerification[] = [];

  // Filename (lowercased) -> the single unambiguous catalog entry it matches, if any.
  const entryByFilenameLower = new Map<string, BookCatalogEntry>();
  for (const entry of entries) {
    const key = entry.filename.toLowerCase();
    if (ambiguousIds.has(entry.contentId)) continue; // never a safe match target
    if (!entryByFilenameLower.has(key)) entryByFilenameLower.set(key, entry);
  }

  const penByFilenameLower = new Map<string, PenBookFile>();
  for (const f of penFiles ?? []) penByFilenameLower.set(f.fileName.toLowerCase(), f);

  // Callers always pass bookDirReal alongside penFiles as a pair (see currentPenBookFiles in
  // ipc/book.ts) — penFiles is only ever non-null when there's a real directory to read from.
  const canReadPenFiles = penFiles !== null && bookDirReal !== null;

  const catalogItems: BookCatalogItem[] = entries.map((entry) => {
    const isAmbiguous = ambiguousIds.has(entry.contentId);
    const eligible = isInstallEligible(entry);
    const key = entry.filename.toLowerCase();
    const hasPenFile = !isAmbiguous && penByFilenameLower.has(key) && entryByFilenameLower.get(key) === entry;
    const willVerify = hasPenFile && eligible && canReadPenFiles;

    let status: BookCatalogItemStatus;
    if (isAmbiguous) status = 'ambiguous';
    else if (!eligible) status = 'metadata-incomplete';
    else if (hasPenFile) status = 'on-pen-verifying';
    else status = 'not-on-pen';

    const cached = cacheByContentId.get(entry.contentId) ?? null;
    if (willVerify) pending.push({ fileName: penByFilenameLower.get(key)!.fileName, contentId: entry.contentId, expectedSha256: entry.sha256 as string });

    return {
      contentId: entry.contentId,
      filename: entry.filename,
      friendlyName: entry.friendlyName,
      friendlyNameI18n: entry.friendlyNameI18n,
      sizeBytes: entry.sizeBytes,
      status,
      cached: cached !== null,
      actionable: eligible && !isAmbiguous && status === 'not-on-pen',
      updatedAtMs: entry.updatedAtMs,
    };
  });

  let penItems: BookPenItem[] | null = null;
  if (penFiles !== null) {
    penItems = penFiles.map((f) => {
      const key = f.fileName.toLowerCase();
      const entry = entryByFilenameLower.get(key);
      if (!entry) {
        return {
          fileName: f.fileName,
          sizeBytes: f.sizeBytes,
          contentId: null,
          friendlyName: null,
          friendlyNameI18n: null,
          status: snapshot === null ? 'awaiting-catalog' : 'unknown',
          removable: false,
          updatedAtMs: null,
        };
      }
      const eligible = isInstallEligible(entry);
      const matchStatus: BookPenMatchStatus = eligible && canReadPenFiles ? 'matched-verifying' : 'matched-hash-unknown';
      return {
        fileName: f.fileName,
        sizeBytes: f.sizeBytes,
        contentId: entry.contentId,
        friendlyName: entry.friendlyName,
        friendlyNameI18n: entry.friendlyNameI18n,
        status: matchStatus,
        removable: true,
        updatedAtMs: entry.updatedAtMs,
      };
    });
  }

  return { penItems, catalogItems, pending };
}

/** Resolves one pending verification: reads and hashes the pen file (only now — never during
 *  the fast listing above) and compares it to the catalog's declared hash. Returns null on a
 *  read/hash failure (file vanished, permission error, etc.) so the caller can fall back to a
 *  safe "can't verify" status rather than a false current/differs claim. */
export async function verifyPendingHash(bookDirReal: string, pending: PendingVerification): Promise<'current' | 'differs' | null> {
  try {
    const actual = await sha256File(path.join(bookDirReal, pending.fileName));
    return actual === pending.expectedSha256 ? 'current' : 'differs';
  } catch {
    return null;
  }
}
