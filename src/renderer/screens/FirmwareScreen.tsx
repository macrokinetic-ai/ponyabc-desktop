import { useTranslation } from 'react-i18next';

export function FirmwareScreen() {
  const { t } = useTranslation('firmware');
  const isMac = window.ponyabc.platform === 'darwin';

  return (
    <div className="screen">
      <h1>{t('title')}</h1>
      <div className="not-implemented-banner">{isMac ? t('macRequiresWindows') : t('windowsNotImplemented')}</div>
    </div>
  );
}
