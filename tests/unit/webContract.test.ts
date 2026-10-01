import { describe, expect, it } from 'vitest';
import { createHttpBookCatalogClient } from '../../src/main/services/bookCatalog/httpClient';
import {
  APP_VERSION_HEADER,
  CONTENT_STATES,
  STATES_AWARE_VERSION,
  compareVersions,
  meetsMinimumVersion,
} from '../../src/shared/contentContract';
// The tester header's name lives in the Internal-only module, so a Store bundle cannot contain
// it. The tests run as the Internal build, which is why they can see it at all.
import { TESTER_KEY_HEADER } from '../../src/main/internal/index';

/**
 * The contract with ponyabc-web.
 *
 * The examples below are the shapes that branch actually returns — taken from
 * `feature/content-states-and-app-gating`: `src/app/api/public/books/route.ts` builds each book,
 * and `src/lib/content/visibility.ts` names the states and the headers. If either side renames
 * something, this fails on the side that did not.
 */

/** Exactly as /api/public/books returns a book to an app that sends 0.3.17 or newer. */
const BOOK_FROM_WEB = {
  id: 'a9fb4d8b-fea4-4623-9dbb-aba7f7de9c18',
  originalFileName: 'AR百科卡.axb',
  friendlyName: 'AR百科卡',
  friendlyNameI18n: { en: 'AR Encyclopaedia Cards', zh: 'AR百科卡', yue: 'AR百科卡' },
  contentLanguages: ['zh'],
  sizeBytes: 11694088,
  sha256: 'd09b590b095848f32905999c36d1373fa42b1df755e990128c56c597fc98d990',
  sortOrder: 0,
  updatedAt: '2026-09-14T19:23:53.699674+00:00',
  downloadUrl: 'https://register.ponyabc.uk/api/public/books/download?id=a9fb4d8b-fea4-4623-9dbb-aba7f7de9c18',
  state: 'active',
};

const fetchReturning = (body: unknown, capture?: (init?: RequestInit) => void) =>
  (async (_url: string, init?: RequestInit) => {
    capture?.(init);
    return new Response(JSON.stringify(body), { status: 200 });
  }) as unknown as typeof fetch;

describe('the names both sides use', () => {
  it('spells the headers the way the server reads them', () => {
    // ponyabc-web lowercases when reading, but what we send is what a person greps for.
    expect(APP_VERSION_HEADER.toLowerCase()).toBe('x-ponyabc-app-version');
    expect(TESTER_KEY_HEADER.toLowerCase()).toBe('x-ponyabc-tester-key');
  });

  it('knows the same four states, in the same words', () => {
    expect([...CONTENT_STATES]).toEqual(['active', 'retired', 'remove_from_pens', 'hidden']);
  });

  it('agrees on the version at which the server starts telling us about states', () => {
    expect(STATES_AWARE_VERSION).toBe('0.3.17');
  });
});

describe('reading a real response', () => {
  it('maps the server\'s book, including `state`', async () => {
    const client = createHttpBookCatalogClient({
      baseUrl: 'https://register.ponyabc.uk',
      appVersion: '0.3.17',
      fetchFn: fetchReturning({ books: [BOOK_FROM_WEB] }),
    });
    const outcome = await client.fetchCatalog();
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    const [entry] = outcome.entries;
    expect(entry.state).toBe('active');
    expect(entry.filename).toBe('AR百科卡.axb');
    expect(entry.sizeBytes).toBe(11694088);
    expect(entry.minAppVersion).toBeNull();
  });

  it('carries each of the four states through unchanged', async () => {
    for (const state of CONTENT_STATES) {
      const client = createHttpBookCatalogClient({
        baseUrl: 'https://register.ponyabc.uk',
        appVersion: '0.3.17',
        fetchFn: fetchReturning({ books: [{ ...BOOK_FROM_WEB, state }] }),
      });
      const outcome = await client.fetchCatalog();
      expect(outcome.status === 'ok' && outcome.entries[0].state).toBe(state);
    }
  });

  it('reads an unknown state as active, never as a reason to remove a book', async () => {
    const client = createHttpBookCatalogClient({
      baseUrl: 'https://register.ponyabc.uk',
      appVersion: '0.3.17',
      fetchFn: fetchReturning({ books: [{ ...BOOK_FROM_WEB, state: 'something_new' }] }),
    });
    const outcome = await client.fetchCatalog();
    expect(outcome.status === 'ok' && outcome.entries[0].state).toBe('active');
  });

  it('accepts the response an OLD server sends, with no state at all', async () => {
    const { state: _dropped, ...withoutState } = BOOK_FROM_WEB;
    const client = createHttpBookCatalogClient({
      baseUrl: 'https://register.ponyabc.uk',
      appVersion: '0.3.17',
      fetchFn: fetchReturning({ books: [withoutState] }),
    });
    const outcome = await client.fetchCatalog();
    expect(outcome.status === 'ok' && outcome.entries[0].state).toBe('active');
  });

  it('reads minAppVersion when the server sends one', async () => {
    const client = createHttpBookCatalogClient({
      baseUrl: 'https://register.ponyabc.uk',
      appVersion: '0.3.17',
      fetchFn: fetchReturning({ books: [{ ...BOOK_FROM_WEB, minAppVersion: '0.3.17' }] }),
    });
    const outcome = await client.fetchCatalog();
    expect(outcome.status === 'ok' && outcome.entries[0].minAppVersion).toBe('0.3.17');
  });

  it('sends our version, and the tester key only when there is one', async () => {
    let seen: Record<string, string> = {};
    await createHttpBookCatalogClient({
      baseUrl: 'https://x',
      appVersion: '0.3.17',
      fetchFn: fetchReturning({ books: [] }, (init) => { seen = init?.headers as Record<string, string>; }),
    }).fetchCatalog();
    expect(seen[APP_VERSION_HEADER]).toBe('0.3.17');
    expect(seen[TESTER_KEY_HEADER]).toBeUndefined();

    await createHttpBookCatalogClient({
      baseUrl: 'https://x',
      appVersion: '0.3.17',
      testerKey: 'k',
      fetchFn: fetchReturning({ books: [] }, (init) => { seen = init?.headers as Record<string, string>; }),
    }).fetchCatalog();
    expect(seen[TESTER_KEY_HEADER]).toBe('k');
  });
});

/** The second guard. The server filters by the version we send; this is what we do if it does
 *  not — a stale cache, a hand-edited row, a server older than its own rules. */
describe('minimum app version, checked on our side too', () => {
  it('refuses an item that asks for a newer app than this one', () => {
    expect(meetsMinimumVersion('0.3.18', '0.3.17')).toBe(false);
    expect(meetsMinimumVersion('0.4.0', '0.3.17')).toBe(false);
  });

  it('accepts an item whose minimum we meet, or that has none', () => {
    expect(meetsMinimumVersion('0.3.17', '0.3.17')).toBe(true);
    expect(meetsMinimumVersion('0.3.9', '0.3.17')).toBe(true);
    expect(meetsMinimumVersion(null, '0.3.16')).toBe(true);
  });

  it('orders versions numerically and treats an unreadable one as the oldest', () => {
    expect(compareVersions('0.3.9', '0.3.17')).toBeLessThan(0);
    expect(compareVersions('0.3.17-rc4', '0.3.17')).toBe(0);
    expect(compareVersions('', '0.0.1')).toBeLessThan(0);
  });
});
