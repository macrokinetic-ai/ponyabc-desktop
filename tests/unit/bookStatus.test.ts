import { describe, expect, it } from 'vitest';
import type { BookCatalogEntry } from '../../src/shared/types';
import { isInstallEligible, resolveDisplayName } from '../../src/main/services/bookStatus';

function entry(overrides: Partial<BookCatalogEntry> = {}): BookCatalogEntry {
  return {
    contentId: 'b1',
    filename: '0451.axb',
    filenameSource: 'declared',
    sha256: 'a'.repeat(64),
    sizeBytes: 1000,
    friendlyName: 'Book One',
    friendlyNameI18n: { en: 'Book One', 'zh-Hant': '第一本書' },
    contentLanguages: ['en'],
    sortOrder: 0,
    downloadUrl: 'https://x/download?id=b1',
    ...overrides,
  };
}

describe('resolveDisplayName', () => {
  it('prefers the requested locale', () => {
    expect(resolveDisplayName(entry(), 'zh-Hant')).toBe('第一本書');
  });
  it('falls back to English when the requested locale is missing', () => {
    expect(resolveDisplayName(entry(), 'fr')).toBe('Book One');
  });
  it('falls back to friendlyName when there is no i18n map at all', () => {
    expect(resolveDisplayName(entry({ friendlyNameI18n: null }), 'fr')).toBe('Book One');
  });
  it('falls back to the filename as a last resort', () => {
    expect(resolveDisplayName(entry({ friendlyNameI18n: null, friendlyName: '' }), 'fr')).toBe('0451.axb');
  });

  it('zh-Hant/zh-Hans fall back to the catalog\'s generic "zh" entry before English — the real BOOK catalog never splits Chinese by script', () => {
    const zhOnly = entry({ friendlyNameI18n: { zh: '中文名稱', en: 'English Name' } });
    expect(resolveDisplayName(zhOnly, 'zh-Hant')).toBe('中文名稱');
    expect(resolveDisplayName(zhOnly, 'zh-Hans')).toBe('中文名稱');
  });

  it('a non-Chinese locale never falls back to "zh" — only to English', () => {
    const zhOnly = entry({ friendlyNameI18n: { zh: '中文名稱', en: 'English Name' } });
    expect(resolveDisplayName(zhOnly, 'fr')).toBe('English Name');
  });
});

describe('isInstallEligible', () => {
  it('true only when filename is declared AND sha256 is non-null', () => {
    expect(isInstallEligible(entry())).toBe(true);
    expect(isInstallEligible(entry({ filenameSource: 'fallback-storage-key' }))).toBe(false);
    expect(isInstallEligible(entry({ sha256: null }))).toBe(false);
  });
});

// Full pen-vs-catalog match/status derivation (matched-current / matched-differs /
// matched-hash-unknown / unknown / not-on-pen / on-pen-current / on-pen-differs /
// metadata-incomplete / ambiguous) is covered by bookReconcile.test.ts, which exercises the
// real two-pane buildBookLibrary() output rather than an isolated pure function.
