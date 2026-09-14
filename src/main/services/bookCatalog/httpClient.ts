import type { BookCatalogEntry } from '@shared/types';
import type { BookCatalogClient, BookCatalogFetchOutcome } from './client';

interface RawPublicBook {
  id: unknown;
  originalFileName: unknown;
  friendlyName: unknown;
  friendlyNameI18n: unknown;
  contentLanguages: unknown;
  sizeBytes: unknown;
  sha256: unknown;
  sortOrder: unknown;
  downloadUrl: unknown;
}

function toEntry(b: RawPublicBook): BookCatalogEntry {
  const id = String(b.id);
  const declaredFilename = typeof b.originalFileName === 'string' && b.originalFileName.length > 0 ? b.originalFileName : null;
  return {
    contentId: id,
    filename: declaredFilename ?? `${id}.axb`,
    filenameSource: declaredFilename ? 'declared' : 'fallback-storage-key',
    sha256: typeof b.sha256 === 'string' ? b.sha256 : null,
    sizeBytes: typeof b.sizeBytes === 'number' ? b.sizeBytes : Number(b.sizeBytes) || 0,
    friendlyName: typeof b.friendlyName === 'string' ? b.friendlyName : id,
    friendlyNameI18n:
      b.friendlyNameI18n && typeof b.friendlyNameI18n === 'object' ? (b.friendlyNameI18n as Record<string, string>) : null,
    contentLanguages: Array.isArray(b.contentLanguages) ? (b.contentLanguages as string[]) : [],
    sortOrder: typeof b.sortOrder === 'number' ? b.sortOrder : Number(b.sortOrder) || 0,
    downloadUrl: String(b.downloadUrl),
  };
}

/**
 * Talks to the secret-free public BOOK catalog endpoint (GET /api/public/books) —
 * no Authorization header, since Option A's public endpoint takes none. There is nothing
 * to embed or gate here: the endpoint is safe to call directly from a shipped build.
 */
export function createHttpBookCatalogClient(opts: { baseUrl: string; fetchFn?: typeof fetch }): BookCatalogClient {
  const fetchFn = opts.fetchFn ?? fetch;
  return {
    kind: 'live',
    async fetchCatalog(): Promise<BookCatalogFetchOutcome> {
      try {
        const response = await fetchFn(`${opts.baseUrl}/api/public/books`, {
          signal: AbortSignal.timeout(10000),
        });
        if (!response.ok) {
          return { status: 'error', message: `Server returned ${response.status}.` };
        }
        const data = (await response.json()) as { books?: unknown };
        if (!Array.isArray(data.books)) {
          return { status: 'error', message: 'Malformed catalog response.' };
        }
        return { status: 'ok', entries: (data.books as RawPublicBook[]).map(toEntry) };
      } catch (err) {
        return { status: 'error', message: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
