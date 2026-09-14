/** Parses "1.2.3", "v1.2.3", etc. into [major, minor, patch]. Non-numeric/missing parts
 *  read as 0 rather than throwing — version strings from a remote API should never crash
 *  the comparison, just compare as harmlessly as possible. */
function parse(version: string): [number, number, number] {
  const cleaned = version.trim().replace(/^v/i, '');
  const parts = cleaned.split('.').map((p) => {
    const n = parseInt(p, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** Returns true if `remote` is a strictly newer version than `current` (major.minor.patch). */
export function isNewerVersion(remote: string, current: string): boolean {
  const [rMajor, rMinor, rPatch] = parse(remote);
  const [cMajor, cMinor, cPatch] = parse(current);
  if (rMajor !== cMajor) return rMajor > cMajor;
  if (rMinor !== cMinor) return rMinor > cMinor;
  return rPatch > cPatch;
}
