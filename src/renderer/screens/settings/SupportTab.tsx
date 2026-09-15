import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { AppInfo, DiagnosticsSummary } from '@shared/types';

/** "00000000" is a hidden entry point, not real access control — it only avoids an ordinary
 *  user stumbling into a support-facing panel by accident. See diagnostics.ts (main process)
 *  for what's actually redacted from the exported log. Unchanged from the pre-redesign
 *  SettingsScreen — only its on-screen location moved. */
const DIAGNOSTICS_PASSCODE = '00000000';

// Display copy only — the main process independently hardcodes the real mailto recipient
// (src/main/ipc/support.ts) and the real registration/privacy URLs; the renderer never gets
// to supply either, only a subject line for the support email.
const SUPPORT_EMAIL = 'marketing@ponyabc.co.uk';

export function SupportTab({ appInfo }: { appInfo: AppInfo | null }) {
  const { t } = useTranslation('settings');
  const [emailCopied, setEmailCopied] = useState(false);
  const [supportMessage, setSupportMessage] = useState<string | null>(null);
  const [diagCode, setDiagCode] = useState('');
  const [diagSummary, setDiagSummary] = useState<DiagnosticsSummary | null>(null);
  const [diagMessage, setDiagMessage] = useState<string | null>(null);
  const diagUnlocked = diagCode === DIAGNOSTICS_PASSCODE;

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

  async function handleCopySupportEmail() {
    try {
      await navigator.clipboard.writeText(SUPPORT_EMAIL);
      setEmailCopied(true);
      setTimeout(() => setEmailCopied(false), 2000);
    } catch {
      setEmailCopied(false);
    }
  }

  async function handleContactSupport() {
    setSupportMessage(null);
    // No diagnostics, files, or other personal data are ever attached here — only a subject
    // line naming the app version/platform, which are already public, non-sensitive info.
    const subject = `PonyABC Desktop Support — v${appInfo?.version ?? '?'} (${appInfo?.platform ?? '?'})`;
    const result = await window.ponyabc.openSupportEmail({ subject });
    if (!result.ok) setSupportMessage(t('legal.support.openFailedHint'));
  }

  return (
    <div className="settings-panel" role="tabpanel" id="settings-panel-support" aria-labelledby="settings-tab-support">
      <div className="legal-section legal-section--first">
        <h2>{t('legal.support.title')}</h2>
        <p>
          {t('legal.support.emailLabel')}: <code>{SUPPORT_EMAIL}</code>
        </p>
        <div className="legal-section__actions">
          <button type="button" className="button button--primary" onClick={() => void handleContactSupport()}>
            {t('legal.support.contactButton')}
          </button>
          <button type="button" className="button" onClick={() => void handleCopySupportEmail()}>
            {emailCopied ? t('legal.support.copiedConfirmation') : t('legal.support.copyButton')}
          </button>
        </div>
        {supportMessage && <p className="hint">{supportMessage}</p>}
      </div>

      <div className="legal-section">
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
                {t('diagnostics.summaryLine', {
                  version: diagSummary.appVersion,
                  platform: diagSummary.platform,
                  arch: diagSummary.arch,
                  count: diagSummary.entries.length,
                })}
              </p>
            )}
            <button type="button" className="button" onClick={() => void handleExportDiagnostics()}>
              {t('diagnostics.exportButton')}
            </button>
            {diagMessage && <p className="hint">{diagMessage}</p>}
          </div>
        )}
      </div>
    </div>
  );
}
