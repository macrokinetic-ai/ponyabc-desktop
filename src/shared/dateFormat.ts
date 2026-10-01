import { DEFAULT_LOCALE, isSupportedLocale } from './locales';

/**
 * Dates and times, in the language the customer chose — never the computer's.
 *
 * Two separate things were wrong before this module existed. Half the screens formatted with no
 * locale at all, so a parent in London running a Windows machine set to US English saw
 * "9/29/2026, 10:17:07 PM"; and the app's own locale codes are translation tags, not formatting
 * ones, so even passing `i18n.language` gave `en`, which Intl resolves to American conventions.
 *
 * English here means **British** English (owner requirement): 29/09/2026, and 22:17 rather than
 * 10:17 PM. `hour12: false` is stated rather than inferred, because a browser will otherwise let
 * the operating system's 12-hour preference override the locale's own convention.
 */
const FORMATTING_LOCALE: Record<string, string> = {
  en: 'en-GB',
};

/** The BCP-47 tag to format with, for one of the app's UI locales. */
export function formattingLocale(appLocale: string): string {
  const locale = isSupportedLocale(appLocale) ? appLocale : DEFAULT_LOCALE;
  return FORMATTING_LOCALE[locale] ?? locale;
}

const NUMERIC_DATE: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
const MEDIUM_DATE: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
const TIME: Intl.DateTimeFormatOptions = { hour: '2-digit', minute: '2-digit', hour12: false };

/** "29/09/2026, 22:17" — for a timestamp a customer reads in passing. */
export function formatDateTime(appLocale: string, ms: number): string {
  return new Intl.DateTimeFormat(formattingLocale(appLocale), { ...NUMERIC_DATE, ...TIME }).format(new Date(ms));
}

/** "29 Sep 2026, 22:17" — for a list a customer picks from, where the month name reads faster. */
export function formatDateTimeMedium(appLocale: string, ms: number): string {
  return new Intl.DateTimeFormat(formattingLocale(appLocale), { ...MEDIUM_DATE, ...TIME }).format(new Date(ms));
}

/** "29/09/2026". */
export function formatDate(appLocale: string, ms: number): string {
  return new Intl.DateTimeFormat(formattingLocale(appLocale), NUMERIC_DATE).format(new Date(ms));
}
