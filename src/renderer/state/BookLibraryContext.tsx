import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  BookActionResult,
  BookCatalogItem,
  BookDownloadProgressEvent,
  BookLibraryMeta,
  BookPenItem,
  BookRemoveResult,
} from '@shared/types';
import { usePenRoot } from './PenRootContext';

interface BookLibraryState {
  /** null while no pen is connected — the catalog (right pane) still works fully. */
  penItems: BookPenItem[] | null;
  catalogItems: BookCatalogItem[];
  meta: BookLibraryMeta;
  loading: boolean;
  refreshing: boolean;
  /** Real byte-based progress for an in-flight download, keyed by contentId. */
  downloadProgress: Record<string, BookDownloadProgressEvent>;
  refreshCatalog: () => Promise<void>;
  /** Re-lists both panes from already-known local state — no network call. Useful as a
   *  manual "re-check the pen" action independent of a full catalog refresh. */
  refreshPen: () => Promise<void>;
  add: (contentId: string) => Promise<BookActionResult>;
  replaceWithOfficial: (contentId: string) => Promise<BookActionResult>;
  reinstall: (contentId: string) => Promise<BookActionResult>;
  remove: (fileName: string) => Promise<BookRemoveResult>;
  cancelDownload: (contentId: string) => Promise<void>;
}

const emptyMeta: BookLibraryMeta = { fetchedAtMs: null, source: 'none', offline: true, conflicts: [], lastCheck: null };

const BookLibraryContext = createContext<BookLibraryState | null>(null);

export function BookLibraryProvider({ children }: { children: ReactNode }) {
  const penRoot = usePenRoot();
  const [penItems, setPenItems] = useState<BookPenItem[] | null>(null);
  const [catalogItems, setCatalogItems] = useState<BookCatalogItem[]>([]);
  const [meta, setMeta] = useState<BookLibraryMeta>(emptyMeta);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, BookDownloadProgressEvent>>({});
  const penGenerationRef = useRef(-1);
  penGenerationRef.current = penRoot.result.status === 'ok' ? penRoot.result.generation : -1;

  const applyList = useCallback((result: { penItems: BookPenItem[] | null; catalogItems: BookCatalogItem[]; meta: BookLibraryMeta }) => {
    setPenItems(result.penItems);
    setCatalogItems(result.catalogItems);
    setMeta(result.meta);
  }, []);

  const refreshList = useCallback(async () => {
    const result = await window.ponyabc.bookList();
    applyList(result);
  }, [applyList]);

  const refreshCatalog = useCallback(async () => {
    setRefreshing(true);
    try {
      const result = await window.ponyabc.bookCatalogRefresh();
      applyList(result);
    } finally {
      setRefreshing(false);
    }
  }, [applyList]);

  // Initial load: show whatever is already locally known immediately, then attempt an update.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshList();
      if (cancelled) return;
      setLoading(false);
      await refreshCatalog();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-list (pen-side state only, no network) whenever the connected pen changes.
  const penResultStatus = penRoot.result.status;
  const penResultPath = penRoot.result.status === 'ok' ? penRoot.result.path : null;
  useEffect(() => {
    if (loading) return;
    void refreshList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [penResultStatus, penResultPath]);

  // Patches just the one resolved item in place — no full re-list round trip needed once a
  // pending 'matched-verifying'/'on-pen-verifying' item's hash finishes computing. A null
  // result (the file couldn't be read in the brief window since listing) is a no-op: the item
  // stays "verifying" until the next explicit refresh tries again, rather than guessing.
  useEffect(() => {
    return window.ponyabc.onBookVerifyUpdate((event) => {
      if (event.result === null) return;
      setPenItems((prev) => (prev ? prev.map((i) => (i.fileName === event.fileName ? { ...i, status: event.result!.penStatus } : i)) : prev));
      setCatalogItems((prev) =>
        prev.map((i) =>
          i.contentId === event.contentId
            ? { ...i, status: event.result!.catalogStatus, actionable: event.result!.catalogStatus === 'on-pen-differs' }
            : i,
        ),
      );
    });
  }, []);

  useEffect(() => {
    return window.ponyabc.onBookDownloadProgress((event) => {
      setDownloadProgress((prev) => {
        if (event.phase === 'done' || event.phase === 'failed' || event.phase === 'cancelled') {
          const next = { ...prev };
          delete next[event.contentId];
          return next;
        }
        return { ...prev, [event.contentId]: event };
      });
    });
  }, []);

  const add = useCallback(
    async (contentId: string) => {
      const result = await window.ponyabc.bookAdd({ contentId, penGeneration: penGenerationRef.current });
      await refreshList();
      return result;
    },
    [refreshList],
  );

  const replaceWithOfficial = useCallback(
    async (contentId: string) => {
      const result = await window.ponyabc.bookUpdate({ contentId, penGeneration: penGenerationRef.current });
      await refreshList();
      return result;
    },
    [refreshList],
  );

  const reinstall = useCallback(
    async (contentId: string) => {
      const result = await window.ponyabc.bookReinstall({ contentId, penGeneration: penGenerationRef.current });
      await refreshList();
      return result;
    },
    [refreshList],
  );

  const remove = useCallback(
    async (fileName: string) => {
      const result = await window.ponyabc.bookRemove({ fileName, penGeneration: penGenerationRef.current });
      await refreshList();
      return result;
    },
    [refreshList],
  );

  const cancelDownload = useCallback(async (contentId: string) => {
    await window.ponyabc.bookDownloadCancel(contentId);
  }, []);

  return (
    <BookLibraryContext.Provider
      value={{
        penItems,
        catalogItems,
        meta,
        loading,
        refreshing,
        downloadProgress,
        refreshCatalog,
        refreshPen: refreshList,
        add,
        replaceWithOfficial,
        reinstall,
        remove,
        cancelDownload,
      }}
    >
      {children}
    </BookLibraryContext.Provider>
  );
}

export function useBookLibrary(): BookLibraryState {
  const ctx = useContext(BookLibraryContext);
  if (!ctx) throw new Error('useBookLibrary must be used within a BookLibraryProvider');
  return ctx;
}
