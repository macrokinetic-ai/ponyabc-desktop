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
 * Resolves a single DIY file the renderer asked to copy, by name only. Rejects anything
 * that isn't a plain filename (no path separators / traversal), and rejects a file whose
 * resolved real location (after following symlinks) is not directly inside `diyDirReal`.
 */
export function resolveDiySourceFile(diyDirReal: string, fileName: string): SourceFileResolution {
  if (!fileName || fileName !== path.basename(fileName) || fileName === '.' || fileName === '..') {
    return { status: 'rejected' };
  }
  const candidate = path.join(diyDirReal, fileName);
  let real: string;
  try {
    real = fs.realpathSync(candidate);
  } catch {
    return { status: 'not-found' };
  }
  if (path.dirname(real) !== diyDirReal) return { status: 'rejected' };
  return { status: 'ok', realPath: real };
}
