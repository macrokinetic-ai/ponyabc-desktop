import { app } from 'electron';
import type { FirmwarePackageInfo, FirmwareUpgradeOutcome } from '@shared/types';
import { inspectFirmwarePackage } from './firmwareUpgrade';

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
  return !app.isPackaged && (process.env.PONYABC_DEMO_FIRMWARE ?? '') !== '';
}

/** The stand-in package folder to describe on the Confirm screen. Inspected with the REAL
 *  validator, so the screen shows a package that genuinely passed the app's own check. */
export function demoFirmwarePackage(): FirmwarePackageInfo {
  const dir = process.env.PONYABC_DEMO_FIRMWARE_DIR ?? '';
  return inspectFirmwarePackage(dir);
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
