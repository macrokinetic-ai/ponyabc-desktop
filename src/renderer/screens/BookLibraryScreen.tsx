import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { BookActionResult, BookItemStatus, BookLibraryItem, BookRemoveResult } from '@shared/types';
import { resolveBookDisplayName } from '@shared/bookDisplay';
import { isSupportedLocale, DEFAULT_LOCALE } from '@shared/locales';
import { usePenRoot } from '../state/PenRootContext';
import { useBookLibrary } from '../state/BookLibraryContext';

function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.round(n / 1024)} KB`;
}

const STATUS_KEY: Record<BookItemStatus, string> = {
  'catalog-not-cached': 'status.notCached',
  'catalog-cached-current': 'status.cachedCurrent',
  'catalog-cached-stale': 'status.cachedStale',
  'on-pen-current': 'status.onPenCurrent',
  'on-pen-differs-from-official': 'status.differsFromOfficial',
  'on-pen-hash-unknown': 'status.hashUnknown',
  'not-in-catalog': 'status.notInCatalog',
  'catalog-incomplete-metadata': 'status.metadataIncomplete',
  'catalog-ambiguous': 'status.ambiguous',
};

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
    default:
      return result.message ?? t('genericError');
  }
}

function displayNameFor(item: BookLibraryItem, locale: string): string {
  if (item.contentId === null) return item.filename;
  const resolvedLocale = isSupportedLocale(locale) ? locale : DEFAULT_LOCALE;
  return resolveBookDisplayName({ friendlyName: item.friendlyName ?? '', friendlyNameI18n: item.friendlyNameI18n, filename: item.filename }, resolvedLocale);
}

export function BookLibraryScreen() {
  const { t, i18n } = useTranslation('book');
  const penRoot = usePenRoot();
  const lib = useBookLibrary();
  const [pendingRemove, setPendingRemove] = useState<BookLibraryItem | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const penConnected = penRoot.result.status === 'ok';

  async function run(key: string, action: () => Promise<BookActionResult | BookRemoveResult>) {
    setBusyKey(key);
    setMessage(null);
    try {
      const result = await action();
      const msg = resultMessage(t, result);
      if (msg) setMessage(msg);
    } finally {
      setBusyKey(null);
    }
  }

  const catalogued = lib.items.filter((i) => i.contentId !== null);
  const notInCatalog = lib.items.filter((i) => i.contentId === null);

  return (
    <div className="screen">
      <h1>{t('title')}</h1>

      <div className="book-toolbar">
        <button type="button" className="button" onClick={() => void lib.refreshCatalog()} disabled={lib.refreshing}>
          {lib.refreshing ? t('refreshing') : t('refresh')}
        </button>
        <span className="hint">
          {lib.meta.fetchedAtMs ? t('lastUpdated', { time: new Date(lib.meta.fetchedAtMs).toLocaleString() }) : t('neverUpdated')}
        </span>
      </div>

      {lib.meta.offline && <div className="note-box">{t('catalogUnavailable')}</div>}
      {lib.meta.source === 'fixture' && <div className="note-box">{t('devFixtureBanner')}</div>}
      {lib.meta.conflicts.length > 0 && <div className="note-box">{t('ambiguousNotice', { count: lib.meta.conflicts.length })}</div>}
      {!penConnected && <p className="hint">{t('penRequiredForWrite')}</p>}
      {message && <p className="error-text">{message}</p>}

      <p className="hint">{t('noExportHint')}</p>

      <h2>{t('catalogSectionTitle')}</h2>
      {catalogued.length === 0 && <p className="hint">{t('noItems')}</p>}
      <ul className="recordings-list">
        {catalogued.map((item) => {
          const key = item.contentId as string;
          const progress = lib.downloadProgress[key];
          return (
            <li key={key} className="recordings-list__row">
              <div>
                <div className="recordings-list__label">
                  <span className="recordings-list__name">{displayNameFor(item, i18n.language)}</span>{' '}
                  <span className="recordings-list__size">{formatBytes(item.sizeBytes)}</span>
                </div>
                <div className="hint">{t(STATUS_KEY[item.status])}</div>
                {progress && (
                  <progress className="book-progress" value={progress.bytesReceived} max={Math.max(progress.totalBytes, 1)} />
                )}
              </div>
              <div className="recordings-list__preview">
                {item.availableActions.includes('add') && (
                  <button type="button" className="button" disabled={!penConnected || busyKey === key} onClick={() => void run(key, () => lib.add(key))}>
                    {t('action.add')}
                  </button>
                )}
                {item.availableActions.includes('replace') && (
                  <button
                    type="button"
                    className="button"
                    disabled={!penConnected || busyKey === key}
                    onClick={() => void run(key, () => lib.replaceWithOfficial(key))}
                  >
                    {t('action.replace')}
                  </button>
                )}
                {item.availableActions.includes('reinstall') && (
                  <button
                    type="button"
                    className="button"
                    disabled={!penConnected || busyKey === key}
                    onClick={() => void run(key, () => lib.reinstall(key))}
                  >
                    {t('action.reinstall')}
                  </button>
                )}
                {item.availableActions.includes('remove') && (
                  <button type="button" className="button" disabled={!penConnected || busyKey === key} onClick={() => setPendingRemove(item)}>
                    {t('action.remove')}
                  </button>
                )}
                {progress && (
                  <button type="button" className="button" onClick={() => void lib.cancelDownload(key)}>
                    {t('action.cancelDownload')}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <h2>{t('notInCatalogSection')}</h2>
      {notInCatalog.length === 0 && <p className="hint">{t('noItems')}</p>}
      <ul className="recordings-list">
        {notInCatalog.map((item) => (
          <li key={item.filename} className="recordings-list__row">
            <div>
              <div className="recordings-list__label">
                <span className="recordings-list__name">{item.filename}</span>{' '}
                <span className="recordings-list__size">{formatBytes(item.sizeBytes)}</span>
              </div>
              <div className="hint">{t(STATUS_KEY[item.status])}</div>
            </div>
            <div className="recordings-list__preview">
              <button
                type="button"
                className="button"
                disabled={!penConnected || busyKey === item.filename}
                onClick={() => setPendingRemove(item)}
              >
                {t('action.remove')}
              </button>
            </div>
          </li>
        ))}
      </ul>

      {pendingRemove && (
        <div className="note-box">
          <p>{t('confirmRemoveBody', { fileName: pendingRemove.filename, freedSpace: formatBytes(pendingRemove.sizeBytes) })}</p>
          <button type="button" className="button" onClick={() => setPendingRemove(null)}>
            {t('cancel')}
          </button>
          <button
            type="button"
            className="button button--primary"
            onClick={() => {
              const target = pendingRemove;
              setPendingRemove(null);
              void run(target.filename, () => lib.remove(target.filename));
            }}
          >
            {t('confirmRemoveAction')}
          </button>
        </div>
      )}

      <h2>{t('backupsSection')}</h2>
      {lib.backups.length === 0 && <p className="hint">{t('noBackups')}</p>}
      <ul className="recordings-list">
        {lib.backups.map((b) => (
          <li key={b.backupId} className="recordings-list__row">
            <div>
              <div className="recordings-list__label">
                <span className="recordings-list__name">{b.originalFileName}</span>{' '}
                <span className="recordings-list__size">{formatBytes(b.sizeBytes)}</span>
              </div>
              <div className="hint">{new Date(b.createdAtMs).toLocaleString()}</div>
            </div>
            <div className="recordings-list__preview">
              <button
                type="button"
                className="button"
                disabled={!penConnected || busyKey === b.backupId}
                onClick={() => void run(b.backupId, () => lib.restore(b.backupId))}
              >
                {t('action.restore')}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
