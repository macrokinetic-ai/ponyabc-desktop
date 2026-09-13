import type { ResolvedPenRoot } from './pathSecurity';

/**
 * In-memory, main-process-only trusted state. A pen root or destination is only ever
 * stored here after resolving it through pathSecurity.ts, starting from a native dialog
 * result (or a persisted path re-validated the same way at startup). IPC handlers for
 * recordings operate against this state — they never accept a raw path from the renderer
 * as "the current pen" or "the current destination".
 */
let currentPenRoot: ResolvedPenRoot | null = null;
let currentDestinationRealPath: string | null = null;

export function getPenRoot(): ResolvedPenRoot | null {
  return currentPenRoot;
}

export function setPenRoot(root: ResolvedPenRoot | null): void {
  currentPenRoot = root;
  // Selecting a new (or clearing the) pen root invalidates any previously chosen
  // destination's on-pen check, so require re-choosing to be safe.
  currentDestinationRealPath = null;
}

export function getDestination(): string | null {
  return currentDestinationRealPath;
}

export function setDestination(realPath: string | null): void {
  currentDestinationRealPath = realPath;
}
