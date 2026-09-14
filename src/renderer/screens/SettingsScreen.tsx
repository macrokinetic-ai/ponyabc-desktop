import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale } from '@shared/locales';
import { identifyAppVariant } from '@shared/appVariant';
import type { AppInfo, DiagnosticsSummary, UpdateCheckResult } from '@shared/types';

/** "00000000" is a hidden entry point, not real access control — it only avoids an ordinary
 *  user stumbling into a support-facing panel by accident. See diagnostics.ts (main process)
 *  for what's actually redacted from the exported log. */
const DIAGNOSTICS_PASSCODE = '00000000';

export function SettingsScreen() {
  const { t, i18n } = useTranslation('settings');
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [diagCode, setDiagCode] = useState('');
  const [diagSummary, setDiagSummary] = useState<DiagnosticsSummary | null>(null);
  const [diagMessage, setDiagMessage] = useState<string | null>(null);
  const diagUnlocked = diagCode === DIAGNOSTICS_PASSCODE;

  useEffect(() => {
    let cancelled = false;
    window.ponyabc.getAppInfo().then((info) => {
      if (!cancelled) setAppInfo(info);
    });
    // A quiet background check once on load — a failure here (e.g. offline) just leaves the
    // status blank rather than showing an alarming error the user didn't ask for.
    window.ponyabc.checkForUpdates().then((result) => {
      if (!cancelled) setUpdateResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleChange(locale: SupportedLocale) {
    await i18n.changeLanguage(locale);
    await window.ponyabc.setSettings({ locale });
  }

  async function handleCheckForUpdates() {
    setCheckingUpdate(true);
    try {
      setUpdateResult(await window.ponyabc.checkForUpdates());
    } finally {
      setCheckingUpdate(false);
    }
  }

  useEffect(() => {
    if (!diagUnlocked) return;
    let cancelled = false;
    window.ponyabc.getDiagnosticsSummary().then((summary) => {
      if (!cancelled) setDiagSummary(summary);
    });
    return () => {
      cancelled = true;
    };
  }, [diagUnlocked]);

  async function handleExportDiagnostics() {
    const result = await window.ponyabc.exportDiagnostics();
    if (result.status === 'ok') setDiagMessage(t('diagnostics.exportSaved', { path: result.path }));
    else if (result.status === 'error') setDiagMessage(t('diagnostics.exportFailed'));
    else setDiagMessage(null);
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

          <div className="update-check">
            {checkingUpdate && <p className="hint">{t('about.checkingUpdates')}</p>}
            {!checkingUpdate && updateResult?.status === 'up-to-date' && <p className="hint">{t('about.upToDate')}</p>}
            {!checkingUpdate && updateResult?.status === 'update-available' && (
              <>
                <p>{t('about.updateAvailable', { version: updateResult.latestVersion })}</p>
                <button
                  type="button"
                  className="button button--primary"
                  onClick={() => void window.ponyabc.openLatestReleasePage()}
                >
                  {t('about.downloadUpdateButton')}
                </button>
              </>
            )}
            {!checkingUpdate && updateResult?.status === 'error' && <p className="hint">{t('about.checkFailed')}</p>}
            <button type="button" className="button" disabled={checkingUpdate} onClick={() => void handleCheckForUpdates()}>
              {t('about.checkUpdatesButton')}
            </button>
          </div>
        </>
      )}

      <h2>{t('diagnostics.title')}</h2>
      <p className="hint">{t('diagnostics.hint')}</p>
      <label className="field">
        <span>{t('diagnostics.passcodeLabel')}</span>
        <input
          type="text"
          value={diagCode}
          maxLength={8}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setDiagCode(e.target.value)}
        />
      </label>
      {diagUnlocked && (
        <div className="diagnostics-panel">
          {diagSummary && (
            <p className="hint">
              {t('diagnostics.summaryLine', { version: diagSummary.appVersion, platform: diagSummary.platform, arch: diagSummary.arch, count: diagSummary.entries.length })}
            </p>
          )}
          <button type="button" className="button" onClick={() => void handleExportDiagnostics()}>
            {t('diagnostics.exportButton')}
          </button>
          {diagMessage && <p className="hint">{diagMessage}</p>}
        </div>
      )}
    </div>
  );
}
