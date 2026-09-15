/**
 * A firmware upgrade is exclusive — only one at a time, and it must not silently let a second
 * attempt (or a BOOK/DIY pen write, via the shared `acquirePenLock()`) start while a prior
 * flash's outcome is still "unclear" (see FirmwareUpgradeOutcome). Deliberately NOT the same
 * mutex as `penOperationLock.ts`'s brief-per-write lock: this flag is held for the entire
 * upgrade AND, for an unclear result, until the user explicitly acknowledges it — a plain
 * queueing mutex would let a second attempt silently start the moment the first "finishes"
 * (including finishing ambiguously), which is exactly what must not happen here.
 */
let inProgress = false;

export function isFirmwareUpgradeInProgress(): boolean {
  return inProgress;
}

/** Returns false (and changes nothing) if an upgrade is already in progress. */
export function tryBeginFirmwareUpgrade(): boolean {
  if (inProgress) return false;
  inProgress = true;
  return true;
}

export function endFirmwareUpgrade(): void {
  inProgress = false;
}
