import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { identifyAppVariant } from '@shared/appVariant';
import type { AppInfo, UpdateCheckResult } from '@shared/types';

/**
 * Version, running-platform identification, and the real update-check capability. This
 * intentionally presents only what's actually implemented today — no auto-install toggle or
 * other capability that doesn't exist yet.
 */
export function VersionUpdatesTab({ appInfo }: { appInfo: AppInfo | null }) {
  const { t } = useTranslation('settings');
  const [copied, setCopied] = useState(false);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);

  // A quiet background check once when this panel first mounts — a failure here (e.g. offline)
  // just leaves the status blank rather than showing an alarming error the user didn't ask for.
  // This panel stays mounted for the lifetime of the Settings screen (see SettingsScreen), so
  // this effect still runs exactly once per Settings-screen visit, same as before the redesign.
  useEffect(() => {
    let cancelled = false;
    window.ponyabc.checkForUpdates().then((result) => {
      if (!cancelled) setUpdateResult(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCheckForUpdates() {
    setCheckingUpdate(true);
    try {
      setUpdateResult(await window.ponyabc.checkForUpdates());
    } finally {
      setCheckingUpdate(false);
    }
  }

  const variant = appInfo ? identifyAppVariant(appInfo.platform, appInfo.arch, appInfo.isWindowsStore) : null;
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
    <div className="settings-panel" role="tabpanel" id="settings-panel-versionUpdates" aria-labelledby="settings-tab-versionUpdates">
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
            {/* Store-managed builds never show the manual check/download UI at all — Microsoft
                Store owns updates for this install, and there is nothing meaningful to "check"
                or a GitHub build to download here. */}
            {updateResult?.status === 'store-managed' ? (
              <p className="hint">{t('about.storeManagedUpdates')}</p>
            ) : (
              <>
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
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
