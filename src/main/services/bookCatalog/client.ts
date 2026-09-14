import type { BookCatalogEntry } from '@shared/types';

export type BookCatalogFetchOutcome =
  | { status: 'ok'; entries: BookCatalogEntry[] }
  /** httpStatus is set only when a response actually came back (a non-2xx/malformed body) —
   *  left unset for a network-level failure (DNS, timeout, connection refused), which is a
   *  materially different diagnosis and must not look the same to the caller. */
  | { status: 'error'; message: string; httpStatus?: number };

export interface BookCatalogClient {
  readonly kind: 'live' | 'fixture';
  fetchCatalog(): Promise<BookCatalogFetchOutcome>;
}
