import fs from 'node:fs';
import path from 'node:path';
import { isEligibleMp3FileName } from './pathSecurity';
import { sha256File } from './transferService';
import { createSnapshotFromFiles, type CreateSnapshotResult } from './recordingSnapshot';

/**
 * Migrating the backups made before snapshots existed.
 *
 * Those folders hold `0451.mp3` next to `0451 (1).mp3`, because saving to the computer renamed a
 * file rather than overwriting one. The `(1)` copy is currently unusable: the pen identifies a
 * recording by its filename, so nothing on the pen answers to `0451 (1)`.
 *
 * What this must never do is pick one of them automatically when they genuinely differ. A silent
 * automatic choice is what created this mess; the two files may be two different takes, and only
 * the person who recorded them knows which is which. So: resolve the duplicates, ask about the
 * rest, and **never delete the original folder** — migration only ever adds.
 */

export interface LegacyCandidate {
  /** The name on disk, e.g. `0451 (1).mp3`. */
  fileName: string;
  sourcePath: string;
  sizeBytes: number;
  mtimeMs: number;
  sha256: string;
  /** The `(N)` that was appended, or null for the original. */
  suffix: number | null;
}

export interface LegacyGroup {
  /** The name this recording must be restored as, e.g. `0451.mp3`. */
  fileName: string;
  candidates: LegacyCandidate[];
  /**
   * `duplicate` — every candidate is byte-identical, so there is nothing to choose and we say
   * so. `differs` — genuinely different takes; the user must pick.
   */
  resolution: 'duplicate' | 'differs';
}

export interface LegacyScan {
  /** Recordings that were saved more than once. */
  groups: LegacyGroup[];
  /** Ordinary recordings with no `(N)` twin — carried across as they are. */
  single: LegacyCandidate[];
  /** How many files carried a `(N)` suffix, i.e. how many were unusable before this. */
  renamedCount: number;
}

const LEGACY_SUFFIX = /^(.*) \((\d+)\)$/;

/** Splits `0451 (1).mp3` into its real name and its suffix. */
export function parseLegacyName(fileName: string): { baseFileName: string; suffix: number | null } {
  const ext = path.extname(fileName);
  const stem = path.basename(fileName, ext);
  const match = LEGACY_SUFFIX.exec(stem);
  if (!match) return { baseFileName: fileName, suffix: null };
  return { baseFileName: `${match[1]}${ext}`, suffix: Number(match[2]) };
}

/** Reads a pre-snapshot backup folder and works out what is duplicated and what is not. */
export async function scanLegacyBackups(folder: string): Promise<LegacyScan> {
  let names: string[] = [];
  try {
    names = fs.readdirSync(folder).filter(isEligibleMp3FileName).sort();
  } catch {
    return { groups: [], single: [], renamedCount: 0 };
  }

  const byBase = new Map<string, LegacyCandidate[]>();
  let renamedCount = 0;

  for (const fileName of names) {
    const sourcePath = path.join(folder, fileName);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(sourcePath);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    const { baseFileName, suffix } = parseLegacyName(fileName);
    if (suffix !== null) renamedCount += 1;

    let sha256: string;
    try {
      sha256 = await sha256File(sourcePath);
    } catch {
      continue;
    }

    const key = baseFileName.toLowerCase();
    const list = byBase.get(key) ?? [];
    list.push({ fileName, sourcePath, sizeBytes: stat.size, mtimeMs: stat.mtimeMs, sha256, suffix });
    byBase.set(key, list);
  }

  const groups: LegacyGroup[] = [];
  const single: LegacyCandidate[] = [];

  for (const candidates of byBase.values()) {
    // Oldest first, and the un-suffixed original ahead of its copies — the order the user made
    // them, which is the order they will recognise.
    candidates.sort((a, b) => (a.suffix ?? -1) - (b.suffix ?? -1));
    const baseFileName = parseLegacyName(candidates[0].fileName).baseFileName;

    if (candidates.length === 1) {
      single.push({ ...candidates[0], fileName: baseFileName });
      continue;
    }
    const allSame = candidates.every((c) => c.sha256 === candidates[0].sha256);
    groups.push({ fileName: baseFileName, candidates, resolution: allSame ? 'duplicate' : 'differs' });
  }

  groups.sort((a, b) => a.fileName.localeCompare(b.fileName));
  single.sort((a, b) => a.fileName.localeCompare(b.fileName));
  return { groups, single, renamedCount };
}

export type MigrationResult =
  | { status: 'needs-choices'; undecided: string[] }
  | ({ status: 'ok' } & CreateSnapshotResult);

/**
 * Writes the chosen files into a proper snapshot, under their real names.
 *
 * `choices` maps a group's `fileName` to the on-disk `fileName` of the candidate to keep. A
 * `duplicate` group needs no choice — its candidates are identical, so any of them is the same
 * bytes. A `differs` group without a choice stops the migration rather than guessing.
 *
 * The source folder is never modified or deleted. The user can clear it out themselves once
 * they are satisfied.
 */
export async function migrateLegacyBackups(params: {
  scan: LegacyScan;
  choices: Record<string, string>;
  backupRootDir: string;
  penVolumeLabel: string | null;
  now?: Date;
}): Promise<MigrationResult> {
  const { scan, choices, backupRootDir, penVolumeLabel, now } = params;

  const undecided = scan.groups.filter((g) => g.resolution === 'differs' && !choices[g.fileName]).map((g) => g.fileName);
  if (undecided.length > 0) return { status: 'needs-choices', undecided };

  const files: Array<{ fileName: string; sourcePath: string }> = scan.single.map((c) => ({ fileName: c.fileName, sourcePath: c.sourcePath }));

  for (const group of scan.groups) {
    const chosenName = choices[group.fileName];
    const chosen = chosenName ? group.candidates.find((c) => c.fileName === chosenName) : group.candidates[0];
    if (!chosen) return { status: 'needs-choices', undecided: [group.fileName] };
    files.push({ fileName: group.fileName, sourcePath: chosen.sourcePath });
  }

  files.sort((a, b) => a.fileName.localeCompare(b.fileName));
  const result = await createSnapshotFromFiles({ files, backupRootDir, penVolumeLabel, now, reason: 'migration' });
  return { ...result, status: 'ok' };
}
