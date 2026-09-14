import type { BookCatalogEntry } from '@shared/types';

export type BookCatalogFetchOutcome =
  | { status: 'ok'; entries: BookCatalogEntry[] }
  | { status: 'error'; message: string };

export interface BookCatalogClient {
  readonly kind: 'live' | 'fixture';
  fetchCatalog(): Promise<BookCatalogFetchOutcome>;
}
