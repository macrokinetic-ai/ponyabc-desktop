const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;
/** Tolerates small clock skew between this machine and the server so a just-updated item
 *  doesn't flicker false due to a few seconds/minutes of drift — anything beyond this is
 *  treated as a bogus future timestamp, not "new". */
const FUTURE_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * True only when the server's own updatedAtMs falls within the last 14 days of `nowMs`.
 * Never guesses: a missing/invalid timestamp (null) always returns false. Deliberately takes
 * `nowMs` as a parameter rather than reading the clock itself, so callers recompute this at
 * render time against the real current wall clock — this is what makes the badge disappear on
 * its own once 14 real days pass, even while working entirely from an offline-cached
 * timestamp, with no server re-fetch required.
 */
export function isRecentlyUpdated(updatedAtMs: number | null, nowMs: number): boolean {
  if (updatedAtMs === null || !Number.isFinite(updatedAtMs)) return false;
  const age = nowMs - updatedAtMs;
  return age > -FUTURE_SKEW_TOLERANCE_MS && age <= FOURTEEN_DAYS_MS;
}
