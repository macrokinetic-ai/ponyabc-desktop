/**
 * The Internal-only surface, as the INTERNAL build sees it.
 *
 * Everything a tester or the owner needs and a customer must never have: the demonstration
 * catalogue behind the manual's screenshots, the firmware demonstration path, testing mode with
 * its local test catalogue and tester key, the developer environment switches, and the
 * by-hand vendor-package picker.
 *
 * `./stub.ts` is what the Store build gets instead, and it exports the same names doing
 * nothing. If an export is added here and not there, the Store build fails to compile.
 */
import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import type { BookActionResult, BookListResult, FirmwarePackageInfo, FirmwareUpgradeOutcome } from '@shared/types';
import { demoBookList as buildDemoBookList, demoDataEnabled as demoOn, demoVariant, markDemoSyncComplete } from '../services/demoBookData';
import {
  demoFirmwareEnabled as fwOn,
  demoFirmwareOutcome as fwOutcome,
  demoFirmwarePackage as fwPackage,
} from '../services/demoFirmware';
import { markBookIndexStale } from '../ipc/bookIndex';
import { runMsixFirmwarePlumbingProbe } from '../services/msixFirmwarePlumbingProbe';

export const INTERNAL_BUILD = true;

export const demoDataEnabled = (): boolean => demoOn();
export const demoBookList = (): BookListResult | null => (demoOn() ? buildDemoBookList(demoVariant()) : null);

/** A demo sync completes without a network or a write, and reports what a real one reports. */
export const demoInstallResult = (): BookActionResult | null => {
  if (!demoOn()) return null;
  markDemoSyncComplete();
  markBookIndexStale('written');
  return { status: 'completed', createdNewFile: true };
};

export const demoFirmwareEnabled = (): boolean => fwOn();
export const demoFirmwarePackage = (): FirmwarePackageInfo | null => (fwOn() ? fwPackage() : null);
export const demoFirmwareOutcome = (): FirmwareUpgradeOutcome | null => (fwOn() ? fwOutcome() : null);

export {
  getTestingMode,
  setTestingMode,
  testerKeyForRequests,
  testCatalogueFolder,
  type TestingModeSettings,
} from '../services/testingMode';

export const localeOverride = (): string | undefined => process.env.PONYABC_LOCALE;
export const volumesRootOverride = (): string | undefined => process.env.PONYABC_TEST_VOLUMES_ROOT;
export const computerFolderOverride = (): string | undefined => process.env.PONYABC_TEST_COMPUTER_FOLDER;
/**
 * The MSIX firmware-plumbing probe: a CI smoke test that runs the wizard's plumbing against a
 * harmless stand-in inside a real installed package, writes what it found, and quits. It never
 * touches a pen or a vendor tool. Returns true when it ran, so the caller stops there.
 */
export async function runMsixFirmwareProbeIfRequested(): Promise<boolean> {
  if (process.env.PONYABC_MSIX_FIRMWARE_PROBE !== '1') return false;
  const outputPath = process.env.PONYABC_MSIX_FIRMWARE_PROBE_OUTPUT;
  if (!outputPath) throw new Error('PONYABC_MSIX_FIRMWARE_PROBE_OUTPUT must be set alongside the probe flag');
  let result: unknown;
  try {
    result = await runMsixFirmwarePlumbingProbe();
  } catch (err) {
    result = { probeThrew: err instanceof Error ? err.message : String(err) };
  }
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2), 'utf-8');
  app.quit();
  return true;
}

/**
 * Pick an extracted vendor firmware folder by hand.
 *
 * Support only: it points the vendor's unsigned flasher at whatever folder someone chooses.
 * The Store build has no such dialog — not a disabled one, none.
 */
export async function pickFirmwareFolder(window: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, {
    properties: ['openDirectory'],
    title: 'Select the extracted firmware package folder (the one containing download.bat)',
  });
  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

/** The tester channel's header. Named here so a Store bundle does not contain it at all. */
export const TESTER_KEY_HEADER = 'X-PonyABC-Tester-Key';

/** Choose the local test-catalogue folder. */
export async function chooseTestCatalogueFolder(window: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(window, {
    properties: ['openDirectory'],
    title: 'Choose the test catalogue folder (the one holding manifest.json)',
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  setTestingModeFolder(result.filePaths[0]);
  return result.filePaths[0];
}

function setTestingModeFolder(folder: string): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require('../services/testingMode') as typeof import('../services/testingMode');
  mod.setTestingMode({ testCatalogueFolder: folder });
}
