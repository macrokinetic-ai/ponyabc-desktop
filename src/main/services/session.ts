import fs from 'node:fs';
import type { ResolvedPenRoot } from './pathSecurity';
import type { VolumeCandidate } from './volumeDiscovery';

/**
 * In-memory, main-process-only trusted state. A pen root or computer folder is only ever
 * stored here after resolving it through pathSecurity.ts, starting from a native dialog
 * result, an auto-detected volume scan, or a previously persisted+re-validated path. IPC
 * handlers never accept a raw path from the renderer as "the current pen"/"the current
 * computer folder" — writes are always checked against this session state fresh.
 */
let currentPenRoot: ResolvedPenRoot | null = null;
let currentIdentityKey: string | null = null;
let generation = 0;

let currentComputerFolder: string | null = null;
let lastVolumeCandidates: VolumeCandidate[] = [];

function statDev(p: string): number | null {
  try {
    return fs.statSync(p).dev;
  } catch {
    return null;
  }
}

/** Identity = mount path + device id, so a *different* card remounted at the same path
 *  (e.g. another pen plugged into the same USB port) is detected as a change, not reused. */
function identityKeyFor(root: ResolvedPenRoot | null): string | null {
  if (!root) return null;
  return `${root.realPath}#${statDev(root.realPath) ?? 'unknown'}`;
}

export function getPenRoot(): ResolvedPenRoot | null {
  return currentPenRoot;
}

export function getGeneration(): number {
  return generation;
}

/**
 * Sets the current pen root. Bumps `generation` whenever the effective device identity
 * changes (including connect, disconnect, and switching to a different card) — never on a
 * no-op refresh of the same still-connected pen. Callers that detect a disconnect MUST call
 * this with `null` immediately, so pending plans/decisions are invalidated right away rather
 * than only at the next successful reconnect.
 */
export function setPenRoot(root: ResolvedPenRoot | null): { generation: number; changed: boolean } {
  const nextKey = identityKeyFor(root);
  const changed = nextKey !== currentIdentityKey;
  currentPenRoot = root;
  currentIdentityKey = nextKey;
  if (changed) generation += 1;
  return { generation, changed };
}

export function getComputerFolder(): string | null {
  return currentComputerFolder;
}

export function setComputerFolder(realPath: string | null): void {
  currentComputerFolder = realPath;
}

export function getLastVolumeCandidates(): VolumeCandidate[] {
  return lastVolumeCandidates;
}

export function setLastVolumeCandidates(candidates: VolumeCandidate[]): void {
  lastVolumeCandidates = candidates;
}
