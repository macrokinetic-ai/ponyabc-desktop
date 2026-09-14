import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type {
  BookActionResult,
  BookBackupSummary,
  BookDownloadProgressEvent,
  BookLibraryItem,
  BookLibraryMeta,
  BookRemoveResult,
} from '@shared/types';
import { usePenRoot } from './PenRootContext';

interface BookLibraryState {
  items: BookLibraryItem[];
  meta: BookLibraryMeta;
  backups: BookBackupSummary[];
  loading: boolean;
  refreshing: boolean;
  /** Real byte-based progress for an in-flight download, keyed by contentId. */
  downloadProgress: Record<string, BookDownloadProgressEvent>;
  refreshCatalog: () => Promise<void>;
  add: (contentId: string) => Promise<BookActionResult>;
  replaceWithOfficial: (contentId: string) => Promise<BookActionResult>;
  reinstall: (contentId: string) => Promise<BookActionResult>;
  remove: (fileName: string) => Promise<BookRemoveResult>;
  restore: (backupId: string) => Promise<BookActionResult>;
  cancelDownload: (contentId: string) => Promise<void>;
}

const emptyMeta: BookLibraryMeta = { fetchedAtMs: null, source: 'none', offline: true, conflicts: [] };

const BookLibraryContext = createContext<BookLibraryState | null>(null);

export function BookLibraryProvider({ children }: { children: ReactNode }) {
  const penRoot = usePenRoot();
  const [items, setItems] = useState<BookLibraryItem[]>([]);
  const [meta, setMeta] = useState<BookLibraryMeta>(emptyMeta);
  const [backups, setBackups] = useState<BookBackupSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, BookDownloadProgressEvent>>({});
  const penGenerationRef = useRef(-1);
  penGenerationRef.current = penRoot.result.status === 'ok' ? penRoot.result.generation : -1;

  const applyList = useCallback((result: { items: BookLibraryItem[]; meta: BookLibraryMeta }) => {
    setItems(result.items);
    setMeta(result.meta);
  }, []);

  const refreshList = useCallback(async () => {
    const [result, backupList] = await Promise.all([window.ponyabc.bookList(), window.ponyabc.bookBackups()]);
    applyList(result);
    setBackups(backupList);
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

  const restore = useCallback(
    async (backupId: string) => {
      const result = await window.ponyabc.bookRestore({ backupId, penGeneration: penGenerationRef.current });
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
      value={{ items, meta, backups, loading, refreshing, downloadProgress, refreshCatalog, add, replaceWithOfficial, reinstall, remove, restore, cancelDownload }}
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
