import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LOCALE_NATIVE_NAMES, SUPPORTED_LOCALES, isSupportedLocale, type SupportedLocale } from '@shared/locales';
import type { AppInfo } from '@shared/types';
import { VersionUpdatesTab } from './settings/VersionUpdatesTab';
import { SupportTab } from './settings/SupportTab';
import { PrivacyLegalTab } from './settings/PrivacyLegalTab';

// The date this Privacy/Legal & Copyright text was last written/reviewed by this project —
// bump it by hand whenever the copy actually changes, never auto-derived from "today".
const PRIVACY_VERSION = '1';
const PRIVACY_LAST_UPDATED = new Date('2026-09-15T00:00:00Z');

type TabId = 'versionUpdates' | 'support' | 'privacyLegal';

// No "General" tab: besides the language picker (pinned above the tabs, not inside one), there
// are no other everyday preference settings today — an always-empty tab would just be clutter,
// so Version & Updates is the default-selected tab instead.
const TABS: Array<{ id: TabId; labelKey: string }> = [
  { id: 'versionUpdates', labelKey: 'tabs.versionUpdates' },
  { id: 'support', labelKey: 'tabs.support' },
  { id: 'privacyLegal', labelKey: 'tabs.privacyLegal' },
];

export function SettingsScreen() {
  const { t, i18n } = useTranslation('settings');
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [activeTab, setActiveTab] = useState<TabId>('versionUpdates');
  const tabRefs = useRef<Partial<Record<TabId, HTMLButtonElement | null>>>({});

  useEffect(() => {
    let cancelled = false;
    window.ponyabc.getAppInfo().then((info) => {
      if (!cancelled) setAppInfo(info);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleLanguageChange(locale: SupportedLocale) {
    await i18n.changeLanguage(locale);
    await window.ponyabc.setSettings({ locale });
  }

  function focusTab(index: number) {
    const id = TABS[(index + TABS.length) % TABS.length].id;
    setActiveTab(id);
    tabRefs.current[id]?.focus();
  }

  function handleTabKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusTab(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusTab(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(TABS.length - 1);
    }
  }

  const current = isSupportedLocale(i18n.language) ? i18n.language : 'en';

  return (
    <div className="screen">
      <h1>{t('title')}</h1>

      {/* Pinned above the tabs (not inside any of them) so it stays visible and directly
         usable no matter which tab is active. */}
      <label className="field settings-language">
        <span>{t('languageLabel')}</span>
        <select value={current} onChange={(e) => void handleLanguageChange(e.target.value as SupportedLocale)}>
          {SUPPORTED_LOCALES.map((locale) => (
            <option key={locale} value={locale}>
              {LOCALE_NATIVE_NAMES[locale]}
            </option>
          ))}
        </select>
      </label>
      <p className="hint">{t('languageHint')}</p>

      <div className="settings-tablist" role="tablist" aria-label={t('title')}>
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(el) => {
              tabRefs.current[tab.id] = el;
            }}
            type="button"
            role="tab"
            id={`settings-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`settings-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={activeTab === tab.id ? 'settings-tab settings-tab--active' : 'settings-tab'}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(e) => handleTabKeyDown(e, index)}
          >
            {t(tab.labelKey)}
          </button>
        ))}
      </div>

      {/* All three panels stay mounted for the lifetime of this screen — visibility is toggled
         with the `hidden` attribute rather than by conditionally unmounting. This preserves the
         "check for updates once on load" effect timing exactly, and keeps diagnostics-unlock /
         in-progress input state intact if the user switches tabs and comes back. */}
      <div hidden={activeTab !== 'versionUpdates'}>
        <VersionUpdatesTab appInfo={appInfo} />
      </div>
      <div hidden={activeTab !== 'support'}>
        <SupportTab appInfo={appInfo} />
      </div>
      <div hidden={activeTab !== 'privacyLegal'}>
        <PrivacyLegalTab privacyVersion={PRIVACY_VERSION} privacyLastUpdated={PRIVACY_LAST_UPDATED} />
      </div>
    </div>
  );
}
