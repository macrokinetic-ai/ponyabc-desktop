import { DEFAULT_LOCALE, type SupportedLocale } from '@shared/locales';

/**
 * Maps an OS-reported locale tag (BCP-47, any casing) to one of our 8 supported UI
 * locales, or null if it doesn't match any language family we support.
 */
function mapSingleLocale(tag: string): SupportedLocale | null {
  const normalized = tag.toLowerCase().replace(/_/g, '-');

  // Chinese needs explicit region/script handling — script subtag when present,
  // otherwise region-based convention (Traditional-using vs Simplified-using regions).
  if (normalized === 'zh-hant' || normalized.startsWith('zh-hant-')) return 'zh-Hant';
  if (normalized === 'zh-hans' || normalized.startsWith('zh-hans-')) return 'zh-Hans';
  if (normalized.startsWith('zh-tw') || normalized.startsWith('zh-hk') || normalized.startsWith('zh-mo')) {
    return 'zh-Hant';
  }
  if (normalized.startsWith('zh-cn') || normalized.startsWith('zh-sg')) return 'zh-Hans';
  if (normalized === 'zh' || normalized.startsWith('zh-')) return 'zh-Hans';

  if (normalized === 'en' || normalized.startsWith('en-')) return 'en';
  if (normalized === 'es' || normalized.startsWith('es-')) return 'es';
  if (normalized === 'fr' || normalized.startsWith('fr-')) return 'fr';
  if (normalized === 'de' || normalized.startsWith('de-')) return 'de';
  if (normalized === 'it' || normalized.startsWith('it-')) return 'it';
  if (normalized === 'pt' || normalized.startsWith('pt-')) return 'pt';

  return null;
}

/**
 * Given the OS's preferred-language list (most preferred first), returns the first
 * supported match, or DEFAULT_LOCALE if none of the candidates are supported.
 */
export function resolveSystemLocale(candidates: string[]): SupportedLocale {
  for (const candidate of candidates) {
    const match = mapSingleLocale(candidate);
    if (match) return match;
  }
  return DEFAULT_LOCALE;
}
