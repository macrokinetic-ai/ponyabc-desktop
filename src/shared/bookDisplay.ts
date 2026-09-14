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
 *
 * The BOOK catalog's translations are admin-entered on ponyabc-web using that site's own
 * `CONTENT_LANGUAGES` code set (`zh`, `en`, `yue`, `es`, `fr`, `de`, `it`, `pt`) — a single
 * generic `zh` key, deliberately with no `zh-Hant`/`zh-Hans` split (confirmed by reading
 * `ponyabc-web/src/lib/content/languages.ts`: script has no audio meaning, so the site never
 * captures a separate value per script). This app's own UI locale set DOES split Chinese into
 * `zh-Hant`/`zh-Hans`, so for either of those two locales the fallback chain also tries the
 * catalog's plain `zh` entry before giving up on Chinese entirely — otherwise a
 * zh-Hant/zh-Hans user would silently see the English name for every BOOK, which was
 * confirmed against the real live catalog, not assumed.
 *
 * Fallback chain: friendlyNameI18n[locale] -> (zh-Hant/zh-Hans only) [zh] -> [en] ->
 * friendlyName -> filename.
 */
export function resolveBookDisplayName(source: BookDisplayNameSource, locale: SupportedLocale): string {
  const map = source.friendlyNameI18n;
  if (map) {
    const candidates = locale === 'zh-Hant' || locale === 'zh-Hans' ? [locale, 'zh', DEFAULT_LOCALE] : [locale, DEFAULT_LOCALE];
    for (const candidate of candidates) {
      const value = map[candidate];
      if (typeof value === 'string' && value.length > 0) return value;
    }
  }
  if (source.friendlyName) return source.friendlyName;
  return source.filename;
}
