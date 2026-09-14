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
 * side. Hashing a pen file is only ever done once per file, and only for a file that
 * actually matches a single, unambiguous catalog filename AND whose catalog hash is
 * non-null — never eagerly for every file on every refresh. An unmatched (or ambiguously
 * matched) pen file is always "unknown" and always non-removable — structurally, this
 * function never produces a removable=true result for one.
 */
export async function buildBookLibrary(params: {
  snapshot: BookCatalogSnapshot | null;
  cacheEntries: BookCacheEntry[];
  penFiles: PenBookFile[] | null;
  bookDirReal: string | null;
}): Promise<{ penItems: BookPenItem[] | null; catalogItems: BookCatalogItem[] }> {
  const { snapshot, cacheEntries, penFiles, bookDirReal } = params;
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

  // Compute each matched pen file's hash exactly once, reused by both the catalog-item pass
  // and the pen-item pass below.
  const penHashByFilenameLower = new Map<string, string | null>();
  for (const [key, f] of penByFilenameLower) {
    const entry = entryByFilenameLower.get(key);
    if (!entry || entry.sha256 === null || !bookDirReal) continue;
    try {
      penHashByFilenameLower.set(key, await sha256File(path.join(bookDirReal, f.fileName)));
    } catch {
      penHashByFilenameLower.set(key, null);
    }
  }

  const catalogItems: BookCatalogItem[] = entries.map((entry) => {
    const isAmbiguous = ambiguousIds.has(entry.contentId);
    const eligible = isInstallEligible(entry);
    const key = entry.filename.toLowerCase();
    const hasPenFile = !isAmbiguous && penByFilenameLower.has(key) && entryByFilenameLower.get(key) === entry;
    const penHash = hasPenFile ? (penHashByFilenameLower.get(key) ?? null) : null;
    const cached = cacheByContentId.get(entry.contentId) ?? null;

    let status: BookCatalogItemStatus;
    if (isAmbiguous) status = 'ambiguous';
    else if (!eligible) status = 'metadata-incomplete';
    else if (hasPenFile) status = penHash !== null && penHash === entry.sha256 ? 'on-pen-current' : 'on-pen-differs';
    else status = 'not-on-pen';

    return {
      contentId: entry.contentId,
      filename: entry.filename,
      friendlyName: entry.friendlyName,
      friendlyNameI18n: entry.friendlyNameI18n,
      sizeBytes: entry.sizeBytes,
      status,
      cached: cached !== null,
      actionable: eligible && !isAmbiguous && (status === 'not-on-pen' || status === 'on-pen-differs'),
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
          status: 'unknown' as const,
          removable: false,
        };
      }
      const penHash = penHashByFilenameLower.get(key) ?? null;
      const matchStatus: BookPenMatchStatus =
        entry.sha256 === null || penHash === null ? 'matched-hash-unknown' : penHash === entry.sha256 ? 'matched-current' : 'matched-differs';
      return {
        fileName: f.fileName,
        sizeBytes: f.sizeBytes,
        contentId: entry.contentId,
        friendlyName: entry.friendlyName,
        friendlyNameI18n: entry.friendlyNameI18n,
        status: matchStatus,
        removable: true,
      };
    });
  }

  return { penItems, catalogItems };
}
