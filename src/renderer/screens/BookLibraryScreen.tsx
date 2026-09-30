import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  BookActionResult,
  BookPenMatchStatus,
  BookRemoveResult,
  BookVerifyContentResult,
} from '@shared/types';
import { resolveBookDisplayName } from '@shared/bookDisplay';
import { isSupportedLocale, DEFAULT_LOCALE } from '@shared/locales';
import { PenRootBar } from '../components/PenRootBar';
import type { Section } from '../components/NavSidebar';
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
} from './bookStatusLabels';
import { estimateMinutes, remainingMinutes, transferBytesFor } from './penTransferEstimate';
import { buildSyncPlan, checkSpace, otherBooksOnPen, ourBooksOnPen } from '@shared/bookSyncPlan';
import { formatDateTime } from '@shared/dateFormat';
import { useBookLibrary } from '../state/BookLibraryContext';

/**
 * A size for a parent: always rounded **up**, and to a round number.
 *
 * Two reasons, both about not making someone do arithmetic. "797.3 MB" is a measurement, not an
 * amount anyone acts on. And rounding DOWN would send a parent to free exactly the figure we
 * printed and be refused a second time — up is the only direction that leaves them better off
 * than the number suggested.
 */
function formatFriendlySize(bytes: number): string {
  const MB = 1024 * 1024;
  if (bytes >= 1024 * MB) return `${(Math.ceil((bytes / (1024 * MB)) * 10) / 10).toFixed(1)} GB`;
  return `${Math.ceil(bytes / MB / 100) * 100} MB`;
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

/** Names only. Nothing in the book list is ever actionable — it is there to be read. */
function BookNameList({ items, emptyLabel }: { items: readonly string[]; emptyLabel: string }) {
  if (items.length === 0) return <p className="hint">{emptyLabel}</p>;
  return (
    <ul className="book-name-list">
      {items.map((name) => (
        <li key={name}>{name}</li>
      ))}
    </ul>
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

/** True for every "something is already on the pen under this filename" state — the confirm+
 *  backup flow applies the same way whether or not it's been explicitly verified to differ,
 *  since an unverified match is never assumed safe to silently overwrite. */
export function BookLibraryScreen({ onNavigate }: { onNavigate?: (section: Section) => void } = {}) {
  const { t, i18n } = useTranslation('book');
  const penRoot = usePenRoot();
  const lib = useBookLibrary();

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Default rows are collapsed to checkbox + name + NEW + a short status — clicking the name
  // expands filename/size/official-update-date/full status/per-item actions below it.

  // One source of truth: if we have the pen's book list, the pen is connected. Reading a
  // separate pen-root status let the screen say "please connect your pen" directly above
  // "your pen has 2 books", which is the kind of contradiction a parent stops trusting.
  const penConnected = lib.penItems !== null;
  const penItems = lib.penItems ?? [];

  /**
   * Ends a sync that wrote something. The pen's book list is rebuilt whatever was written — a
   * new book or a replacement of one already there — so there is one ending for a parent to
   * learn: unplug it and switch it off and on again.
   */
  async function finishBookBatch(writtenFileNames: string[]) {
    try {
      const result = await window.ponyabc.bookIndexCommit({ writtenFileNames });
      await refreshIndexStatus();
      // 'still-pending' shows the same notice on purpose: the reset is owed and happens on the
      // next connection, and restarting the pen is the right thing to do either way. The two
      // remaining statuses mean the pen is no longer there, and the screen says so by itself.
      if (result.status === 'reset' || result.status === 'still-pending') setRestartNotice(true);
    } catch {
      setRestartNotice(true);
    }
  }

  /**
   * One button, so the decision is ours. `buildSyncPlan` is where it lives, and it is
   * deliberately outside this file: what a sync does is a rule about the product, not a detail
   * of a screen.
   */
  const plan = buildSyncPlan({ catalogItems: lib.catalogItems, penItems: lib.penItems });
  const ourBooks = ourBooksOnPen(penItems);
  const otherBooks = otherBooksOnPen(penItems);
  const hasWork = plan.toAdd.length > 0 || plan.toUpdate.length > 0;
  const syncMinutes = estimateMinutes(transferBytesFor([...plan.toAdd, ...plan.toUpdate].map((i) => i.sizeBytes)));

  // Assembled from plural-aware parts rather than one string with two counts in it: i18next can
  // pluralise on one number, and "1 new book and 2 updates" needs two.
  const news = t('sync.newBooks', { count: plan.toAdd.length });
  const updates = t('sync.updates', { count: plan.toUpdate.length });
  const availableSentence =
    plan.toAdd.length > 0 && plan.toUpdate.length > 0
      ? t('sync.availableBoth', { news, updates })
      : plan.toAdd.length > 0
        ? t('sync.availableAdds', { news })
        : t('sync.availableUpdates', { updates });
  const timeSentence = syncMinutes > 0 ? t('sync.time', { count: syncMinutes }) : t('sync.timeShort');

  /** Bytes short when the card is too small, or 'unreadable' when we could not check at all. */
  const [spaceProblem, setSpaceProblem] = useState<number | 'unreadable' | null>(null);

  /**
   * Adds everything missing and updates everything changed, one book at a time, smallest first.
   * Stops cleanly the moment the pen runs out of room: the staged file is already cleaned up by
   * the writer, what finished stays, and the index is reset only if something was actually
   * added.
   */
  async function runSync() {
    // Peak, not net: an update holds the new copy and the old one at the same time, so a sync
    // whose totals fit can still run the card out half-way through.
    const space = checkSpace({
      plan,
      penItems: lib.penItems,
      freeBytes: lib.meta.penFreeBytes,
      penTotalBytes: lib.meta.penTotalBytes,
      clusterBytes: lib.meta.penClusterBytes,
    });
    if (!space.ok) {
      // Either way nothing is written. A parent must know before the first byte whether it
      // fits — and "we could not check" is something they can act on; finding out half-way
      // through a twenty-minute copy is not.
      setSpaceProblem(space.reason === 'unreadable' ? 'unreadable' : space.shortfallBytes);
      return;
    }

    setSpaceProblem(null);
    setBusy(true);
    setMessage(null);
    setRestartNotice(false);

    try {
      const written: string[] = [];
      let ranOutOfSpace = false;
      let lastMessage: string | null = null;

      for (const item of [...plan.toAdd, ...plan.toUpdate]) {
        const isAdd = plan.toAdd.includes(item);
        const result = isAdd ? await lib.add(item.contentId) : await lib.replaceWithOfficial(item.contentId);

        if (result.status === 'completed') {
          written.push(item.filename);
          continue;
        }
        if (result.status === 'no-space') {
          ranOutOfSpace = true;
          break;
        }
        lastMessage = resultMessage(t, result);
        break;
      }

      // What was actually written, not what the plan hoped to write: a sync that filled the card
      // half-way through still wrote books, and still owes the pen a rebuilt list. A sync that
      // wrote nothing — nothing to do, or the first book failed — leaves the pen alone.
      if (written.length > 0) await finishBookBatch(written);
      if (ranOutOfSpace) setMessage(t('sync.stoppedNoSpace'));
      else if (lastMessage) setMessage(lastMessage);
    } finally {
      setBusy(false);
      setWriting(null);
      await lib.refreshPen();
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


  return (
    <div className="screen">
      <h1>{t('title')}</h1>

      {lib.meta.source === 'fixture' && <div className="note-box">{t('devFixtureBanner')}</div>}
      {lib.meta.conflicts.length > 0 && <div className="note-box">{t('ambiguousNotice', { count: lib.meta.conflicts.length })}</div>}
      {message && <p className="error-text">{message}</p>}

      {/* ------------------------------------------------------------- PEN, IN WORDS --- */}
      <p>{penConnected ? t('pen.connected') : t('pen.disconnected')}</p>

      {/* ---------------------------------------------------------------- THE SUMMARY --- */}
      <div className="book-summary">
        <p>
          {ourBooks.length > 0 ? t('sync.has', { count: ourBooks.length }) : t('sync.hasNone')}{' '}
          {hasWork ? `${availableSentence} ${timeSentence}` : t('sync.upToDate')}
        </p>

        <div className="book-summary__actions">
          <button type="button" className="button button--primary" disabled={!penConnected || !hasWork || busy} onClick={() => void runSync()}>
            {busy ? t('sync.working') : t('sync.button')}
          </button>
          <span className="hint">
            {lib.meta.fetchedAtMs !== null ? t('check.last', { time: formatDateTime(i18n.language, lib.meta.fetchedAtMs) }) : t('check.never')}
          </span>
          <button type="button" className="button" disabled={lib.refreshing || busy} onClick={() => void lib.refreshCatalog()}>
            {lib.refreshing ? t('check.checking') : t('check.button')}
          </button>
        </div>
        {!penConnected && <p className="hint">{t('sync.needPen')}</p>}
        {lib.meta.lastCheck?.state === 'error' && <p className="hint">{t('check.failed')}</p>}
      </div>

      {/* Not enough room. Said before anything starts, with the number and what to do about
          it — a parent who is told only "not enough space" has no way to act. */}
      {spaceProblem !== null && (
        <div className="note-box">
          {spaceProblem === 'unreadable' ? (
            <p className="error-text">{t('space.unreadable')}</p>
          ) : (
            <>
              <p className="error-text">{t('space.title')}</p>
              <p className="hint">{t('space.body', { amount: formatFriendlySize(spaceProblem) })}</p>
              <button type="button" className="button" onClick={() => onNavigate?.('recordings')}>
                {t('space.goToRecordings')}
              </button>
            </>
          )}
        </div>
      )}

      {/* --------------------------------------------------------------- THE BOOK LIST --- */}
      <details className="book-list">
        <summary>{t('list.toggle')}</summary>

        <h3 className="status-legend__heading">{t('list.onPen')}</h3>
        <BookNameList items={ourBooks.map((p) => displayNameFor({ friendlyName: p.friendlyName, friendlyNameI18n: p.friendlyNameI18n, filename: p.fileName }, i18n.language))} emptyLabel={t('list.none')} />

        <h3 className="status-legend__heading">{t('list.willAdd')}</h3>
        <BookNameList items={plan.toAdd.map((i) => `${displayNameFor(i, i18n.language)} · ${t('size.about', { size: formatFriendlySize(i.sizeBytes) })}`)} emptyLabel={t('list.none')} />

        <h3 className="status-legend__heading">{t('list.willUpdate')}</h3>
        <BookNameList items={plan.toUpdate.map((i) => `${displayNameFor(i, i18n.language)} · ${t('size.about', { size: formatFriendlySize(i.sizeBytes) })}`)} emptyLabel={t('list.none')} />

        {otherBooks.length > 0 && (
          <>
            <h3 className="status-legend__heading">{t('list.other')}</h3>
            <p className="hint">{t('list.otherBody')}</p>
            <BookNameList items={otherBooks.map((p) => p.fileName)} emptyLabel={t('list.none')} />
          </>
        )}
      </details>

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

      <StatusLegend t={t} showNewBadgeNote={false} />

      {/* The technical half: pen diagnostics and per-book verification. A parent never needs it;
          support always does, and it is one disclosure away rather than gone. */}
      <AdvancedDetails t={t}>
        <PenRootBar />
        {ourBooks.length > 0 && (
          <ul className="recordings-list">
            {ourBooks.map((item) => {
              const progress = item.contentId ? lib.verifyProgress[item.contentId] : undefined;
              const status = progress ? 'verifying' : item.status;
              return (
                <li key={item.fileName} className="recordings-list__row">
                  <span className="recordings-list__label">
                    <span className="recordings-list__name">{item.fileName}</span>
                  </span>
                  <span className="hint">{t(penStatusKey(status))}</span>
                  <span className="hint status-help">{t(penStatusHelpKey(status))}</span>
                  <div className="recordings-list__detail-actions">
                    <button type="button" className="button" disabled={busy || !!progress} onClick={() => void runVerify([item.fileName])}>
                      {t('action.verifyThis')}
                    </button>
                    {item.contentId && (
                      <button type="button" className="button" disabled={busy || !!progress} onClick={() => void handleReinstall(item.contentId as string)}>
                        {t('action.reinstall')}
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </AdvancedDetails>

    </div>
  );
}
