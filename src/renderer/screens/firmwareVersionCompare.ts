import { isNewerVersion } from '@shared/semver';

export type VersionCompareResult = 'unknown' | 'up-to-date' | 'update-available' | 'on-pen-newer';

/**
 * Pure — never reads the pen or the network itself. `onPenVersion` is deliberately passed as
 * `null` everywhere in the shipped UI (see FirmwareScreen.tsx) because no reliable read-only
 * on-pen firmware version query exists in the vendor toolkit today — every scripted path traced
 * so far (see firmwareUpgrade.ts's REQUIRED_RELATIVE_FILES doc) is write-only. Only the
 * 'unknown' branch is reachable via the real app; the other three exist so the comparison is
 * ready the day a real on-pen version read becomes possible, and are exercised by this file's
 * own unit tests.
 */
export function compareOfficialToOnPen(onPenVersion: string | null, official: { version: string }): VersionCompareResult {
  if (onPenVersion === null) return 'unknown';
  if (isNewerVersion(official.version, onPenVersion)) return 'update-available';
  if (isNewerVersion(onPenVersion, official.version)) return 'on-pen-newer';
  return 'up-to-date';
}
