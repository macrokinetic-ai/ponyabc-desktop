import fs from 'node:fs';
import path from 'node:path';
import type {
  BookAction,
  BookCacheEntry,
  BookCatalogEntry,
  BookCatalogSnapshot,
  BookItemStatus,
  BookLibraryItem,
} from '@shared/types';
import { isEligibleAxbFileName } from './pathSecurity';
import { isInstallEligible, resolveBookItemStatus } from './bookStatus';
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

function actionsFor(status: BookItemStatus, entry: BookCatalogEntry | null): BookAction[] {
  const eligible = entry !== null && isInstallEligible(entry);
  switch (status) {
    case 'catalog-not-cached':
    case 'catalog-cached-current':
    case 'catalog-cached-stale':
      return eligible ? ['add'] : [];
    case 'on-pen-current':
      return eligible ? ['reinstall', 'remove'] : ['remove'];
    case 'on-pen-differs-from-official':
      return eligible ? ['replace', 'remove'] : ['remove'];
    case 'on-pen-hash-unknown':
    case 'not-in-catalog':
      return ['remove'];
    case 'catalog-incomplete-metadata':
    case 'catalog-ambiguous':
      return [];
  }
}

/**
 * Merges catalog + local cache + pen state into one reconciled list. Hashing a pen file is
 * only ever done for a file that actually matches a catalog filename AND whose catalog hash
 * is non-null — never eagerly for every file on every refresh, and never for an ambiguous
 * catalog entry (its status is forced regardless of pen-file linkage).
 */
export async function buildBookLibrary(params: {
  snapshot: BookCatalogSnapshot | null;
  cacheEntries: BookCacheEntry[];
  penFiles: PenBookFile[] | null;
  bookDirReal: string | null;
}): Promise<BookLibraryItem[]> {
  const { snapshot, cacheEntries, penFiles, bookDirReal } = params;
  const entries = snapshot?.entries ?? [];
  const conflicts = snapshot?.conflicts ?? [];
  const ambiguousIds = new Set(conflicts.flatMap((c) => c.contentIds));
  const cacheByContentId = new Map(cacheEntries.map((c) => [c.contentId, c]));
  const penByFilenameLower = new Map<string, PenBookFile>();
  for (const f of penFiles ?? []) penByFilenameLower.set(f.fileName.toLowerCase(), f);

  const matchedPenFilenamesLower = new Set<string>();
  const items: BookLibraryItem[] = [];

  for (const entry of entries) {
    const isAmbiguous = ambiguousIds.has(entry.contentId);
    const penFileRaw = penByFilenameLower.get(entry.filename.toLowerCase()) ?? null;
    if (penFileRaw) matchedPenFilenamesLower.add(penFileRaw.fileName.toLowerCase());

    let penFile: { sha256: string | null } | null = null;
    if (penFileRaw && !isAmbiguous) {
      if (entry.sha256 === null || !bookDirReal) {
        penFile = { sha256: null };
      } else {
        try {
          penFile = { sha256: await sha256File(path.join(bookDirReal, penFileRaw.fileName)) };
        } catch {
          penFile = { sha256: null };
        }
      }
    }

    const cached = cacheByContentId.get(entry.contentId) ?? null;
    const status = resolveBookItemStatus({
      entry,
      isAmbiguous,
      cachedSha256: cached ? cached.sha256 : null,
      penFile,
    });

    items.push({
      contentId: entry.contentId,
      filename: entry.filename,
      friendlyName: entry.friendlyName,
      friendlyNameI18n: entry.friendlyNameI18n,
      status,
      sizeBytes: entry.sizeBytes,
      cached: cached !== null,
      onPen: penFileRaw !== null,
      availableActions: actionsFor(status, entry),
    });
  }

  for (const f of penFiles ?? []) {
    if (matchedPenFilenamesLower.has(f.fileName.toLowerCase())) continue;
    items.push({
      contentId: null,
      filename: f.fileName,
      friendlyName: null,
      friendlyNameI18n: null,
      status: 'not-in-catalog',
      sizeBytes: f.sizeBytes,
      cached: false,
      onPen: true,
      availableActions: ['remove'],
    });
  }

  return items;
}
