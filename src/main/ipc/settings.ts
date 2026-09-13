import { isSupportedLocale } from '@shared/locales';
import type { Settings } from '@shared/types';
import type { SettingsStore } from '../services/settingsStore';

export function getSettings(store: SettingsStore): Settings {
  return store.get();
}

export function setSettings(store: SettingsStore, partial: unknown): Settings {
  const locale =
    partial && typeof partial === 'object' && 'locale' in partial && isSupportedLocale((partial as { locale: unknown }).locale)
      ? (partial as { locale: Settings['locale'] }).locale
      : undefined;
  return store.update(locale ? { locale } : {});
}
