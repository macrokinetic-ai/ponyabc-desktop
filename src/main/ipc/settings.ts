import { isSupportedLocale } from '@shared/locales';
import * as internal from '@internal';
import type { Settings } from '@shared/types';
import type { SettingsStore } from '../services/settingsStore';

export function getSettings(store: SettingsStore): Settings {
  const settings = store.get();
  // Screenshots only: lets the capture script photograph the same screens in each language
  // without writing to the user's settings file. Never set in a shipped build.
  const override = internal.localeOverride();
  if (override && isSupportedLocale(override)) return { ...settings, locale: override };
  return settings;
}

export function setSettings(store: SettingsStore, partial: unknown): Settings {
  const locale =
    partial && typeof partial === 'object' && 'locale' in partial && isSupportedLocale((partial as { locale: unknown }).locale)
      ? (partial as { locale: Settings['locale'] }).locale
      : undefined;
  return store.update(locale ? { locale } : {});
}
