import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BookActionResult,
  BookCatalogItem,
  BookPenItem,
  BookPenMatchStatus,
  BookRemoveResult,
  BookVerifyContentResult,
} from '@shared/types';
import { resolveBookDisplayName } from '@shared/bookDisplay';
import { isRecentlyUpdated } from '@shared/bookNewBadge';
import { isSupportedLocale, DEFAULT_LOCALE } from '@shared/locales';
import { PenRootBar } from '../components/PenRootBar';
import { BookCatalogBar } from '../components/BookCatalogBar';
import { usePenRoot } from '../state/PenRootContext';
import {
  CACHE_STATUS_LABELS,
  CACHE_STATUS_LEGEND_ORDER,
  CATALOG_STATUS_LABELS,
  CATALOG_STATUS_LEGEND_ORDER,
  PEN_STATUS_LABELS,
  PEN_STATUS_LEGEND_ORDER,
  SIMPLE_STATE_LABELS,
  SIMPLE_STATE_LEGEND_ORDER,
  simpleStateForCatalog,
  simpleStateForPen,
} from './bookStatusLabels';
import { useBookLibrary } from '../state/BookLibraryContext';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function displayNameFor(source: { friendlyName: string | null; friendlyNameI18n: Record<string, string> | null; filename: string }, locale: string): string {
  const resolvedLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  return resolveBookDisplayName({ friendlyName: source.friendlyName ?? '', friendlyNameI18n: source.friendlyNameI18n, filename: source.filename }, resolvedLocale);
}

/** Recomputed against the real current clock on every render (never the local download/cache
 *  time) — this is what makes the badge disappear on its own once 14 real days pass, even
 *  entirely from an offline-cached server timestamp. */
function NewBadge({ updatedAtMs, label }: { updatedAtMs: number | null; label: string }) {
  if (!isRecentlyUpdated(updatedAtMs, Date.now())) return null;
  return <span className="new-badge">{label}</span>;
}

/**
 * Everything a parent does not need. Closed by default, and closed again on every render of a
 * newly-expanded row — the technical status, the filename, the checksum wording and the verify
 * action all live in here so the row above can answer one question: is this book on my pen.
 */
function AdvancedDetails({ t, children }: { t: (key: string) => string; children: ReactNode }) {
  return (
    <details className="advanced-details">
      <summary>{t('advanced.title')}</summary>
      <p className="hint">{t('advanced.hint')}</p>
      {children}
    </details>
  );
}

/**
 * Explains every label the screen can show, in one collapsed block that is always available —
 * not only when something unusual happens. It is driven by the same key tables as the rows, so
 * a status can never exist without an entry here.
 *
 * `<details>` rather than hover-only help: the chips carry `title` tooltips too, but a tooltip
 * is unreachable by keyboard and on a touch screen, and this screen's labels are exactly the
 * ones a confused user needs to read slowly.
 */
function StatusLegend({
  t,
  showNewBadgeNote,
}: {
  t: (key: string, opts?: Record<string, unknown>) => string;
  showNewBadgeNote: boolean;
}) {
  const rows = (entries: readonly { short: string; help: string }[]) => (
    <dl className="status-legend__list">
      {entries.map((e) => (
        <div key={e.short} className="status-legend__item">
          <dt>{t(e.short)}</dt>
          <dd>{t(e.help)}</dd>
        </div>
      ))}
    </dl>
  );

  // Rendered only while open: the legend repeats every label verbatim, and leaving that in the
  // DOM permanently would duplicate each status for find-in-page and for the accessibility tree.
  const [open, setOpen] = useState(false);

  return (
    <details className="status-legend" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>{t('legend.title')}</summary>
      {open && (
        <>
          <p className="hint">{t('legend.intro')}</p>

          {rows(SIMPLE_STATE_LEGEND_ORDER.map((s) => SIMPLE_STATE_LABELS[s]))}

          {showNewBadgeNote && <p className="hint">{t('newBadgeLegend')}</p>}

          <AdvancedDetails t={t}>
            <h3 className="status-legend__heading">{t('legend.penHeading')}</h3>
            {rows(PEN_STATUS_LEGEND_ORDER.map((s) => PEN_STATUS_LABELS[s]))}

            <h3 className="status-legend__heading">{t('legend.catalogHeading')}</h3>
            {rows(CATALOG_STATUS_LEGEND_ORDER.map((s) => CATALOG_STATUS_LABELS[s]))}

            <h3 className="status-legend__heading">{t('legend.cacheHeading')}</h3>
            {rows(CACHE_STATUS_LEGEND_ORDER.map((k) => CACHE_STATUS_LABELS[k]))}
          </AdvancedDetails>
        </>
      )}
    </details>
  );
}

function resultMessage(t: (key: string, opts?: Record<string, unknown>) => string, result: BookActionResult | BookRemoveResult): string | null {
  switch (result.status) {
    case 'completed':
      return null;
    case 'no-pen-selected':
    case 'device-disconnected':
      return t('penRequiredForWrite');
    case 'no-space':
      return t('insufficientSpace');
    case 'network-error':
      return t('downloadFailed');
    case 'cancelled':
      return t('downloadCancelled');
    case 'metadata-incomplete':
      return t('metadataIncompleteNotice');
    case 'target-changed-since-backup':
      return t('targetChangedSinceBackup');
    case 'stale-plan':
      return t('stalePlan');
    case 'backup-failed':
      return t('backupFailed');
    case 'unknown-content':
      return t('unknownContentNotice');
    default:
      return result.message ?? t('genericError');
  }
}

function verifyResultMessage(t: (key: string) => string, result: BookVerifyContentResult): string | null {
  switch (result.status) {
    case 'started':
      return null;
    case 'no-pen-selected':
    case 'device-disconnected':
      return t('penRequiredForWrite');
    case 'stale-plan':
      return t('stalePlan');
  }
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

/** True for every "something is already on the pen under this filename" state — the confirm+
 *  backup flow applies the same way whether or not it's been explicitly verified to differ,
 *  since an unverified match is never assumed safe to silently overwrite. */
function isOnPen(status: BookCatalogItem['status']): boolean {
  return (
    status === 'on-pen-present' ||
    status === 'on-pen-verifying' ||
    status === 'on-pen-current' ||
    status === 'on-pen-differs' ||
    status === 'on-pen-size-differs'
  );
}

export function BookLibraryScreen() {
  const { t, i18n } = useTranslation('book');
  const { t: tCommon } = useTranslation('common');
  const penRoot = usePenRoot();
  const lib = useBookLibrary();

  const [penSelected, setPenSelected] = useState<Set<string>>(new Set());
  const [catalogSelected, setCatalogSelected] = useState<Set<string>>(new Set());
  const [pendingRemove, setPendingRemove] = useState<BookPenItem[] | null>(null);
  const [addConflicts, setAddConflicts] = useState<BookCatalogItem[] | null>(null);
  const [addDecisions, setAddDecisions] = useState<Record<string, 'replace' | 'skip'>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Default rows are collapsed to checkbox + name + NEW + a short status — clicking the name
  // expands filename/size/official-update-date/full status/per-item actions below it.
  const [expandedPen, setExpandedPen] = useState<Set<string>>(new Set());
  const [expandedCatalog, setExpandedCatalog] = useState<Set<string>>(new Set());
  const [downloadSummaryText, setDownloadSummaryText] = useState<string | null>(null);

  const penConnected = penRoot.result.status === 'ok';
  const penItems = lib.penItems ?? [];
  const removablePenItems = penItems.filter((i) => i.removable);
  const actionableCatalogItems = lib.catalogItems.filter((i) => i.actionable);
  // "Download all to App" targets everything that could ever be cache-downloaded — broader
  // than actionableCatalogItems (which excludes on-pen-current/verifying, since there's
  // nothing to INSTALL for those, but they may still be worth having in the local cache).
  const downloadableCatalogItems = lib.catalogItems.filter((i) => i.status !== 'metadata-incomplete' && i.status !== 'ambiguous');

  function togglePen(fileName: string) {
    setPenSelected((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  }
  function toggleCatalog(contentId: string) {
    setCatalogSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contentId)) next.delete(contentId);
      else next.add(contentId);
      return next;
    });
  }
  function togglePenExpand(fileName: string) {
    setExpandedPen((prev) => {
      const next = new Set(prev);
      if (next.has(fileName)) next.delete(fileName);
      else next.add(fileName);
      return next;
    });
  }
  function toggleCatalogExpand(contentId: string) {
    setExpandedCatalog((prev) => {
      const next = new Set(prev);
      if (next.has(contentId)) next.delete(contentId);
      else next.add(contentId);
      return next;
    });
  }

  function startRemove() {
    const targets = penItems.filter((i) => penSelected.has(i.fileName));
    if (targets.length === 0) return;
    setPendingRemove(targets);
  }

  async function confirmRemove() {
    if (!pendingRemove) return;
    const targets = pendingRemove;
    setPendingRemove(null);
    setBusy(true);
    setMessage(null);
    setRestartNotice(false);
    try {
      const resolved = new Set<string>();
      let lastMessage: string | null = null;
      for (const item of targets) {
        const result = await lib.remove(item.fileName);
        if (result.status === 'completed') resolved.add(item.fileName);
        else lastMessage = resultMessage(t, result);
      }
      setPenSelected((prev) => new Set([...prev].filter((n) => !resolved.has(n))));
      if (lastMessage) setMessage(lastMessage);
      else if (resolved.size > 0) setMessage(await finishBookBatch([]));
    } finally {
      setBusy(false);
    }
  }

  function startAdd(contentIds?: string[]) {
    const wanted = contentIds ? new Set(contentIds) : catalogSelected;
    const targets = lib.catalogItems.filter((i) => wanted.has(i.contentId));
    if (targets.length === 0) return;
    const conflicts = targets.filter((i) => isOnPen(i.status));
    if (conflicts.length > 0) {
      // Remember exactly what this run is about. Re-deriving it from the checkbox selection when
      // the dialog is confirmed loses a single book added straight from its own row, and the
      // confirm then silently does nothing.
      setPendingAdd(targets);
      setAddConflicts(conflicts);
      setAddDecisions({});
      return;
    }
    void executeAdd(targets, {});
  }

  async function confirmAdd() {
    if (!addConflicts || !pendingAdd) return;
    const targets = pendingAdd;
    const decisions = addDecisions;
    setAddConflicts(null);
    setPendingAdd(null);
    setAddDecisions({});
    await executeAdd(targets, decisions);
  }

  /**
   * Ends a batch of book changes.
   *
   * The pen's book list is rebuilt only when something was added or removed — the main process
   * decides that, because it is the only side that knows whether a write created a file or
   * replaced one. Replacing a book under the same name keeps its position, so nothing is needed
   * and the parent is not told to restart for no reason.
   */
  async function finishBookBatch(writtenFileNames: string[]) {
    try {
      const result = await window.ponyabc.bookIndexCommit({ writtenFileNames });
      await refreshIndexStatus();
      // 'still-pending' gets the same message as a completed reset on purpose: the books on the
      // pen are correct either way, and the list is finished on the next connection. Telling a
      // parent that something failed when their next action — unplug and restart — is identical
      // would be alarming them about our bookkeeping.
      if (result.status === 'reset' || result.status === 'still-pending') {
        setRestartNotice(true);
        return null;
      }
      return t('done.updatedOnly');
    } catch {
      // The books were written and verified before we got here. A failure to tidy the list must
      // not turn a successful batch into an error the parent cannot act on.
      setRestartNotice(true);
      return null;
    }
  }

  async function executeAdd(targets: BookCatalogItem[], decisions: Record<string, 'replace' | 'skip'>) {
    setBusy(true);
    setMessage(null);
    setRestartNotice(false);
    try {
      const resolved = new Set<string>();
      const written: string[] = [];
      let lastMessage: string | null = null;
      for (const item of targets) {
        if (isOnPen(item.status) && decisions[item.contentId] === 'skip') {
          resolved.add(item.contentId);
          continue;
        }
        const result = isOnPen(item.status) ? await lib.replaceWithOfficial(item.contentId) : await lib.add(item.contentId);
        if (result.status === 'completed') {
          resolved.add(item.contentId);
          written.push(item.filename);
        } else lastMessage = resultMessage(t, result);
      }
      setCatalogSelected((prev) => new Set([...prev].filter((id) => !resolved.has(id))));
      // A failure part-way leaves the pen's list alone: nothing was added, so no position moved.
      // Only report it, and leave the index exactly as it was.
      if (lastMessage) setMessage(lastMessage);
      else if (written.length > 0) setMessage(await finishBookBatch(written));
    } finally {
      setBusy(false);
    }
  }

  async function handleReinstall(contentId: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await lib.reinstall(contentId);
      const msg = resultMessage(t, result);
      if (msg) setMessage(msg);
    } finally {
      setBusy(false);
    }
  }

  async function runVerify(fileNames: string[]) {
    if (fileNames.length === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await lib.verifyContent(fileNames);
      const msg = verifyResultMessage(t, result);
      if (msg) setMessage(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleDownloadBatch(contentIds: string[]) {
    if (contentIds.length === 0) return;
    setMessage(null);
    setDownloadSummaryText(null);
    await lib.downloadBatch(contentIds);
  }

  useEffect(() => {
    if (!lib.batchDownloadSummary) return;
    const s = lib.batchDownloadSummary;
    const base = t('downloadBatchSummary', { downloaded: s.downloadedCount, skipped: s.skippedCount, failed: s.failedCount });
    setDownloadSummaryText(s.cancelled ? `${base} ${t('downloadBatchCancelledSuffix')}` : base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib.batchDownloadSummary]);

  const verifyingNow = Object.keys(lib.verifyProgress).length > 0;

  /**
   * The pen's book list against what is actually on the pen. A mismatch means books were added
   * or removed outside this app — a parent dragging files in Explorer or Finder — and the
   * consequence is that the pen reads the WRONG book aloud, with nothing visibly broken.
   *
   * It is never fixed silently: we did not cause it, and the fix ends with "unplug and restart
   * your pen", which is not something to do to someone without asking.
   */
  const [indexStatus, setIndexStatus] = useState<Awaited<ReturnType<typeof window.ponyabc.bookIndexStatus>> | null>(null);
  const [fixingIndex, setFixingIndex] = useState(false);
  /** The books a pending Add/Update dialog is about — see startAdd. */
  const [pendingAdd, setPendingAdd] = useState<BookCatalogItem[] | null>(null);
  /** Shown after a batch that added or removed a book — the one thing the parent must act on. */
  const [restartNotice, setRestartNotice] = useState(false);
  const [fixMessage, setFixMessage] = useState<string | null>(null);

  const refreshIndexStatus = useCallback(async () => {
    try {
      setIndexStatus(await window.ponyabc.bookIndexStatus());
    } catch {
      setIndexStatus(null); // never let a failed check break the screen
    }
  }, []);

  useEffect(() => {
    void refreshIndexStatus();
  }, [refreshIndexStatus, penRoot.result]);

  async function handleFixIndex() {
    setFixingIndex(true);
    setFixMessage(null);
    try {
      const result = await window.ponyabc.bookIndexFix();
      setFixMessage(result.status === 'reset' ? t('fix.doneBody') : t('fix.failed'));
    } catch {
      setFixMessage(t('fix.failed'));
    } finally {
      setFixingIndex(false);
      await refreshIndexStatus();
    }
  }

  const showFixPrompt = indexStatus !== null && 'status' in indexStatus && indexStatus.status === 'mismatch';
  const showSidecarNotice =
    indexStatus !== null && 'appleDoubleFiles' in indexStatus && indexStatus.appleDoubleFiles.length > 0;

  // Short forms (`.short`) are the chip on the collapsed row; the full wording (e.g. "not yet
  // verified") appears only in the expanded detail, and `.help` — the condition that produced
  // the status — appears in the detail, as the chip's tooltip, and in the legend. All three
  // come from bookStatusLabels.ts so the legend can never fall behind the rows.
  const penStatusKey = (s: BookPenMatchStatus) => PEN_STATUS_LABELS[s].full;
  const penStatusHelpKey = (s: BookPenMatchStatus) => PEN_STATUS_LABELS[s].help;
  const catalogStatusKey = (s: BookCatalogItem['status']) => CATALOG_STATUS_LABELS[s].full;
  const catalogStatusHelpKey = (s: BookCatalogItem['status']) => CATALOG_STATUS_LABELS[s].help;
  const cacheStatusHelpKey = (item: BookCatalogItem, hasProgress: boolean): string =>
    hasProgress ? CACHE_STATUS_LABELS.downloading.help : item.cached ? CACHE_STATUS_LABELS.cached.help : CACHE_STATUS_LABELS.notDownloaded.help;
  const cacheStatusText = (item: BookCatalogItem, hasProgress: boolean): string => {
    if (hasProgress) return t('cacheStatus.downloading');
    return item.cached ? t('cacheStatus.cached') : t('cacheStatus.notDownloaded');
  };

  const now = Date.now();
  const anyNew =
    penItems.some((i) => isRecentlyUpdated(i.updatedAtMs, now)) || lib.catalogItems.some((i) => isRecentlyUpdated(i.updatedAtMs, now));

  return (
    <div className="screen">
      <h1>{t('title')}</h1>

      {lib.meta.source === 'fixture' && <div className="note-box">{t('devFixtureBanner')}</div>}
      {lib.meta.conflicts.length > 0 && <div className="note-box">{t('ambiguousNotice', { count: lib.meta.conflicts.length })}</div>}
      {message && <p className="error-text">{message}</p>}

      <div className="dual-pane">
        <section className="pane">
          <div className="pane__header">
            <PenRootBar />
            {penConnected && (
              <div className="pane__toolbar">
                <label>
                  <input
                    type="checkbox"
                    checked={removablePenItems.length > 0 && penSelected.size === removablePenItems.length}
                    onChange={() =>
                      setPenSelected(penSelected.size === removablePenItems.length ? new Set() : new Set(removablePenItems.map((i) => i.fileName)))
                    }
                  />
                  {t('selectAll')}
                </label>
                <span>{t('selectedCount', { count: penSelected.size })}</span>
                <button type="button" className="button" onClick={() => void lib.refreshPen()}>
                  {tCommon('buttons.refresh')}
                </button>
              </div>
            )}
          </div>
          <div className="pane__list">
            {!penConnected && <p className="hint">{t('penRequiredForWrite')}</p>}
            {penConnected && penItems.length === 0 && <p className="hint">{t('emptyState')}</p>}
            {penConnected && penItems.length > 0 && (
              <ul className="recordings-list">
                {penItems.map((item) => {
                  const progress = item.contentId ? lib.verifyProgress[item.contentId] : undefined;
                  const displayStatus: BookPenMatchStatus = progress ? 'verifying' : item.status;
                  const expanded = expandedPen.has(item.fileName);
                  return (
                    <li key={item.fileName} className="recordings-list__row">
                      {!item.removable ? (
                        <span className="recordings-list__label">
                          <span className="recordings-list__name" title={t(penStatusHelpKey(item.status))}>
                            {item.fileName} — {t(penStatusKey(item.status))}
                          </span>
                        </span>
                      ) : (
                        <label className="recordings-list__label">
                          <input type="checkbox" checked={penSelected.has(item.fileName)} onChange={() => togglePen(item.fileName)} />
                          <button type="button" className="recordings-list__name-toggle" onClick={() => togglePenExpand(item.fileName)}>
                            {displayNameFor({ friendlyName: item.friendlyName, friendlyNameI18n: item.friendlyNameI18n, filename: item.fileName }, i18n.language)}
                          </button>
                          <NewBadge updatedAtMs={item.updatedAtMs} label={t('newBadge')} />
                        </label>
                      )}
                      {item.removable && (
                        <span className="hint" title={t(SIMPLE_STATE_LABELS[simpleStateForPen(displayStatus)].help)}>
                          {t(SIMPLE_STATE_LABELS[simpleStateForPen(displayStatus)].short)}
                          {progress && ` (${Math.round((progress.bytesRead / Math.max(progress.totalBytes, 1)) * 100)}%)`}
                        </span>
                      )}
                      {progress && <progress className="book-progress" value={progress.bytesRead} max={Math.max(progress.totalBytes, 1)} />}
                      {item.removable && expanded && (
                        <div className="recordings-list__detail">
                          <span className="hint">{t(SIMPLE_STATE_LABELS[simpleStateForPen(displayStatus)].help)}</span>
                          <AdvancedDetails t={t}>
                            <span className="hint">{item.fileName}</span>
                            <span className="hint">{formatBytes(item.sizeBytes)}</span>
                            {item.updatedAtMs !== null && <span className="hint">{t('officialUpdated', { date: formatDate(item.updatedAtMs) })}</span>}
                            <span className="hint">{t(penStatusKey(displayStatus))}</span>
                            <span className="hint status-help">{t(penStatusHelpKey(displayStatus))}</span>
                            <div className="recordings-list__detail-actions">
                              <button type="button" className="button" disabled={busy || !!progress} onClick={() => void runVerify([item.fileName])}>
                                {t('action.verifyThis')}
                              </button>
                            </div>
                          </AdvancedDetails>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>

        <div className="dual-pane__actions">
          <button type="button" className="button button--primary" disabled={!penConnected || penSelected.size === 0 || busy} onClick={startRemove}>
            {t('action.remove')}
          </button>
          {verifyingNow ? (
            <button type="button" className="button" onClick={() => void lib.cancelVerify()}>
              {t('action.cancelVerify')}
            </button>
          ) : (
            <button type="button" className="button" disabled={!penConnected || penSelected.size === 0 || busy} onClick={() => void runVerify([...penSelected])}>
              {t('action.verifySelected')}
            </button>
          )}
          <button
            type="button"
            className="button button--primary"
            disabled={!penConnected || catalogSelected.size === 0 || busy}
            onClick={() => startAdd()}
          >
            {t('action.add')}
          </button>
        </div>

        <section className="pane">
          <div className="pane__header">
            <BookCatalogBar />
            <p className="hint">{t('catalogIntro')}</p>
            {actionableCatalogItems.length > 0 && (
              <div className="pane__toolbar">
                <label>
                  <input
                    type="checkbox"
                    checked={catalogSelected.size === actionableCatalogItems.length}
                    onChange={() =>
                      setCatalogSelected(
                        catalogSelected.size === actionableCatalogItems.length ? new Set() : new Set(actionableCatalogItems.map((i) => i.contentId)),
                      )
                    }
                  />
                  {t('selectAll')}
                </label>
                <span>{t('selectedCount', { count: catalogSelected.size })}</span>
              </div>
            )}
          </div>
          <div className="pane__list">
            {lib.catalogItems.length === 0 && <p className="hint">{t('emptyState')}</p>}
            {lib.catalogItems.length > 0 && (
              <ul className="recordings-list">
                {lib.catalogItems.map((item) => {
                  const progress = lib.downloadProgress[item.contentId];
                  const isBatchProgress = progress?.completedCount !== undefined;
                  const verifyProg = lib.verifyProgress[item.contentId];
                  const catalogDisplayStatus: BookCatalogItem['status'] = verifyProg ? 'on-pen-verifying' : item.status;
                  const expanded = expandedCatalog.has(item.contentId);
                  return (
                    <li key={item.contentId} className="recordings-list__row">
                      <div>
                        {item.actionable ? (
                          <label className="recordings-list__label">
                            <input type="checkbox" checked={catalogSelected.has(item.contentId)} onChange={() => toggleCatalog(item.contentId)} />
                            <button type="button" className="recordings-list__name-toggle" onClick={() => toggleCatalogExpand(item.contentId)}>
                              {displayNameFor(item, i18n.language)}
                            </button>
                            <NewBadge updatedAtMs={item.updatedAtMs} label={t('newBadge')} />
                          </label>
                        ) : (
                          <span className="recordings-list__label">
                            <button type="button" className="recordings-list__name-toggle" onClick={() => toggleCatalogExpand(item.contentId)}>
                              {displayNameFor(item, i18n.language)}
                            </button>
                            <NewBadge updatedAtMs={item.updatedAtMs} label={t('newBadge')} />
                          </span>
                        )}
                        <div className="hint" title={t(SIMPLE_STATE_LABELS[simpleStateForCatalog(catalogDisplayStatus, !!progress)].help)}>
                          {t(SIMPLE_STATE_LABELS[simpleStateForCatalog(catalogDisplayStatus, !!progress)].short)}
                          {verifyProg && ` (${Math.round((verifyProg.bytesRead / Math.max(verifyProg.totalBytes, 1)) * 100)}%)`}
                          {progress && ` (${Math.round((progress.bytesReceived / Math.max(progress.totalBytes, 1)) * 100)}%)`}
                        </div>
                        {progress && <progress className="book-progress" value={progress.bytesReceived} max={Math.max(progress.totalBytes, 1)} />}
                        {verifyProg && <progress className="book-progress" value={verifyProg.bytesRead} max={Math.max(verifyProg.totalBytes, 1)} />}
                        {expanded && (
                          <div className="recordings-list__detail">
                            <span className="hint">{t(SIMPLE_STATE_LABELS[simpleStateForCatalog(catalogDisplayStatus, !!progress)].help)}</span>
                            <AdvancedDetails t={t}>
                            <span className="hint">{item.filename}</span>
                            <span className="hint">{formatBytes(item.sizeBytes)}</span>
                            <span className="hint">{cacheStatusText(item, !!progress)}</span>
                            <span className="hint status-help">{t(cacheStatusHelpKey(item, !!progress))}</span>
                            <span className="hint">{t(catalogStatusKey(catalogDisplayStatus))}</span>
                            <span className="hint status-help">{t(catalogStatusHelpKey(catalogDisplayStatus))}</span>
                            {item.updatedAtMs !== null && <span className="hint">{t('officialUpdated', { date: formatDate(item.updatedAtMs) })}</span>}
                            {(item.cached || isOnPen(item.status)) && item.status !== 'ambiguous' && item.status !== 'metadata-incomplete' && (
                              <div className="recordings-list__detail-actions">
                                <button type="button" className="button" disabled={busy || !penConnected || !!verifyProg} onClick={() => void handleReinstall(item.contentId)}>
                                  {t('action.reinstall')}
                                </button>
                              </div>
                            )}
                            </AdvancedDetails>
                          </div>
                        )}
                      </div>
                      <div className="recordings-list__preview">
                        {item.actionable && !progress && !verifyProg && (
                          <button
                            type="button"
                            className="button button--primary"
                            disabled={busy || !penConnected}
                            onClick={() => void startAdd([item.contentId])}
                          >
                            {t(isOnPen(item.status) ? 'action.updateOne' : 'action.addOne')}
                          </button>
                        )}
                        {progress && !isBatchProgress && (
                          <button type="button" className="button" onClick={() => void lib.cancelDownload(item.contentId)}>
                            {t('action.cancelDownload')}
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="pane__footer">
            {lib.batchDownloadActive ? (
              <>
                <span className="hint">
                  {t('downloadBatchProgress', {
                    completed: lib.batchDownloadCounter?.completedCount ?? 0,
                    total: lib.batchDownloadCounter?.totalCount ?? 0,
                  })}
                </span>
                <button type="button" className="button" onClick={() => void lib.cancelDownloadBatch()}>
                  {t('action.cancelDownloadBatch')}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="button"
                  disabled={busy || catalogSelected.size === 0}
                  onClick={() => void handleDownloadBatch([...catalogSelected])}
                >
                  {t('action.downloadSelected')}
                </button>
                <button
                  type="button"
                  className="button"
                  disabled={busy || downloadableCatalogItems.length === 0}
                  onClick={() => void handleDownloadBatch(downloadableCatalogItems.map((i) => i.contentId))}
                >
                  {t('action.downloadAll')}
                </button>
              </>
            )}
          </div>
          {downloadSummaryText && <p className="hint">{downloadSummaryText}</p>}
        </section>
      </div>
      {restartNotice && (
        <div className="note-box">
          <p>{t('done.restartTitle')}</p>
          <p className="hint">{t('done.restartBody')}</p>
        </div>
      )}

      {showFixPrompt && (
        <div className="note-box">
          <p>{t('fix.title')}</p>
          <p className="hint">{t('fix.body')}</p>
          {showSidecarNotice && <p className="hint">{t('fix.sidecarNotice')}</p>}
          <button type="button" className="button button--primary" disabled={fixingIndex || busy} onClick={() => void handleFixIndex()}>
            {fixingIndex ? t('fix.working') : t('fix.button')}
          </button>
        </div>
      )}
      {fixMessage && <p className="hint">{fixMessage}</p>}

      <StatusLegend t={t} showNewBadgeNote={anyNew} />

      {pendingRemove && (
        <div className="plan-panel">
          <h2>{t('confirmRemoveTitle')}</h2>
          <ul className="recordings-list">
            {pendingRemove.map((item) => (
              <li key={item.fileName}>
                {displayNameFor({ friendlyName: item.friendlyName, friendlyNameI18n: item.friendlyNameI18n, filename: item.fileName }, i18n.language)}{' '}
                <span className="hint">({item.fileName})</span> <span className="recordings-list__size">{formatBytes(item.sizeBytes)}</span>
              </li>
            ))}
          </ul>
          <p className="hint">{t('confirmRemoveHint')}</p>
          <div className="plan-panel__actions">
            <button type="button" className="button" onClick={() => setPendingRemove(null)}>
              {t('cancel')}
            </button>
            <button type="button" className="button button--primary" onClick={() => void confirmRemove()}>
              {t('confirmRemoveAction')}
            </button>
          </div>
        </div>
      )}

      {addConflicts && (
        <div className="plan-panel">
          <h2>{t('confirmAddTitle')}</h2>
          <p className="hint">{t('addConflictsHint')}</p>
          <ul className="recordings-list">
            {addConflicts.map((item) => (
              <li key={item.contentId}>
                <div>{displayNameFor(item, i18n.language)}</div>
                <label>
                  <input
                    type="radio"
                    name={`add-decision-${item.contentId}`}
                    checked={addDecisions[item.contentId] === 'replace'}
                    onChange={() => setAddDecisions((prev) => ({ ...prev, [item.contentId]: 'replace' }))}
                  />
                  {t('replaceOption')}
                </label>
                <label>
                  <input
                    type="radio"
                    name={`add-decision-${item.contentId}`}
                    checked={addDecisions[item.contentId] === 'skip'}
                    onChange={() => setAddDecisions((prev) => ({ ...prev, [item.contentId]: 'skip' }))}
                  />
                  {t('skipOption')}
                </label>
              </li>
            ))}
          </ul>
          <div className="plan-panel__actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                setAddConflicts(null);
                setAddDecisions({});
                setPendingAdd(null);
              }}
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={addConflicts.some((c) => !addDecisions[c.contentId])}
              onClick={() => void confirmAdd()}
            >
              {t('confirmAddAction')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
