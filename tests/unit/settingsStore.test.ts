import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSettingsStore } from '../../src/main/services/settingsStore';

let userDataDir: string;

beforeEach(() => {
  userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-userdata-'));
});

afterEach(() => {
  fs.rmSync(userDataDir, { recursive: true, force: true });
});

describe('createSettingsStore', () => {
  it('seeds locale from system detection on first run only', () => {
    const store = createSettingsStore(userDataDir, () => 'fr');
    expect(store.get().locale).toBe('fr');
  });

  it('an already-persisted locale always wins over system detection on later loads', () => {
    const first = createSettingsStore(userDataDir, () => 'fr');
    first.get(); // creates settings.json seeded with 'fr'
    first.update({ locale: 'de' }); // user explicitly picked German in Settings

    // Simulate a fresh app launch with a *different* detected system locale ('es').
    const relaunched = createSettingsStore(userDataDir, () => 'es');
    expect(relaunched.get().locale).toBe('de');
  });

  it('persists lastPenRootPath across store instances', () => {
    const first = createSettingsStore(userDataDir, () => 'en');
    first.update({ lastPenRootPath: '/Volumes/PONYABC' });

    const second = createSettingsStore(userDataDir, () => 'en');
    expect(second.get().lastPenRootPath).toBe('/Volumes/PONYABC');
  });

  it('falls back to defaults on a corrupt settings file rather than throwing', () => {
    fs.mkdirSync(userDataDir, { recursive: true });
    fs.writeFileSync(path.join(userDataDir, 'settings.json'), '{not json');
    const store = createSettingsStore(userDataDir, () => 'it');
    expect(store.get()).toEqual({ version: 1, locale: 'it', lastPenRootPath: null });
  });
});
