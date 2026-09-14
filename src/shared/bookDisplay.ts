import { DEFAULT_LOCALE, type SupportedLocale } from './locales';

export interface BookDisplayNameSource {
  friendlyName: string;
  friendlyNameI18n: Record<string, string> | null;
  filename: string;
}

/**
 * Computed at read time from the full retained friendlyNameI18n map — callable from both the
 * main process (building the initial list) and the renderer (recomputing instantly on a UI
 * language switch, with zero IPC/network activity, since the full map is already in memory).
 * Fallback chain: friendlyNameI18n[locale] -> [en] -> friendlyName -> filename.
 */
export function resolveBookDisplayName(source: BookDisplayNameSource, locale: SupportedLocale): string {
  const map = source.friendlyNameI18n;
  if (map) {
    const direct = map[locale];
    if (typeof direct === 'string' && direct.length > 0) return direct;
    const fallback = map[DEFAULT_LOCALE];
    if (typeof fallback === 'string' && fallback.length > 0) return fallback;
  }
  if (source.friendlyName) return source.friendlyName;
  return source.filename;
}
