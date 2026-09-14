import type { BookCatalogEntry } from '@shared/types';
import type { BookCatalogClient, BookCatalogFetchOutcome } from './client';

/** Used by every automated test and local dev — never reachable from a normal production
 *  run, which always constructs the http client (see main/ipc/book.ts). */
export function createFixtureBookCatalogClient(entries: BookCatalogEntry[]): BookCatalogClient {
  return {
    kind: 'fixture',
    async fetchCatalog(): Promise<BookCatalogFetchOutcome> {
      return { status: 'ok', entries };
    },
  };
}
