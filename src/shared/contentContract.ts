/**
 * The contract with `ponyabc-web`, written down once so both sides cannot drift.
 *
 * Every name here is the server's own, from `ponyabc-web`'s
 * `src/lib/content/visibility.ts` and its `/api/public/books` response: the field is `state`,
 * the request headers are spelled as below, and a per-item minimum is `minAppVersion` in the
 * response (`min_app_version` in the database). `tests/unit/webContract.test.ts` checks this
 * file against response examples taken from that branch.
 */
import type { ContentState } from './types';

export const APP_VERSION_HEADER = 'X-PonyABC-App-Version';
// The tester header's name lives in src/main/internal/, not here: a Store bundle must not even
// contain the string. See that module, and tests/unit/storeBuildHasNoDevPaths.test.ts.

/** The first app version the server will tell about states, retirement and firmware. */
export const STATES_AWARE_VERSION = '0.3.17';

export const CONTENT_STATES: readonly ContentState[] = ['active', 'retired', 'remove_from_pens', 'hidden'];

/** Dotted numeric comparison. An unparseable or missing version sorts lowest, which fails safe:
 *  the app decides it is older than any requirement rather than newer. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => (v.trim().match(/^\d+(\.\d+)*/)?.[0] ?? '').split('.').filter(Boolean).map(Number);
  const left = parse(a);
  const right = parse(b);
  if (left.length === 0) return right.length === 0 ? 0 : -1;
  if (right.length === 0) return 1;
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Whether this build may act on an item at all.
 *
 * The server already filters by the version we send. This is the second guard, on our side:
 * if a server ever sends an item whose minimum is above us — a mistake, an old cache, a
 * hand-edited row — we still refuse it. A book we cannot honour is better skipped than
 * half-handled, and a firmware we cannot honour would flash a pen wrongly.
 */
export function meetsMinimumVersion(minAppVersion: string | null | undefined, ourVersion: string): boolean {
  if (!minAppVersion) return true;
  return compareVersions(ourVersion, minAppVersion) >= 0;
}
