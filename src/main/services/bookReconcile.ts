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
  BookVerifyRecord,
} from '@shared/types';
import { isEligibleAxbFileName } from './pathSecurity';
import { isInstallEligible } from './bookStatus';
import { findValidVerifyRecord } from './bookVerificationIndex';

export interface PenBookFile {
  fileName: string;
  sizeBytes: number;
  mtimeMs: number;
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
      files.push({ fileName: entry.name, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // vanished between readdir and stat — skip it, next refresh will pick up reality
    }
  }
  return files;
}

/**
 * Merges catalog + local cache + pen state into the two panes the renderer shows side by
 * side. Never reads or hashes a pen file's content — only filenames/sizes/mtimes already known
 * from listPenBookFiles (a `stat`, not a file read) and whatever's already in the App-managed
 * verification index (verifyRecords), so a plain refresh/list is always fast regardless of how
 * large or how many AXBs are on the pen. A matched file only shows 'verified-current'/
 * 'verified-differs' when a still-valid cached verification record exists for the exact
 * pen/file/hash combination (see findValidVerifyRecord) — otherwise it's 'present': matched by
 * filename, but its content has NOT been confirmed identical to the official version. Actually
 * hashing a file only ever happens via the separate, explicit verifyOneFile() below, triggered
 * by a user action — never automatically here.
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
  penVolumeLabel: string | null;
  penGeneration: number;
  verifyRecords: BookVerifyRecord[];
}): { penItems: BookPenItem[] | null; catalogItems: BookCatalogItem[] } {
  const { snapshot, cacheEntries, penFiles, penVolumeLabel, penGeneration, verifyRecords } = params;
  const entries = snapshot?.entries ?? [];
  const conflicts = snapshot?.conflicts ?? [];
  const ambiguousIds = new Set(conflicts.flatMap((c) => c.contentIds));
  const cacheByContentId = new Map(cacheEntries.map((c) => [c.contentId, c]));

  // Filename (lowercased) -> the single unambiguous catalog entry it matches, if any.
  const entryByFilenameLower = new Map<string, BookCatalogEntry>();
  for (const entry of entries) {
    const key = entry.filename.toLowerCase();
    if (ambiguousIds.has(entry.contentId)) continue; // never a safe match target
    if (!entryByFilenameLower.has(key)) entryByFilenameLower.set(key, entry);
  }

  const penByFilenameLower = new Map<string, PenBookFile>();
  for (const f of penFiles ?? []) penByFilenameLower.set(f.fileName.toLowerCase(), f);

  /** null = no verified record applies (either not eligible to check, or the cached record is
   *  stale/missing); otherwise the resolved 'current'/'differs' outcome from the index. */
  function verifiedOutcome(entry: BookCatalogEntry, penFile: PenBookFile): 'current' | 'differs' | null {
    if (penVolumeLabel === null || entry.sha256 === null) return null;
    const record = findValidVerifyRecord(verifyRecords, {
      penVolumeLabel,
      penGeneration,
      fileName: penFile.fileName,
      sizeBytes: penFile.sizeBytes,
      mtimeMs: penFile.mtimeMs,
      officialSha256: entry.sha256,
    });
    if (!record) return null;
    return record.observedSha256 === record.officialSha256 ? 'current' : 'differs';
  }

  const catalogItems: BookCatalogItem[] = entries.map((entry) => {
    const isAmbiguous = ambiguousIds.has(entry.contentId);
    const eligible = isInstallEligible(entry);
    const key = entry.filename.toLowerCase();
    const penFile = !isAmbiguous && entryByFilenameLower.get(key) === entry ? penByFilenameLower.get(key) : undefined;
    const hasPenFile = penFile !== undefined;
    const outcome = hasPenFile && eligible ? verifiedOutcome(entry, penFile) : null;

    let status: BookCatalogItemStatus;
    if (isAmbiguous) status = 'ambiguous';
    else if (!eligible) status = 'metadata-incomplete';
    else if (!hasPenFile) status = 'not-on-pen';
    else if (outcome === 'current') status = 'on-pen-current';
    else if (outcome === 'differs') status = 'on-pen-differs';
    else status = 'on-pen-present';

    const cached = cacheByContentId.get(entry.contentId) ?? null;

    return {
      contentId: entry.contentId,
      filename: entry.filename,
      friendlyName: entry.friendlyName,
      friendlyNameI18n: entry.friendlyNameI18n,
      sizeBytes: entry.sizeBytes,
      status,
      cached: cached !== null,
      actionable: eligible && !isAmbiguous && (status === 'not-on-pen' || status === 'on-pen-present' || status === 'on-pen-differs'),
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
      const outcome = eligible ? verifiedOutcome(entry, f) : null;
      const matchStatus: BookPenMatchStatus = !eligible
        ? 'matched-hash-unknown'
        : outcome === 'current'
          ? 'verified-current'
          : outcome === 'differs'
            ? 'verified-differs'
            : 'present';
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

  return { penItems, catalogItems };
}
