import { useTranslation } from 'react-i18next';
import { usePenRoot } from '../state/PenRootContext';

export function PenRootBar() {
  const { t } = useTranslation('common');
  const { result, restoring, scanning, candidates, rescan, chooseCandidate, selectPenRoot } = usePenRoot();

  const busy = restoring || scanning;

  return (
    <div className="pen-root-bar">
      <div className="pen-root-bar__info">
        <span className="pen-root-bar__label">{t('penRoot.label')}:</span>{' '}
        {busy && <span>{t('penRoot.scanning')}</span>}

        {!busy && candidates && candidates.length > 0 && (
          <div className="pen-root-bar__candidates">
            <p>{t('penRoot.multipleFound')}</p>
            <ul>
              {candidates.map((c) => (
                <li key={c.index}>
                  <button type="button" className="button" onClick={() => void chooseCandidate(c.index)}>
                    {c.volumeLabel} <span className="pen-root-bar__path">({c.path})</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {!busy && !candidates && result.status === 'ok' && (
          <>
            <span className="pen-root-bar__path">
              {result.volumeLabel} ({result.path})
            </span>
            <p className="pen-root-bar__accessible">{t('penRoot.accessible')}</p>
          </>
        )}

        {!busy && !candidates && result.status === 'none' && (
          <>
            <span className="pen-root-bar__muted">{t('penRoot.noneFound')}</span>
            <p className="hint">{t('penRoot.connectionHint')}</p>
          </>
        )}

        {!busy && !candidates && result.status === 'cancelled' && <span className="pen-root-bar__muted">{t('penRoot.notSelected')}</span>}

        {!busy && !candidates && result.status === 'invalid' && (
          <span className="pen-root-bar__error">
            {t('penRoot.missingFolders', { folders: result.missing.join(', ') })} — {t('penRoot.checkedPath', { path: result.path })}
          </span>
        )}

        {!busy && !candidates && result.status === 'not-found' && (
          <span className="pen-root-bar__error">
            {t('penRoot.notFound')} ({t('penRoot.checkedPath', { path: result.path })})
          </span>
        )}

        {!busy && !candidates && result.status === 'error' && <span className="pen-root-bar__error">{result.message}</span>}
      </div>

      <div className="pen-root-bar__actions">
        <button type="button" className="button" disabled={busy} onClick={() => void rescan()}>
          {t('penRoot.rescanButton')}
        </button>
        <button type="button" className="button" disabled={busy} onClick={() => void selectPenRoot()}>
          {result.status === 'ok' ? t('penRoot.changeButton') : t('penRoot.selectButton')}
        </button>
      </div>
    </div>
  );
}
