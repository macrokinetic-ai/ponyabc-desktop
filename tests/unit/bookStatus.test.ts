import { describe, expect, it } from 'vitest';
import type { BookCatalogEntry } from '../../src/shared/types';
import { isInstallEligible, resolveBookItemStatus, resolveDisplayName } from '../../src/main/services/bookStatus';

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
});

describe('isInstallEligible', () => {
  it('true only when filename is declared AND sha256 is non-null', () => {
    expect(isInstallEligible(entry())).toBe(true);
    expect(isInstallEligible(entry({ filenameSource: 'fallback-storage-key' }))).toBe(false);
    expect(isInstallEligible(entry({ sha256: null }))).toBe(false);
  });
});

describe('resolveBookItemStatus', () => {
  it('not-in-catalog when there is no matching entry at all', () => {
    expect(resolveBookItemStatus({ entry: null, isAmbiguous: false, cachedSha256: null, penFile: null })).toBe('not-in-catalog');
  });

  it('catalog-ambiguous overrides everything else, regardless of pen/cache state', () => {
    expect(
      resolveBookItemStatus({ entry: entry(), isAmbiguous: true, cachedSha256: 'a'.repeat(64), penFile: { sha256: 'a'.repeat(64) } }),
    ).toBe('catalog-ambiguous');
  });

  it('catalog-incomplete-metadata when the filename is only a fallback, even with a pen file present', () => {
    expect(
      resolveBookItemStatus({
        entry: entry({ filenameSource: 'fallback-storage-key' }),
        isAmbiguous: false,
        cachedSha256: null,
        penFile: { sha256: 'a'.repeat(64) },
      }),
    ).toBe('catalog-incomplete-metadata');
  });

  it('on-pen-current when the pen file hash matches the catalog hash', () => {
    expect(resolveBookItemStatus({ entry: entry(), isAmbiguous: false, cachedSha256: null, penFile: { sha256: 'a'.repeat(64) } })).toBe(
      'on-pen-current',
    );
  });

  it('on-pen-differs-from-official when hashes differ — never claims which is newer', () => {
    expect(resolveBookItemStatus({ entry: entry(), isAmbiguous: false, cachedSha256: null, penFile: { sha256: 'b'.repeat(64) } })).toBe(
      'on-pen-differs-from-official',
    );
  });

  it('never claims a hash mismatch/corruption when the catalog hash is null — on-pen-hash-unknown instead', () => {
    expect(
      resolveBookItemStatus({ entry: entry({ sha256: null }), isAmbiguous: false, cachedSha256: null, penFile: { sha256: 'b'.repeat(64) } }),
    ).toBe('on-pen-hash-unknown');
  });

  it('on-pen-hash-unknown when the pen file could not be read/hashed (sha256: null sentinel)', () => {
    expect(resolveBookItemStatus({ entry: entry(), isAmbiguous: false, cachedSha256: null, penFile: { sha256: null } })).toBe(
      'on-pen-hash-unknown',
    );
  });

  it('catalog-cached-current when no pen file but the cache hash matches', () => {
    expect(resolveBookItemStatus({ entry: entry(), isAmbiguous: false, cachedSha256: 'a'.repeat(64), penFile: null })).toBe(
      'catalog-cached-current',
    );
  });

  it('catalog-cached-stale when no pen file and the cache hash differs', () => {
    expect(resolveBookItemStatus({ entry: entry(), isAmbiguous: false, cachedSha256: 'b'.repeat(64), penFile: null })).toBe(
      'catalog-cached-stale',
    );
  });

  it('catalog-not-cached when nothing local exists yet', () => {
    expect(resolveBookItemStatus({ entry: entry(), isAmbiguous: false, cachedSha256: null, penFile: null })).toBe('catalog-not-cached');
  });
});
