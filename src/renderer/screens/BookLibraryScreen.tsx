import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BookActionResult,
  BookCatalogItem,
  BookPenMatchStatus,
  BookRemoveResult,
  BookVerifyContentResult,
} from '@shared/types';
import { resolveBookDisplayName } from '@shared/bookDisplay';
import { isSupportedLocale, DEFAULT_LOCALE } from '@shared/locales';
import { PenRootBar } from '../components/PenRootBar';
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
} from './bookStatusLabels';
import { estimateMinutes, remainingMinutes, transferBytesFor } from './penTransferEstimate';
import { computeNewIds, readSeenIds, writeSeenIds } from './newBookIds';
import { useBookLibrary } from '../state/BookLibraryContext';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

function displayNameFor(source: { friendlyName: string | null; friendlyNameI18n: Record<string, string> | null; filename: string }, locale: string): string {
  const resolvedLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  return resolveBookDisplayName({ friendlyName: source.friendlyName ?? '', friendlyNameI18n: source.friendlyNameI18n, filename: source.filename }, resolvedLocale);
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
  const penRoot = usePenRoot();
  const lib = useBookLibrary();

  const [catalogSelected, setCatalogSelected] = useState<Set<string>>(new Set());
  const [addConflicts, setAddConflicts] = useState<BookCatalogItem[] | null>(null);
  const [addDecisions, setAddDecisions] = useState<Record<string, 'replace' | 'skip'>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Default rows are collapsed to checkbox + name + NEW + a short status — clicking the name
  // expands filename/size/official-update-date/full status/per-item actions below it.
  const [expandedPen, setExpandedPen] = useState<Set<string>>(new Set());
  const [expandedCatalog, setExpandedCatalog] = useState<Set<string>>(new Set());

  const penConnected = penRoot.result.status === 'ok';
  const penItems = lib.penItems ?? [];

  /**
   * The screen answers three questions in order: what is on your pen, what could be, and how
   * long adding it would take. Everything below is that split — and nothing in it can remove a
   * book, because removal is the library's decision, not a parent's.
   */
  const catalogById = new Map(lib.catalogItems.map((i) => [i.contentId, i]));

  /** Books on the pen that came from us — the only ones we will ever touch. */
  const ownBooks = penItems
    .filter((p) => p.contentId !== null)
    .map((pen) => ({ pen, catalog: pen.contentId ? (catalogById.get(pen.contentId) ?? null) : null }));

  /** Books on the pen that did not. Counted, named once, never acted on. */
  const otherBooks = penItems.filter((p) => p.contentId === null);

  /** Catalogue books that are not on the pen. A book on the pen can never appear here. */
  const onPenContentIds = new Set(penItems.map((p) => p.contentId).filter((id): id is string => id !== null));
  const addableBooks = lib.catalogItems.filter((i) => !onPenContentIds.has(i.contentId) && i.status === 'not-on-pen');

  /**
   * Which books are new *to this parent*. Computed once per catalogue change and remembered
   * immediately, so a book is badged exactly once — see newBookIds.ts for why that is the
   * useful meaning of "new".
   */
  const [newIds, setNewIds] = useState<Set<string>>(new Set());
  const catalogIdsKey = lib.catalogItems.map((i) => i.contentId).join(',');
  useEffect(() => {
    const ids = catalogIdsKey === '' ? [] : catalogIdsKey.split(',');
    if (ids.length === 0) return;
    const { newIds: fresh, nextSeen } = computeNewIds(ids, readSeenIds());
    setNewIds(fresh);
    writeSeenIds(nextSeen);
  }, [catalogIdsKey]);

  const selectedMinutes = estimateMinutes(
    transferBytesFor(lib.catalogItems.filter((i) => catalogSelected.has(i.contentId)).map((i) => i.sizeBytes)),
  );
  // "Download all to App" targets everything that could ever be cache-downloaded — broader
  // than actionableCatalogItems (which excludes on-pen-current/verifying, since there's
  // nothing to INSTALL for those, but they may still be worth having in the local cache).

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

    // Say how long this will take BEFORE it starts, not after. A parent deciding whether to begin
    // a twenty-minute copy needs the number while they can still choose.
    const willWrite = targets.filter((i) => !(isOnPen(i.status) && decisions[i.contentId] === 'skip'));
    // Each book is written, then partly read back to verify it — so the estimate counts both.
    const minutes = estimateMinutes(transferBytesFor(willWrite.map((i) => i.sizeBytes)));
    setMessage(minutes > 0 ? t('transfer.estimateBefore', { minutes }) : t('transfer.estimateBeforeShort'));

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
      setWriting(null);
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

  /**
   * Writing to the pen, at the pen's own speed.
   *
   * The USB is 1.x — 978 kB/s measured — so a single book is minutes, not seconds. Without an
   * estimate up front and a visible count-down, a working copy is indistinguishable from a hang,
   * and a parent who unplugs mid-write leaves a half-written book on a FAT volume.
   */
  const [writing, setWriting] = useState<{ name: string; bytesWritten: number; totalBytes: number; startedAtMs: number } | null>(null);

  useEffect(() => {
    return window.ponyabc.onBookWriteProgress((event) => {
      setWriting((prev) => ({
        name: event.filename,
        bytesWritten: event.bytesWritten,
        totalBytes: event.totalBytes,
        // Only restart the clock when a different book starts, or every update would reset the
        // elapsed time and the estimate would never settle.
        startedAtMs: prev && prev.name === event.filename ? prev.startedAtMs : Date.now(),
      }));
    });
  }, []);
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

  // The NEW badge now means "new to you", not "recently published" — so the legend note about
  // it is shown exactly when a badge is on screen.
  const anyNew = newIds.size > 0;

  return (
    <div className="screen">
      <h1>{t('title')}</h1>

      {lib.meta.source === 'fixture' && <div className="note-box">{t('devFixtureBanner')}</div>}
      {lib.meta.conflicts.length > 0 && <div className="note-box">{t('ambiguousNotice', { count: lib.meta.conflicts.length })}</div>}
      {message && <p className="error-text">{message}</p>}

      <div className="pane__header">
        <PenRootBar />
      </div>

      {/* ------------------------------------------------------ CHECK FOR NEW BOOKS --- */}
      <div className="book-check">
        <button type="button" className="button" disabled={lib.refreshing} onClick={() => void lib.refreshCatalog()}>
          {lib.refreshing ? t('check.checking') : t('check.button')}
        </button>
        <span className="hint">
          {lib.meta.fetchedAtMs !== null ? t('check.last', { time: new Date(lib.meta.fetchedAtMs).toLocaleString(i18n.language) }) : t('check.never')}
        </span>
      </div>
      {/* A parent needs to know the check failed — otherwise "not checked yet" is all they see,
          with no reason and nothing to do about it. */}
      {lib.meta.lastCheck?.state === 'error' && <p className="hint">{t('check.failed')}</p>}

      {/* ---------------------------------------------------------------- YOUR BOOKS --- */}
      <section className="book-section">
        <h2>{t('yourBooks.title')}</h2>
        <p className="hint">{t('yourBooks.intro')}</p>

        {!penConnected && <p className="hint">{t('penRequired')}</p>}
        {penConnected && ownBooks.length === 0 && otherBooks.length === 0 && <p className="hint">{t('yourBooks.empty')}</p>}

        {penConnected && ownBooks.length > 0 && (
          <ul className="recordings-list">
            {ownBooks.map(({ pen, catalog }) => {
              const verifying = pen.contentId ? lib.verifyProgress[pen.contentId] : undefined;
              const updating = catalog ? !!lib.downloadProgress[catalog.contentId] : false;
              const needsUpdate = catalog?.status === 'on-pen-differs' || catalog?.status === 'on-pen-size-differs';
              const expanded = expandedPen.has(pen.fileName);
              return (
                <li key={pen.fileName} className="recordings-list__row">
                  <span className="recordings-list__label">
                    <button type="button" className="recordings-list__name-toggle" onClick={() => togglePenExpand(pen.fileName)}>
                      {displayNameFor({ friendlyName: pen.friendlyName, friendlyNameI18n: pen.friendlyNameI18n, filename: pen.fileName }, i18n.language)}
                    </button>
                  </span>
                  <span className="hint">
                    {verifying ? t('yourBooks.checking') : updating ? t('yourBooks.updating') : needsUpdate ? t('yourBooks.updateAvailable') : t('yourBooks.upToDate')}
                  </span>
                  {needsUpdate && catalog && !updating && (
                    <button
                      type="button"
                      className="button button--primary"
                      disabled={busy || !penConnected}
                      onClick={() => startAdd([catalog.contentId])}
                    >
                      {t('yourBooks.update')}
                    </button>
                  )}
                  {expanded && (
                    <div className="recordings-list__detail">
                      <span className="hint">{formatBytes(pen.sizeBytes)}</span>
                      {pen.updatedAtMs !== null && <span className="hint">{t('officialUpdated', { date: formatDate(pen.updatedAtMs) })}</span>}
                      <AdvancedDetails t={t}>
                        <span className="hint">{pen.fileName}</span>
                        <span className="hint">{t(penStatusKey(verifying ? 'verifying' : pen.status))}</span>
                        <span className="hint status-help">{t(penStatusHelpKey(verifying ? 'verifying' : pen.status))}</span>
                        <div className="recordings-list__detail-actions">
                          <button type="button" className="button" disabled={busy || !!verifying} onClick={() => void runVerify([pen.fileName])}>
                            {t('action.verifyThis')}
                          </button>
                          {catalog && (
                            <button type="button" className="button" disabled={busy || !!verifying} onClick={() => void handleReinstall(catalog.contentId)}>
                              {t('action.reinstall')}
                            </button>
                          )}
                        </div>
                      </AdvancedDetails>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        {/* Books we did not put there. Named once, counted, and left completely alone — they
            are the customer's, and offering to touch them would be offering to break them. */}
        {penConnected && otherBooks.length > 0 && (
          <div className="note-box">
            <p>{t('otherBooks.title')}</p>
            <p className="hint">{t('otherBooks.body')}</p>
            <p className="hint">{t('otherBooks.count', { count: otherBooks.length })}</p>
          </div>
        )}
      </section>

      {/* ----------------------------------------------------------------- NEW BOOKS --- */}
      <section className="book-section">
        <h2>{t('newBooks.title')}</h2>
        <p className="hint">{t('newBooks.intro')}</p>

        {addableBooks.length === 0 && <p className="hint">{t('newBooks.empty')}</p>}
        {addableBooks.length > 0 && (
          <ul className="recordings-list">
            {addableBooks.map((item) => {
              const progress = lib.downloadProgress[item.contentId];
              const expanded = expandedCatalog.has(item.contentId);
              const minutes = estimateMinutes(transferBytesFor([item.sizeBytes]));
              return (
                <li key={item.contentId} className="recordings-list__row">
                  <label className="recordings-list__label">
                    <input
                      type="checkbox"
                      checked={catalogSelected.has(item.contentId)}
                      disabled={!item.actionable}
                      onChange={() => toggleCatalog(item.contentId)}
                    />
                    <button type="button" className="recordings-list__name-toggle" onClick={() => toggleCatalogExpand(item.contentId)}>
                      {displayNameFor(item, i18n.language)}
                    </button>
                    {newIds.has(item.contentId) && <span className="new-badge">{t('newBooks.badge')}</span>}
                  </label>
                  <span className="hint">
                    {formatBytes(item.sizeBytes)} · {minutes > 0 ? t('estimate.minutes', { minutes }) : t('estimate.short')}
                  </span>
                  {progress && <progress className="book-progress" value={progress.bytesReceived} max={Math.max(progress.totalBytes, 1)} />}
                  {expanded && (
                    <div className="recordings-list__detail">
                      <span className="hint">{t(SIMPLE_STATE_LABELS[simpleStateForCatalog(item.status, !!progress)].help)}</span>
                      <AdvancedDetails t={t}>
                        <span className="hint">{item.filename}</span>
                        <span className="hint">{cacheStatusText(item, !!progress)}</span>
                        <span className="hint status-help">{t(cacheStatusHelpKey(item, !!progress))}</span>
                        <span className="hint">{t(catalogStatusKey(item.status))}</span>
                        <span className="hint status-help">{t(catalogStatusHelpKey(item.status))}</span>
                        {item.updatedAtMs !== null && <span className="hint">{t('officialUpdated', { date: formatDate(item.updatedAtMs) })}</span>}
                      </AdvancedDetails>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* -------------------------------------------------------------------- FOOTER --- */}
      <div className="book-footer">
        <span className="hint">
          {catalogSelected.size === 0
            ? t('footer.none')
            : selectedMinutes > 0
              ? t('footer.selected', { count: catalogSelected.size, minutes: selectedMinutes })
              : t('footer.selectedShort', { count: catalogSelected.size })}
        </span>
        <button
          type="button"
          className="button button--primary"
          disabled={!penConnected || catalogSelected.size === 0 || busy}
          onClick={() => startAdd()}
        >
          {t('footer.add')}
        </button>
      </div>

      {writing && (
        <div className="note-box">
          <p>{t('transfer.dontUnplug')}</p>
          <p className="hint">{t('transfer.dontUnplugBody')}</p>
          <p className="hint">{t('transfer.writing', { name: writing.name })}</p>
          <progress className="book-progress" value={writing.bytesWritten} max={Math.max(writing.totalBytes, 1)} />
          <p className="hint">
            {(() => {
              const left = remainingMinutes(writing.bytesWritten, writing.totalBytes, Date.now() - writing.startedAtMs);
              return left > 0 ? t('transfer.remaining', { minutes: left }) : t('transfer.remainingShort');
            })()}
          </p>
        </div>
      )}

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
