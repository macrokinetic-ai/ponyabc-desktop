import { describe, expect, it } from 'vitest';
import { resolveSystemLocale } from '../../src/main/services/localeResolver';

describe('resolveSystemLocale', () => {
  const cases: Array<[string[], string]> = [
    [['zh-Hant-TW'], 'zh-Hant'],
    [['zh-TW'], 'zh-Hant'],
    [['zh-HK'], 'zh-Hant'],
    [['zh-MO'], 'zh-Hant'],
    [['zh-Hans-CN'], 'zh-Hans'],
    [['zh-CN'], 'zh-Hans'],
    [['zh-SG'], 'zh-Hans'],
    [['zh'], 'zh-Hans'],
    [['pt-BR'], 'pt'],
    [['pt-PT'], 'pt'],
    [['es-MX'], 'es'],
    [['fr-CA'], 'fr'],
    [['de-AT'], 'de'],
    [['it-IT'], 'it'],
    [['en-GB'], 'en'],
    [['ja-JP'], 'en'],
    [[], 'en'],
  ];

  for (const [candidates, expected] of cases) {
    it(`maps ${JSON.stringify(candidates)} -> ${expected}`, () => {
      expect(resolveSystemLocale(candidates)).toBe(expected);
    });
  }

  it('is case-insensitive and accepts underscore separators', () => {
    expect(resolveSystemLocale(['ZH_HK'])).toBe('zh-Hant');
  });

  it('honors OS preference order, returning the first supported match', () => {
    expect(resolveSystemLocale(['ja-JP', 'fr-FR', 'en-US'])).toBe('fr');
  });
});
