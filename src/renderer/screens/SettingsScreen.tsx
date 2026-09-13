import { useTranslation } from 'react-i18next';
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale } from '@shared/locales';

export function SettingsScreen() {
  const { t, i18n } = useTranslation('settings');

  async function handleChange(locale: SupportedLocale) {
    await i18n.changeLanguage(locale);
    await window.ponyabc.setSettings({ locale });
  }

  const current = isSupportedLocale(i18n.language) ? i18n.language : 'en';

  return (
    <div className="screen">
      <h1>{t('title')}</h1>
      <label className="field">
        <span>{t('languageLabel')}</span>
        <select value={current} onChange={(e) => void handleChange(e.target.value as SupportedLocale)}>
          {SUPPORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {LOCALE_NATIVE_NAMES[locale]}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{t('languageHint')}</p>
    </div>
  );
}
