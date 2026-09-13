import { useTranslation } from 'react-i18next';
import { usePenRoot } from '../state/PenRootContext';

export function PenRootBar() {
  const { t } = useTranslation('common');
  const { result, restoring, selectPenRoot } = usePenRoot();

  return (
    <div className="pen-root-bar">
      <div className="pen-root-bar__info">
        <span className="pen-root-bar__label">{t('penRoot.label')}:</span>{' '}
        {restoring && <span>…</span>}
        {!restoring && result.status === 'ok' && <span className="pen-root-bar__path">{result.path}</span>}
        {!restoring && result.status === 'none' && <span className="pen-root-bar__muted">{t('penRoot.notSelected')}</span>}
        {!restoring && result.status === 'cancelled' && <span className="pen-root-bar__muted">{t('penRoot.notSelected')}</span>}
        {!restoring && result.status === 'invalid' && (
          <span className="pen-root-bar__error">
            {t('penRoot.missingFolders', { folders: result.missing.join(', ') })} — {t('penRoot.checkedPath', { path: result.path })}
          </span>
        )}
        {!restoring && result.status === 'not-found' && (
          <span className="pen-root-bar__error">
            {t('penRoot.notFound')} ({t('penRoot.checkedPath', { path: result.path })})
          </span>
        )}
        {!restoring && result.status === 'error' && <span className="pen-root-bar__error">{result.message}</span>}
      </div>
      <button type="button" className="button" onClick={() => void selectPenRoot()}>
        {result.status === 'ok' ? t('penRoot.changeButton') : t('penRoot.selectButton')}
      </button>
    </div>
  );
}
