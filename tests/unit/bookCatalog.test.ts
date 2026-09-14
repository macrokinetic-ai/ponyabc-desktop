import { describe, expect, it, vi } from 'vitest';
import type { BookCatalogEntry } from '../../src/shared/types';
import { createFixtureBookCatalogClient } from '../../src/main/services/bookCatalog/fixtureClient';
import { createHttpBookCatalogClient } from '../../src/main/services/bookCatalog/httpClient';
import { validateCatalogEntries } from '../../src/main/services/bookCatalogValidate';

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
    updatedAtMs: null,
    downloadUrl: 'https://register.ponyabc.uk/api/public/books/download?id=b1',
    ...overrides,
  };
}

describe('createFixtureBookCatalogClient', () => {
  it('always reports kind "fixture" and returns exactly the entries given', async () => {
    const entries = [entry(), entry({ contentId: 'b2' })];
    const client = createFixtureBookCatalogClient(entries);
    expect(client.kind).toBe('fixture');
    await expect(client.fetchCatalog()).resolves.toEqual({ status: 'ok', entries });
  });
});

describe('createHttpBookCatalogClient', () => {
  const baseUrl = 'https://register.ponyabc.uk';

  it('reports kind "live" and sends no Authorization header (Option A is secret-free)', async () => {
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toBeUndefined();
      return new Response(JSON.stringify({ books: [] }), { status: 200 });
    });
    const client = createHttpBookCatalogClient({ baseUrl, fetchFn: fetchFn as unknown as typeof fetch });
    expect(client.kind).toBe('live');
    const outcome = await client.fetchCatalog();
    expect(outcome).toEqual({ status: 'ok', entries: [] });
    expect(fetchFn).toHaveBeenCalledWith(`${baseUrl}/api/public/books`, expect.any(Object));
  });

  it('maps a real response shape, including a full friendlyNameI18n map', async () => {
    const raw = {
      books: [
        {
          id: 'b1',
          originalFileName: '0451.axb',
          friendlyName: 'Book One',
          friendlyNameI18n: { en: 'Book One', 'zh-Hant': '第一本書' },
          contentLanguages: ['en'],
          sizeBytes: 1000,
          sha256: 'a'.repeat(64),
          sortOrder: 0,
          updatedAt: '2026-09-01T00:00:00.000Z',
          downloadUrl: `${baseUrl}/api/public/books/download?id=b1`,
        },
      ],
    };
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    const client = createHttpBookCatalogClient({ baseUrl, fetchFn: fetchFn as unknown as typeof fetch });
    const outcome = await client.fetchCatalog();
    expect(outcome).toEqual({ status: 'ok', entries: [entry({ updatedAtMs: Date.parse('2026-09-01T00:00:00.000Z') })] });
  });

  it('leaves updatedAtMs null when the field is missing or not a valid date string, never guesses', async () => {
    const raw = {
      books: [
        { id: 'b1', originalFileName: 'a.axb', friendlyName: 'a', friendlyNameI18n: null, contentLanguages: [], sizeBytes: 1, sha256: null, sortOrder: 0, downloadUrl: 'x' },
        { id: 'b2', originalFileName: 'b.axb', friendlyName: 'b', friendlyNameI18n: null, contentLanguages: [], sizeBytes: 1, sha256: null, sortOrder: 0, updatedAt: 'not-a-date', downloadUrl: 'y' },
      ],
    };
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    const client = createHttpBookCatalogClient({ baseUrl, fetchFn: fetchFn as unknown as typeof fetch });
    const outcome = await client.fetchCatalog();
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.entries.map((e) => e.updatedAtMs)).toEqual([null, null]);
  });

  it('marks an entry with no declared filename as filenameSource "fallback-storage-key"', async () => {
    const raw = { books: [{ id: 'b1', originalFileName: '', friendlyName: 'x', friendlyNameI18n: null, contentLanguages: [], sizeBytes: 1, sha256: null, sortOrder: 0, downloadUrl: 'x' }] };
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(raw), { status: 200 }));
    const client = createHttpBookCatalogClient({ baseUrl, fetchFn: fetchFn as unknown as typeof fetch });
    const outcome = await client.fetchCatalog();
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.entries[0].filenameSource).toBe('fallback-storage-key');
    expect(outcome.entries[0].filename).toBe('b1.axb');
  });

  it('returns a typed error on a non-2xx response, without throwing', async () => {
    const fetchFn = vi.fn(async () => new Response('', { status: 503 }));
    const client = createHttpBookCatalogClient({ baseUrl, fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.fetchCatalog()).resolves.toEqual({ status: 'error', message: 'Server returned 503.', httpStatus: 503 });
  });

  it('returns a typed error on malformed JSON / a missing "books" array', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ nope: true }), { status: 200 }));
    const client = createHttpBookCatalogClient({ baseUrl, fetchFn: fetchFn as unknown as typeof fetch });
    const outcome = await client.fetchCatalog();
    expect(outcome.status).toBe('error');
  });

  it('returns a typed error on a network/timeout failure, never throws', async () => {
    const fetchFn = vi.fn(async () => {
      throw new Error('network down');
    });
    const client = createHttpBookCatalogClient({ baseUrl, fetchFn: fetchFn as unknown as typeof fetch });
    await expect(client.fetchCatalog()).resolves.toEqual({ status: 'error', message: 'network down' });
  });
});

describe('validateCatalogEntries', () => {
  it('reports no conflicts when every filename is unique', () => {
    const entries = [entry({ contentId: 'b1', filename: 'a.axb' }), entry({ contentId: 'b2', filename: 'b.axb' })];
    expect(validateCatalogEntries(entries)).toEqual({ entries, conflicts: [] });
  });

  it('flags a case-insensitive filename collision between two different content ids', () => {
    const entries = [entry({ contentId: 'b1', filename: 'Story.axb' }), entry({ contentId: 'b2', filename: 'story.AXB' })];
    const result = validateCatalogEntries(entries);
    expect(result.entries).toEqual(entries);
    expect(result.conflicts).toEqual([{ filenameLower: 'story.axb', contentIds: expect.arrayContaining(['b1', 'b2']) }]);
    expect(result.conflicts[0].contentIds).toHaveLength(2);
  });

  it('does not flag the same content id appearing once as its own conflict', () => {
    const entries = [entry({ contentId: 'b1', filename: 'a.axb' })];
    expect(validateCatalogEntries(entries).conflicts).toEqual([]);
  });
});
