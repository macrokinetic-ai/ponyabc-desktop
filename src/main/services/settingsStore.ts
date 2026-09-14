import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_LOCALE, isSupportedLocale, type SupportedLocale } from '@shared/locales';
import type { Settings } from '@shared/types';

function defaultSettings(seedLocale: SupportedLocale): Settings {
  return { version: 1, locale: seedLocale, lastPenRootPath: null, lastComputerFolderPath: null };
}

/**
 * Settings persistence, with the userData directory and system-locale detection injected
 * so this can be unit-tested without an Electron runtime.
 */
export function createSettingsStore(
  userDataDir: string,
  detectSystemLocale: () => SupportedLocale,
) {
  const filePath = path.join(userDataDir, 'settings.json');
  let cache: Settings | null = null;

  function load(): Settings {
    if (cache) return cache;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<Settings>;
      // A previously persisted locale always wins over system-locale auto-detection —
      // auto-detect only ever seeds the file the first time it's created, below.
      cache = {
        version: 1,
        locale: isSupportedLocale(parsed.locale) ? parsed.locale : DEFAULT_LOCALE,
        lastPenRootPath: typeof parsed.lastPenRootPath === 'string' ? parsed.lastPenRootPath : null,
        lastComputerFolderPath: typeof parsed.lastComputerFolderPath === 'string' ? parsed.lastComputerFolderPath : null,
      };
    } catch {
      cache = defaultSettings(detectSystemLocale());
      persist(cache);
    }
    return cache;
  }

  function persist(settings: Settings): void {
    fs.mkdirSync(userDataDir, { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(settings, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  function get(): Settings {
    return load();
  }

  function update(partial: Partial<Pick<Settings, 'locale' | 'lastPenRootPath' | 'lastComputerFolderPath'>>): Settings {
    const current = load();
    const next: Settings = {
      ...current,
      ...(partial.locale !== undefined && isSupportedLocale(partial.locale) ? { locale: partial.locale } : {}),
      ...(partial.lastPenRootPath !== undefined ? { lastPenRootPath: partial.lastPenRootPath } : {}),
      ...(partial.lastComputerFolderPath !== undefined ? { lastComputerFolderPath: partial.lastComputerFolderPath } : {}),
    };
    cache = next;
    persist(next);
    return next;
  }

  return { get, update };
}

export type SettingsStore = ReturnType<typeof createSettingsStore>;
