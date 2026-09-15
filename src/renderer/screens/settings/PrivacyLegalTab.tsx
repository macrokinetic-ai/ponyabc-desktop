import { useTranslation } from 'react-i18next';
import { CollapsibleSection } from '../../components/CollapsibleSection';

// Display copy only — kept in sync with SupportTab's own copy of the same constant rather than
// sharing a module, so each tab file stays self-contained; the real recipient is hardcoded
// separately in the main process (src/main/ipc/support.ts) regardless of this string.
const SUPPORT_EMAIL = 'marketing@ponyabc.co.uk';

/**
 * Privacy notice, terms of use, and third-party licenses — each collapsed to a short
 * title/summary by default, full text only shown once the user clicks "Read". None of the
 * underlying legal copy (including any "to be confirmed" / pending-review labeling) is
 * rewritten here — only how it's presented. All body paragraphs are pinned to the English
 * resource bundle via {lng: 'en'}, matching the pre-redesign behavior described by
 * legal.englishOnlyNotice below.
 */
export function PrivacyLegalTab({ privacyVersion, privacyLastUpdated }: { privacyVersion: string; privacyLastUpdated: Date }) {
  const { t, i18n } = useTranslation('settings');

  return (
    <div className="settings-panel" role="tabpanel" id="settings-panel-privacyLegal" aria-labelledby="settings-tab-privacyLegal">
      <h2>{t('legal.title')}</h2>
      <p className="hint">{t('legal.englishOnlyNotice')}</p>

      <CollapsibleSection
        title={t('legal.privacy.title')}
        summary={t('legal.privacy.versionLine', { version: privacyVersion, date: privacyLastUpdated.toLocaleDateString(i18n.language) })}
        readLabel={t('legal.readButton')}
        collapseLabel={t('legal.collapseButton')}
      >
        <p>{t('legal.privacy.companyLine', { lng: 'en' })}</p>

        <h4>{t('legal.privacy.localHeading')}</h4>
        <p>{t('legal.privacy.localBody', { lng: 'en' })}</p>

        <h4>{t('legal.privacy.networkHeading')}</h4>
        <p>{t('legal.privacy.networkBookBody', { lng: 'en' })}</p>
        <p>{t('legal.privacy.networkUpdateBody', { lng: 'en' })}</p>
        <p>{t('legal.privacy.networkDiagnosticsBody', { lng: 'en' })}</p>

        <h4>{t('legal.privacy.registrationHeading')}</h4>
        <p>{t('legal.privacy.registrationBody', { lng: 'en' })}</p>

        <h4>{t('legal.privacy.retentionHeading')}</h4>
        <p>{t('legal.privacy.retentionBody', { lng: 'en' })}</p>

        <h4>{t('legal.privacy.rightsHeading')}</h4>
        <p>{t('legal.privacy.rightsBody', { lng: 'en', email: SUPPORT_EMAIL })}</p>

        <button type="button" className="button" onClick={() => void window.ponyabc.openPrivacyPolicyPage()}>
          {t('legal.privacy.openFullPolicyButton')}
        </button>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('legal.legalCopyright.title')}
        summary={t('legal.legalCopyright.termsNotice', { lng: 'en' })}
        readLabel={t('legal.readButton')}
        collapseLabel={t('legal.collapseButton')}
      >
        <p>{t('legal.legalCopyright.materialsBody', { lng: 'en' })}</p>
        <p>{t('legal.legalCopyright.diyBody', { lng: 'en' })}</p>
        <p>{t('legal.legalCopyright.trademarkBody', { lng: 'en' })}</p>
      </CollapsibleSection>

      <CollapsibleSection
        title={t('legal.legalCopyright.thirdPartyHeading')}
        readLabel={t('legal.readButton')}
        collapseLabel={t('legal.collapseButton')}
      >
        <p>{t('legal.legalCopyright.thirdPartyBody', { lng: 'en' })}</p>
      </CollapsibleSection>
    </div>
  );
}
