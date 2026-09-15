import { useState } from 'react';
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

  const penConnected = penRoot.result.status === 'ok';
  const penItems = lib.penItems ?? [];
  const removablePenItems = penItems.filter((i) => i.removable);
  const actionableCatalogItems = lib.catalogItems.filter((i) => i.actionable);

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
    } finally {
      setBusy(false);
    }
  }

  function startAdd() {
    const targets = lib.catalogItems.filter((i) => catalogSelected.has(i.contentId));
    if (targets.length === 0) return;
    const conflicts = targets.filter((i) => isOnPen(i.status));
    if (conflicts.length > 0) {
      setAddConflicts(conflicts);
      setAddDecisions({});
      return;
    }
    void executeAdd(targets, {});
  }

  async function confirmAdd() {
    if (!addConflicts) return;
    const targets = lib.catalogItems.filter((i) => catalogSelected.has(i.contentId));
    const decisions = addDecisions;
    setAddConflicts(null);
    setAddDecisions({});
    await executeAdd(targets, decisions);
  }

  async function executeAdd(targets: BookCatalogItem[], decisions: Record<string, 'replace' | 'skip'>) {
    setBusy(true);
    setMessage(null);
    try {
      const resolved = new Set<string>();
      let lastMessage: string | null = null;
      for (const item of targets) {
        if (isOnPen(item.status) && decisions[item.contentId] === 'skip') {
          resolved.add(item.contentId);
          continue;
        }
        const result = isOnPen(item.status) ? await lib.replaceWithOfficial(item.contentId) : await lib.add(item.contentId);
        if (result.status === 'completed') resolved.add(item.contentId);
        else lastMessage = resultMessage(t, result);
      }
      setCatalogSelected((prev) => new Set([...prev].filter((id) => !resolved.has(id))));
      if (lastMessage) setMessage(lastMessage);
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

  async function handleVerify() {
    if (penSelected.size === 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await lib.verifyContent([...penSelected]);
      const msg = verifyResultMessage(t, result);
      if (msg) setMessage(msg);
    } finally {
      setBusy(false);
    }
  }

  const verifyingNow = Object.keys(lib.verifyProgress).length > 0;

  const penStatusKey: Record<BookPenMatchStatus, string> = {
    present: 'status.present',
    verifying: 'status.verifying',
    'verified-current': 'status.verifiedCurrent',
    'verified-differs': 'status.verifiedDiffers',
    'size-differs': 'status.sizeDiffers',
    'matched-hash-unknown': 'status.matchedHashUnknown',
    'awaiting-catalog': 'status.awaitingCatalog',
    unknown: 'status.unknown',
  };
  const catalogStatusKey: Record<BookCatalogItem['status'], string> = {
    'not-on-pen': 'status.notOnPen',
    'on-pen-present': 'status.onPenPresent',
    'on-pen-current': 'status.onPenCurrent',
    'on-pen-differs': 'status.onPenDiffers',
    'on-pen-size-differs': 'status.onPenSizeDiffers',
    'on-pen-verifying': 'status.onPenVerifying',
    'metadata-incomplete': 'status.metadataIncomplete',
    ambiguous: 'status.ambiguous',
  };
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
                  return (
                    <li key={item.fileName} className="recordings-list__row">
                      {!item.removable ? (
                        <span className="recordings-list__label">
                          <span className="recordings-list__name">
                            {item.fileName} — {t(penStatusKey[item.status])}
                          </span>
                        </span>
                      ) : (
                        <label className="recordings-list__label">
                          <input type="checkbox" checked={penSelected.has(item.fileName)} onChange={() => togglePen(item.fileName)} />
                          <span className="recordings-list__name">{displayNameFor({ friendlyName: item.friendlyName, friendlyNameI18n: item.friendlyNameI18n, filename: item.fileName }, i18n.language)}</span>
                          <NewBadge updatedAtMs={item.updatedAtMs} label={t('newBadge')} />
                          <span className="hint">({item.fileName})</span>
                        </label>
                      )}
                      <span className="recordings-list__size">{formatBytes(item.sizeBytes)}</span>
                      {item.removable && (
                        <span className="hint">
                          {t(penStatusKey[displayStatus])}
                          {progress && ` (${Math.round((progress.bytesRead / Math.max(progress.totalBytes, 1)) * 100)}%)`}
                        </span>
                      )}
                      {item.removable && item.updatedAtMs !== null && <span className="hint">{t('officialUpdated', { date: formatDate(item.updatedAtMs) })}</span>}
                      {progress && <progress className="book-progress" value={progress.bytesRead} max={Math.max(progress.totalBytes, 1)} />}
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
            <button type="button" className="button" disabled={!penConnected || penSelected.size === 0 || busy} onClick={() => void handleVerify()}>
              {t('action.verifySelected')}
            </button>
          )}
          <button
            type="button"
            className="button button--primary"
            disabled={!penConnected || catalogSelected.size === 0 || busy}
            onClick={startAdd}
          >
            {t('action.add')}
          </button>
        </div>

        <section className="pane">
          <div className="pane__header">
            <BookCatalogBar />
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
                  const verifyProg = lib.verifyProgress[item.contentId];
                  const catalogDisplayStatus: BookCatalogItem['status'] = verifyProg ? 'on-pen-verifying' : item.status;
                  return (
                    <li key={item.contentId} className="recordings-list__row">
                      <div>
                        {item.actionable ? (
                          <label className="recordings-list__label">
                            <input type="checkbox" checked={catalogSelected.has(item.contentId)} onChange={() => toggleCatalog(item.contentId)} />
                            <span className="recordings-list__name">{displayNameFor(item, i18n.language)}</span>
                            <NewBadge updatedAtMs={item.updatedAtMs} label={t('newBadge')} />
                          </label>
                        ) : (
                          <span className="recordings-list__label">
                            <span className="recordings-list__name">{displayNameFor(item, i18n.language)}</span>
                            <NewBadge updatedAtMs={item.updatedAtMs} label={t('newBadge')} />
                          </span>
                        )}
                        <div className="hint">
                          {formatBytes(item.sizeBytes)} · {cacheStatusText(item, !!progress)} · {t(catalogStatusKey[catalogDisplayStatus])}
                          {verifyProg && ` (${Math.round((verifyProg.bytesRead / Math.max(verifyProg.totalBytes, 1)) * 100)}%)`}
                        </div>
                        {item.updatedAtMs !== null && <div className="hint">{t('officialUpdated', { date: formatDate(item.updatedAtMs) })}</div>}
                        {progress && <progress className="book-progress" value={progress.bytesReceived} max={Math.max(progress.totalBytes, 1)} />}
                        {verifyProg && <progress className="book-progress" value={verifyProg.bytesRead} max={Math.max(verifyProg.totalBytes, 1)} />}
                      </div>
                      <div className="recordings-list__preview">
                        {(item.cached || isOnPen(item.status)) && item.status !== 'ambiguous' && item.status !== 'metadata-incomplete' && (
                          <button type="button" className="button" disabled={busy || !penConnected || !!verifyProg} onClick={() => void handleReinstall(item.contentId)}>
                            {t('action.reinstall')}
                          </button>
                        )}
                        {progress && (
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
        </section>
      </div>
      {anyNew && <p className="hint">{t('newBadgeLegend')}</p>}

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
