import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  BookActionResult,
  BookCatalogItem,
  BookDownloadBatchStartResult,
  BookDownloadBatchSummaryEvent,
  BookDownloadProgressEvent,
  BookLibraryMeta,
  BookPenItem,
  BookRemoveResult,
  BookVerifyContentResult,
  BookVerifyProgressEvent,
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
  /** Real byte-based progress for an in-flight explicit on-pen verification, keyed by
   *  contentId (the identifier both panes can look this up by) — entirely separate from
   *  downloadProgress (a different phase, a different source of bytes: local disk read, not
   *  network). */
  verifyProgress: Record<string, BookVerifyProgressEvent>;
  refreshCatalog: () => Promise<void>;
  /** Re-lists both panes from already-known local state — no network call. Useful as a
   *  manual "re-check the pen" action independent of a full catalog refresh. */
  refreshPen: () => Promise<void>;
  add: (contentId: string) => Promise<BookActionResult>;
  replaceWithOfficial: (contentId: string) => Promise<BookActionResult>;
  reinstall: (contentId: string) => Promise<BookActionResult>;
  remove: (fileName: string) => Promise<BookRemoveResult>;
  cancelDownload: (contentId: string) => Promise<void>;
  /** Explicit "verify selected content" — never triggered automatically. */
  verifyContent: (fileNames: string[]) => Promise<BookVerifyContentResult>;
  cancelVerify: () => Promise<void>;

  /** True while a "Download selected/all to App" batch is running — cache only, never writes
   *  to the pen. Distinct from downloadProgress above, which tracks per-item byte progress;
   *  this tracks the batch as a whole so an overall "X of Y" counter survives between items
   *  (an individual item's downloadProgress entry disappears once that item finishes). */
  batchDownloadActive: boolean;
  batchDownloadCounter: { completedCount: number; totalCount: number } | null;
  /** The most recently received batch completion summary — cleared when a new batch starts.
   *  The screen watches this (by reference) to show a one-time completion message. */
  batchDownloadSummary: BookDownloadBatchSummaryEvent | null;
  downloadBatch: (contentIds: string[]) => Promise<BookDownloadBatchStartResult>;
  cancelDownloadBatch: () => Promise<void>;
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
  const [verifyProgress, setVerifyProgress] = useState<Record<string, BookVerifyProgressEvent>>({});
  const [batchDownloadActive, setBatchDownloadActive] = useState(false);
  const [batchDownloadCounter, setBatchDownloadCounter] = useState<{ completedCount: number; totalCount: number } | null>(null);
  const [batchDownloadSummary, setBatchDownloadSummary] = useState<BookDownloadBatchSummaryEvent | null>(null);
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
      if (event.completedCount !== undefined && event.totalCount !== undefined) {
        setBatchDownloadCounter({ completedCount: event.completedCount, totalCount: event.totalCount });
      }
      setDownloadProgress((prev) => {
        if (event.phase === 'done' || event.phase === 'failed' || event.phase === 'cancelled' || event.phase === 'skipped') {
          const next = { ...prev };
          delete next[event.contentId];
          return next;
        }
        return { ...prev, [event.contentId]: event };
      });
    });
  }, []);

  useEffect(() => {
    return window.ponyabc.onBookDownloadBatchSummary((event) => {
      setBatchDownloadActive(false);
      setBatchDownloadCounter(null);
      setBatchDownloadSummary(event);
      void refreshList(); // pick up newly-cached items' `cached` flags
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return window.ponyabc.onBookVerifyProgress((event) => {
      setVerifyProgress((prev) => {
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

  const verifyContent = useCallback(async (fileNames: string[]) => {
    return window.ponyabc.bookVerifyContent({ fileNames, penGeneration: penGenerationRef.current });
  }, []);

  const cancelVerify = useCallback(async () => {
    await window.ponyabc.bookVerifyCancel();
  }, []);

  const downloadBatch = useCallback(async (contentIds: string[]) => {
    setBatchDownloadSummary(null);
    const result = await window.ponyabc.bookDownloadBatch({ contentIds });
    if (result.status === 'started') setBatchDownloadActive(true);
    return result;
  }, []);

  const cancelDownloadBatch = useCallback(async () => {
    await window.ponyabc.bookDownloadBatchCancel();
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
        verifyProgress,
        refreshCatalog,
        refreshPen: refreshList,
        add,
        replaceWithOfficial,
        reinstall,
        remove,
        cancelDownload,
        verifyContent,
        cancelVerify,
        batchDownloadActive,
        batchDownloadCounter,
        batchDownloadSummary,
        downloadBatch,
        cancelDownloadBatch,
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
