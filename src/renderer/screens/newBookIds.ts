/**
 * Which books are new **to this parent, on this computer**.
 *
 * "New" here does not mean "recently published" — that was the old badge, driven by the
 * catalogue's `updatedAtMs`, and it told a parent something about our release schedule rather
 * than about them. This one means: *you have not seen this book in the list before.*
 *
 * So it is per computer, stored locally, and it clears itself. A book is new exactly once: the
 * first time the list is shown with it in the catalogue. Open the screen again and it is an
 * ordinary book.
 *
 * `localStorage` is the right home for it — it is a per-viewer convenience, it never needs to
 * reach the pen or another machine, and losing it is harmless (every book simply looks new once
 * more). Every access is wrapped, because storage can be unavailable or throw.
 */

const STORAGE_KEY = 'ponyabc.book.seenCatalogIds.v1';

/** Cap so a long-lived install cannot grow this without bound. Far above any plausible catalogue. */
const MAX_REMEMBERED = 5_000;

export function readSeenIds(storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed.filter((v): v is string => typeof v === 'string')) : new Set();
  } catch {
    return new Set();
  }
}

export function writeSeenIds(ids: Iterable<string>, storage: Pick<Storage, 'getItem' | 'setItem'> | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify([...ids].slice(-MAX_REMEMBERED)));
  } catch {
    // Private window, blocked site data, quota — the badge is a nicety, never a failure.
  }
}

/**
 * The ids to badge, and the set to remember afterwards.
 *
 * On a **first** run there is nothing remembered, and badging all 37 books would be noise
 * dressed up as news — so the first sighting of a catalogue marks everything seen and badges
 * nothing. After that, only genuinely new arrivals are badged.
 */
export function computeNewIds(catalogIds: readonly string[], seen: Set<string>): { newIds: Set<string>; nextSeen: Set<string> } {
  const nextSeen = new Set([...seen, ...catalogIds]);
  if (seen.size === 0) return { newIds: new Set(), nextSeen };
  return { newIds: new Set(catalogIds.filter((id) => !seen.has(id))), nextSeen };
}

function safeStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
