import path from 'node:path';
import { app } from 'electron';
import { IS_INTERNAL_BUILD } from '@shared/buildFlavour';
import { createJsonStore } from './bookStore';

/**
 * Testing mode — the Internal build only.
 *
 * Two sources of test content, both of which go through exactly the same sync code as the real
 * catalogue, because a test that takes a different path tests the path nobody ships:
 *
 *   1. a local test-catalogue folder: .axb files and firmware packages beside a manifest.json
 *      with the same field names the server sends;
 *   2. the server's tester channel: a key the owner types in once, sent as X-PonyABC-Tester-Key,
 *      which makes the server include its hidden items.
 *
 * Every function here returns the "off" answer in a Store build, and the whole module's state
 * is unreachable from one: `IS_INTERNAL_BUILD` is a build-time literal, so these guards are
 * removed rather than evaluated.
 */

export interface TestingModeSettings {
  enabled: boolean;
  /** A folder holding manifest.json, .axb files and firmware packages. */
  testCatalogueFolder: string | null;
  /** The server tester key. Stored locally, never shipped, never in a Store build. */
  testerKey: string | null;
}

const OFF: TestingModeSettings = { enabled: false, testCatalogueFolder: null, testerKey: null };

let store: ReturnType<typeof createJsonStore<TestingModeSettings>> | null = null;
function settingsStore() {
  store ??= createJsonStore<TestingModeSettings>(
    path.join(app.getPath('userData'), 'testingMode.json'),
    () => ({ ...OFF }),
  );
  return store;
}

export function getTestingMode(): TestingModeSettings {
  if (!IS_INTERNAL_BUILD) return { ...OFF };
  return settingsStore().get();
}

export function setTestingMode(partial: Partial<TestingModeSettings>): TestingModeSettings {
  if (!IS_INTERNAL_BUILD) return { ...OFF };
  const next = { ...settingsStore().get(), ...partial };
  settingsStore().set(next);
  return next;
}

/**
 * The tester key to send with catalogue requests, or null.
 *
 * Null in a Store build, always — the header is never sent, and the key is never stored. Null
 * too when testing mode is off, so turning it off really does stop the hidden items arriving.
 */
export function testerKeyForRequests(): string | null {
  if (!IS_INTERNAL_BUILD) return null;
  const { enabled, testerKey } = getTestingMode();
  return enabled && testerKey ? testerKey : null;
}

/** The local test-catalogue folder, or null when there is none to read. */
export function testCatalogueFolder(): string | null {
  if (!IS_INTERNAL_BUILD) return null;
  const { enabled, testCatalogueFolder: folder } = getTestingMode();
  return enabled ? folder : null;
}
