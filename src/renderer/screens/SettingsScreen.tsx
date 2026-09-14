import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale } from '@shared/locales';
import { identifyAppVariant } from '@shared/appVariant';
import type { AppInfo } from '@shared/types';

export function SettingsScreen() {
  const { t, i18n } = useTranslation('settings');
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    window.ponyabc.getAppInfo().then((info) => {
      if (!cancelled) setAppInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleChange(locale: SupportedLocale) {
    await i18n.changeLanguage(locale);
    await window.ponyabc.setSettings({ locale });
  }

  const current = isSupportedLocale(i18n.language) ? i18n.language : 'en';
  const variant = appInfo ? identifyAppVariant(appInfo.platform, appInfo.arch) : null;
  const variantLabel = variant ? (variant.labelKey ? t(variant.labelKey) : t('about.variantUnknown')) : '';

  async function handleCopy() {
    if (!appInfo || !variant) return;
    const text = [
      `${t('about.title')}`,
      `${t('about.versionLabel')}: ${appInfo.version}`,
      `${t('about.typeLabel')}: ${variantLabel}`,
      `${t('about.identifierLabel')}: ${variant.identifier}`,
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

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

      <h2>{t('about.title')}</h2>
      {!appInfo || !variant ? (
        <p className="hint">…</p>
      ) : (
        <>
          <dl className="about-info">
            <dt>{t('about.versionLabel')}</dt>
            <dd>{appInfo.version}</dd>
            <dt>{t('about.typeLabel')}</dt>
            <dd>{variantLabel}</dd>
            <dt>{t('about.identifierLabel')}</dt>
            <dd>
              <code>{variant.identifier}</code>
            </dd>
          </dl>
          <button type="button" className="button" onClick={() => void handleCopy()}>
            {copied ? t('about.copiedConfirmation') : t('about.copyButton')}
          </button>
        </>
      )}
    </div>
  );
}
