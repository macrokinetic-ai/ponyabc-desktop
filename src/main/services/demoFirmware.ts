import { app } from 'electron';
import path from 'node:path';
import { IS_INTERNAL_BUILD } from '@shared/buildFlavour';
import type { FirmwarePackageInfo, FirmwareUpgradeOutcome } from '@shared/types';

/**
 * The firmware wizard's own screens, for the parent manual.
 *
 * The three screens a parent most needs a picture of — confirm, finished, and "the update did
 * not start" — cannot be photographed any other way: reaching them for real means flashing a
 * real pen with the vendor tool, which is exactly the thing nobody should do to take a picture.
 *
 * Two conditions must BOTH hold, so a shipped app can never show a firmware result it did not
 * really produce:
 *
 *  1. `PONYABC_DEMO_FIRMWARE` is set — nothing in a shipped build ever sets it; and
 *  2. the build is not packaged — a Store/installer build refuses this path outright,
 *     whatever its environment says.
 *
 * Nothing here launches a process, touches the pen, or runs the preflight deletions.
 */
export type DemoFirmwareOutcomeName = 'success' | 'not-started';

export function demoFirmwareEnabled(): boolean {
  // Three conditions now, and the first is decided when the bundle is built: a Store build
  // does not contain this path at all.
  return IS_INTERNAL_BUILD && !app.isPackaged && (process.env.PONYABC_DEMO_FIRMWARE ?? '') !== '';
}

/**
 * The package the Confirm screen describes.
 *
 * Reported as valid rather than inspected: a real vendor package is ~50 MB of firmware images
 * that has no business in a screenshot run, and a folder of empty stand-ins fails the real
 * validator by design. Nothing reads this folder — the demo start below never touches disk —
 * so the path is here only to be the one a parent would actually see.
 */
export function demoFirmwarePackage(): FirmwarePackageInfo {
  const rootDir = process.env.PONYABC_DEMO_FIRMWARE_DIR || path.join('C:\\Users\\PonyABC\\Downloads', 'P5-firmware-V1.26');
  return { rootDir, entryBatPath: path.join(rootDir, 'download.bat'), looksValid: true, missingFiles: [] };
}

export function demoFirmwareOutcome(): FirmwareUpgradeOutcome {
  const which: DemoFirmwareOutcomeName = process.env.PONYABC_DEMO_FIRMWARE === 'not-started' ? 'not-started' : 'success';

  const common = {
    exitCode: which === 'success' ? 0 : null,
    logExcerpt: '',
    encodingKnown: true,
    otaTableHadFailures: false,
    sawNoLicenseWarning: false,
  };

  if (which === 'not-started') {
    // The shape the real code produces when the pen's book index could not be backed up, so
    // nothing was deleted and no flash was ever attempted — see firmwarePreflight.ts.
    return {
      ...common,
      status: 'failed',
      reason: 'preflight-backup-failed',
      processTerminationConfirmed: true,
      sawUfwGenerated: false,
    };
  }

  return {
    ...common,
    status: 'success',
    reason: 'log-contains-download-success',
    processTerminationConfirmed: true,
    sawUfwGenerated: true,
  };
}
