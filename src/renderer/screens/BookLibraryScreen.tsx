import { useTranslation } from 'react-i18next';

export function BookLibraryScreen() {
  const { t } = useTranslation('book');
  return (
    <div className="screen">
      <h1>{t('title')}</h1>
      <div className="not-implemented-banner">{t('notImplemented')}</div>
    </div>
  );
}
