import { useTranslation } from 'react-i18next';
import { useBookLibrary } from '../state/BookLibraryContext';

/**
 * Right pane's status bar, structurally mirroring PenRootBar/ComputerFolderBar (same
 * `.pen-root-bar` box, `__info` + `__actions` layout) so BOOK's left/right split reads as one
 * consistent pattern with My Recordings — this one just has no folder-picker button, since
 * BOOK has no computer-destination concept. Never relies on color alone: every state also
 * carries a text label, and "connected but the catalog is empty" is never worded like a
 * failure.
 */
export function BookCatalogBar() {
  const { t } = useTranslation('book');
  const lib = useBookLibrary();
  const { meta, refreshing } = lib;

  const state: 'checking' | 'ok' | 'error' = refreshing || !meta.lastCheck ? 'checking' : meta.lastCheck.state;
  const dotClass = state === 'ok' ? 'status-dot--green' : state === 'error' ? 'status-dot--red' : 'status-dot--grey';

  return (
    <div className="pen-root-bar">
      <div className="pen-root-bar__info">
        <span className="pen-root-bar__label">{t('connection.label')}:</span>{' '}
        <span className={`status-dot ${dotClass}`} aria-hidden="true" />
        {state === 'checking' && <span>{t('connection.checking')}</span>}
        {state === 'ok' && meta.lastCheck?.state === 'ok' && (
          <span className="pen-root-bar__accessible">
            {meta.lastCheck.itemCount === 0 ? t('connection.okEmpty') : t('connection.ok', { count: meta.lastCheck.itemCount ?? 0 })}
            {meta.fetchedAtMs !== null && ` · ${t('lastUpdated', { time: new Date(meta.fetchedAtMs).toLocaleString() })}`}
          </span>
        )}
        {state === 'error' && meta.lastCheck?.state === 'error' && (
          <>
            <span className="pen-root-bar__error">
              {meta.lastCheck.httpStatus !== null ? t('connection.errorServer', { status: meta.lastCheck.httpStatus }) : t('connection.errorNetwork')}
            </span>
            <p className="hint">
              {meta.offline
                ? t('connection.neverLoaded')
                : t('connection.usingOfflineCache', { time: meta.fetchedAtMs !== null ? new Date(meta.fetchedAtMs).toLocaleString() : '' })}
            </p>
          </>
        )}
      </div>
      <div className="pen-root-bar__actions">
        <button type="button" className="button" onClick={() => void lib.refreshCatalog()} disabled={refreshing}>
          {refreshing ? t('refreshing') : t('refresh')}
        </button>
      </div>
    </div>
  );
}
