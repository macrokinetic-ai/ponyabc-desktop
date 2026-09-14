import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolvePenRoot, type ResolvedPenRoot } from './pathSecurity';

/**
 * Roots to check for mounted external volumes, non-recursively. This never walks the whole
 * filesystem — on macOS it lists the single directory /Volumes (depth 1); on Windows it
 * probes drive letters directly (each a candidate itself, no further descent); each pen
 * candidate below is then confirmed by a single BOOK/DIY existence check at depth 1 of that
 * volume, never deeper.
 *
 * Overridable via PONYABC_TEST_VOLUMES_ROOT so simulated-folder tests (and the packaged-app
 * verification script) can exercise real candidate-detection logic without a physical device.
 */
function scanRoots(): string[] {
  const override = process.env.PONYABC_TEST_VOLUMES_ROOT;
  if (override) return [override];

  switch (process.platform) {
    case 'darwin':
      return fs.existsSync('/Volumes') ? ['/Volumes'] : [];
    case 'win32': {
      const letters = 'CDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
      return letters.map((l) => `${l}:\\`).filter((p) => fs.existsSync(p));
    }
    default: {
      // Not a target platform for this product; best-effort so dev-on-Linux doesn't crash.
      const candidates = [`/media/${os.userInfo().username}`, '/mnt'];
      return candidates.filter((p) => fs.existsSync(p));
    }
  }
}

/** On macOS/override roots, each entry under the root is itself a mounted volume to check.
 *  On Windows, each scanRoots() entry already IS a single drive — check it directly. */
function volumesUnder(root: string): string[] {
  if (process.platform === 'win32' && !process.env.PONYABC_TEST_VOLUMES_ROOT) return [root];
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() || e.isSymbolicLink())
      .map((e) => path.join(root, e.name));
  } catch {
    return [];
  }
}

export interface VolumeCandidate {
  /** The mounted volume's own directory name, exactly as the OS names it — never a
   *  hardcoded placeholder like "NO NAME"; an unlabeled FAT volume showing that name is the
   *  OS's own label, surfaced as-is. */
  volumeLabel: string;
  resolved: Extract<ResolvedPenRoot, { status: 'ok' }>;
}

/**
 * Scans currently-mounted external volumes for an accessible BOOK+DIY structure at their
 * top level. Bounded scan: one directory listing at the root, one BOOK/DIY check per volume
 * — never a recursive walk of the volume or the rest of the computer.
 */
export function scanForPenCandidates(): VolumeCandidate[] {
  const candidates: VolumeCandidate[] = [];
  for (const root of scanRoots()) {
    for (const volumePath of volumesUnder(root)) {
      const resolved = resolvePenRoot(volumePath);
      if (resolved.status === 'ok') {
        candidates.push({ volumeLabel: path.basename(volumePath), resolved });
      }
    }
  }
  return candidates;
}

/** Cheap fingerprint of what's currently mounted (names only, no BOOK/DIY check), used to
 *  detect "something about mounted volumes changed" without doing a full candidate scan. */
export function currentMountFingerprint(): string {
  const parts: string[] = [];
  for (const root of scanRoots()) {
    try {
      parts.push(`${root}:${fs.readdirSync(root).sort().join(',')}`);
    } catch {
      parts.push(`${root}:unavailable`);
    }
  }
  return parts.join('|');
}
