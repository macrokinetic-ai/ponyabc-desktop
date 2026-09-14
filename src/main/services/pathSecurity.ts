import fs from 'node:fs';
import path from 'node:path';

/**
 * All filesystem trust decisions for this app live here. The rule: a path is only ever
 * treated as "the pen" or "the destination" if it was just resolved through one of these
 * functions, starting from a path the OS's own native picker returned (or a previously
 * persisted+re-validated one). Renderer-supplied strings are never trusted directly.
 */

export interface ResolvedPenRoot {
  status: 'ok';
  /** Canonicalized (symlink-resolved) absolute path to the selected root. */
  realPath: string;
  /** Actual on-disk casing of the BOOK folder, e.g. "BOOK" or "book". */
  bookDirName: string;
  bookDirReal: string;
  /** Actual on-disk casing of the DIY folder. */
  diyDirName: string;
  diyDirReal: string;
}

export type PenRootResolution =
  | ResolvedPenRoot
  | { status: 'not-found'; path: string }
  | { status: 'invalid'; path: string; missing: Array<'BOOK' | 'DIY'> };

function isUsableDirectory(fullPath: string, dirent: fs.Dirent): boolean {
  if (dirent.isDirectory()) return true;
  if (dirent.isSymbolicLink()) {
    try {
      return fs.statSync(fullPath).isDirectory();
    } catch {
      return false;
    }
  }
  return false;
}

/** Resolves `realPath/name` and confirms the result did not escape (via symlink) outside `realPath`. */
function resolveContained(realPath: string, name: string): string | null {
  const candidate = path.join(realPath, name);
  let real: string;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return null;
  }
  if (real === realPath || real.startsWith(realPath + path.sep)) return real;
  return null; // symlink escape — reject
}

export function resolvePenRoot(selectedPath: string): PenRootResolution {
  let realPath: string;
  try {
    realPath = fs.realpathSync(selectedPath);
  } catch {
    return { status: 'not-found', path: selectedPath };
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(realPath, { withFileTypes: true });
  } catch {
    return { status: 'not-found', path: selectedPath };
  }

  let bookDirName: string | undefined;
  let diyDirName: string | undefined;
  for (const entry of entries) {
    const full = path.join(realPath, entry.name);
    const lower = entry.name.toLowerCase();
    if (lower === 'book' && !bookDirName && isUsableDirectory(full, entry)) bookDirName = entry.name;
    if (lower === 'diy' && !diyDirName && isUsableDirectory(full, entry)) diyDirName = entry.name;
  }

  const missing: Array<'BOOK' | 'DIY'> = [];
  let bookDirReal: string | null = null;
  let diyDirReal: string | null = null;

  if (!bookDirName) {
    missing.push('BOOK');
  } else {
    bookDirReal = resolveContained(realPath, bookDirName);
    if (!bookDirReal) missing.push('BOOK'); // symlink escapes outside root: treat as unusable
  }

  if (!diyDirName) {
    missing.push('DIY');
  } else {
    diyDirReal = resolveContained(realPath, diyDirName);
    if (!diyDirReal) missing.push('DIY');
  }

  if (missing.length > 0 || !bookDirName || !diyDirName || !bookDirReal || !diyDirReal) {
    return { status: 'invalid', path: realPath, missing };
  }

  return { status: 'ok', realPath, bookDirName, bookDirReal, diyDirName, diyDirReal };
}

export type DestinationResolution =
  | { status: 'ok'; realPath: string }
  | { status: 'not-found'; path: string }
  | { status: 'not-a-directory'; path: string }
  | { status: 'on-pen'; path: string };

/** Confirms `chosenPath` is a real directory that is not the pen root (or any subfolder of it). */
export function resolveDestination(chosenPath: string, penRootRealPath: string | null): DestinationResolution {
  let realPath: string;
  try {
    realPath = fs.realpathSync(chosenPath);
  } catch {
    return { status: 'not-found', path: chosenPath };
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(realPath);
  } catch {
    return { status: 'not-found', path: chosenPath };
  }
  if (!stat.isDirectory()) return { status: 'not-a-directory', path: chosenPath };

  if (penRootRealPath && (realPath === penRootRealPath || realPath.startsWith(penRootRealPath + path.sep))) {
    return { status: 'on-pen', path: realPath };
  }

  return { status: 'ok', realPath };
}

export type SourceFileResolution =
  | { status: 'ok'; realPath: string }
  | { status: 'rejected' } // traversal attempt or symlink escape
  | { status: 'not-found' };

/**
 * Resolves a single file the renderer asked to touch, by name only, against an already-
 * security-resolved directory. Rejects anything that isn't a plain filename (no path
 * separators / traversal), and rejects a file whose resolved real location (after
 * following symlinks) is not directly inside `dirReal`. Used for both the pen's DIY
 * folder and the authorized computer folder — the boundary being enforced is "stays
 * inside this specific directory", not anything pen-specific.
 */
export function resolveContainedFile(dirReal: string, fileName: string): SourceFileResolution {
  if (!fileName || fileName !== path.basename(fileName) || fileName === '.' || fileName === '..') {
    return { status: 'rejected' };
  }
  const candidate = path.join(dirReal, fileName);
  let real: string;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return { status: 'not-found' };
  }
  if (path.dirname(real) !== dirReal) return { status: 'rejected' };
  return { status: 'ok', realPath: real };
}

/** @deprecated kept as an alias for readability at DIY-specific call sites and existing tests. */
export const resolveDiySourceFile = resolveContainedFile;

/**
 * True for a name that is eligible to be treated as a DIY recording anywhere in this app:
 * a plain ".mp3" file (any case) that is not a macOS AppleDouble sidecar file. macOS writes
 * a "._name.mp3" companion for every "name.mp3" it copies onto a non-HFS/APFS volume (which
 * every SD card is) — these are metadata, not audio, and must never be listed, copied, sent,
 * or offered as a replacement source. This is checked both when listing a folder and again
 * at every transfer entry point, independently of the listing.
 */
export function isEligibleMp3FileName(name: string): boolean {
  return !name.startsWith('._') && /\.mp3$/i.test(name);
}

/**
 * Resolves a user-selected folder as a pen root, tolerating the user having picked the
 * BOOK or DIY folder itself instead of its parent — in that case the parent is checked
 * as the actual root.
 */
export function resolvePenRootFromSelection(selectedPath: string): PenRootResolution {
  const direct = resolvePenRoot(selectedPath);
  if (direct.status === 'ok') return direct;

  const base = path.basename(selectedPath).toLowerCase();
  if (base === 'book' || base === 'diy') {
    const parent = path.dirname(selectedPath);
    if (parent !== selectedPath) {
      const parentResult = resolvePenRoot(parent);
      if (parentResult.status === 'ok') return parentResult;
    }
  }
  return direct;
}
