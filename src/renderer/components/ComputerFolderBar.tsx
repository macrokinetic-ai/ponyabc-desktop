import { useTranslation } from 'react-i18next';
import { useComputerFolder } from '../state/ComputerFolderContext';

export function ComputerFolderBar() {
  const { t } = useTranslation('common');
  const { result, restoring, selectFolder } = useComputerFolder();

  return (
    <div className="pen-root-bar">
      <div className="pen-root-bar__info">
        <span className="pen-root-bar__label">{t('computerFolder.label')}:</span>{' '}
        {restoring && <span>…</span>}
        {!restoring && result.status === 'ok' && <span className="pen-root-bar__path">{result.path}</span>}
        {!restoring && (result.status === 'none' || result.status === 'cancelled') && (
          <span className="pen-root-bar__muted">{t('computerFolder.notSelected')}</span>
        )}
        {!restoring && result.status === 'not-found' && (
          <span className="pen-root-bar__error">
            {t('penRoot.notFound')} ({t('penRoot.checkedPath', { path: result.path })})
          </span>
        )}
        {!restoring && result.status === 'not-a-directory' && <span className="pen-root-bar__error">{result.path}</span>}
        {!restoring && result.status === 'error' && <span className="pen-root-bar__error">{result.message}</span>}
      </div>
      <button type="button" className="button" onClick={() => void selectFolder()}>
        {result.status === 'ok' ? t('computerFolder.changeButton') : t('computerFolder.selectButton')}
      </button>
    </div>
  );
}
