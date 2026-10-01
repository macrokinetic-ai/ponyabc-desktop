/**
 * The Internal-only surface, as the STORE build sees it: nothing.
 *
 * `electron.vite.config.ts` aliases `@internal` to this file unless PONYABC_INTERNAL=1, so a
 * Store build does not import the demonstration catalogue, the testing mode, the vendor-package
 * picker or a single one of the developer environment switches — their names do not appear in
 * the bundle at all. That is stronger than a runtime guard, which ships the code and decides
 * not to run it.
 *
 * Every export here must match ./index.ts exactly, or the Store build will not compile — which
 * is the point: the two cannot drift apart silently.
 */
import type { BookActionResult, BookListResult, FirmwarePackageInfo, FirmwareUpgradeOutcome, TechnicalLogEntry } from '@shared/types';

export const INTERNAL_BUILD = false;

/* -- the demonstration catalogue, for screenshots and the manual -- */
export const demoDataEnabled = (): boolean => false;
export const demoBookList = (): BookListResult | null => null;
export const demoInstallResult = (): BookActionResult | null => null;

/* -- the firmware demonstration path -- */
export const demoFirmwareEnabled = (): boolean => false;
export const demoFirmwarePackage = (): FirmwarePackageInfo | null => null;
export const demoFirmwareOutcome = (): FirmwareUpgradeOutcome | null => null;

/* -- testing mode -- */
export interface TestingModeSettings {
  enabled: boolean;
  testCatalogueFolder: string | null;
  testerKey: string | null;
}
export const getTestingMode = (): TestingModeSettings => ({
  enabled: false,
  testCatalogueFolder: null,
  testerKey: null,
});
export const setTestingMode = (_patch?: unknown): TestingModeSettings => getTestingMode();
export const testerKeyForRequests = (): string | null => null;
export const testCatalogueFolder = (): string | null => null;

/* -- developer environment switches -- */
export const localeOverride = (): string | undefined => undefined;
export const volumesRootOverride = (): string | undefined => undefined;
export const computerFolderOverride = (): string | undefined => undefined;
export const runMsixFirmwareProbeIfRequested = async (): Promise<boolean> => false;

/* -- support tools -- */
/** No dialog, no title string, nothing. */
export const pickFirmwareFolder = async (_window: unknown): Promise<string | null> => null;

/** Empty, so the header's name does not appear in a Store bundle and cannot be sent. */
export const TESTER_KEY_HEADER = '';

/** No dialog in a Store build. */
export const chooseTestCatalogueFolder = async (_window: unknown): Promise<string | null> => null;

/* -- the technical log -- */
// Nothing is recorded and nothing is kept: the calls scattered through the book and firmware
// code compile down to an empty function, and the Store build has no panel to show it in.
export const onTechnicalLogEntry = (_listener: ((entry: TechnicalLogEntry) => void) | null): void => {};
export const technical = (_kind: TechnicalLogEntry['kind'], _detail: string, _sizeBytes?: number): void => {};
export const technicalLogEntries = (): TechnicalLogEntry[] => [];
export const clearTechnicalLog = (): void => {};
