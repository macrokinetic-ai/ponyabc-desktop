import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePenRoot } from '../state/PenRootContext';
import type { Section } from '../components/NavSidebar';

const ENTRIES: Array<{ section: Section; titleKey: string; bodyKey: string }> = [
  { section: 'recordings', titleKey: 'nav.myRecordings', bodyKey: 'entries.recordingsBody' },
  { section: 'book', titleKey: 'nav.bookLibrary', bodyKey: 'entries.bookBody' },
  { section: 'firmware', titleKey: 'nav.firmware', bodyKey: 'entries.firmwareBody' },
];

export function HomeScreen({ onNavigate }: { onNavigate: (section: Section) => void }) {
  const { t } = useTranslation(['home', 'common']);
  const { result, restoring, rescan } = usePenRoot();
  const [error, setError] = useState<string | null>(null);

  async function handleRegister() {
    setError(null);
    const registerResult = await window.ponyabc.openRegistrationPage();
    if (!registerResult.ok) setError(t('registerError', { error: registerResult.error }));
  }

  const connected = result.status === 'ok';

  return (
    <div className="screen">
      <div className="home-hero">
        <div className="home-hero__kicker">{t('kicker')}</div>
        <h1>{t('title')}</h1>
        <p className="home-hero__intro">{t('intro')}</p>
      </div>

      {restoring ? (
        <div className="home-connection home-connection--off">
          <div className="home-connection__dot" />
          <div className="home-connection__body">
            <div className="home-connection__title">{t('connection.checking')}</div>
          </div>
        </div>
      ) : (
        <div className={connected ? 'home-connection home-connection--on' : 'home-connection home-connection--off'}>
          <div className="home-connection__dot" />
          <div className="home-connection__body">
            <div className="home-connection__title">
              {connected ? t('connection.connectedTitle') : t('connection.disconnectedTitle')}
            </div>
            <p className="home-connection__text">
              {connected ? t('common:penRoot.accessible') : t('common:penRoot.disconnected')}
            </p>
            {!connected && <p className="home-connection__text">{t('common:penRoot.connectionHint')}</p>}
          </div>
          <button type="button" className="button" onClick={() => void rescan()}>
            {t('common:penRoot.rescanButton')}
          </button>
        </div>
      )}

      <div className="home-entries">
        {ENTRIES.map((entry) => (
          <button
            key={entry.section}
            type="button"
            className="home-entry"
            onClick={() => onNavigate(entry.section)}
          >
            <div className="home-entry__title">{t(entry.titleKey, { ns: 'common' })}</div>
            <p className="home-entry__body">{t(entry.bodyKey)}</p>
          </button>
        ))}
      </div>

      <div className="home-warranty">
        <div className="home-warranty__info">
          <div className="home-warranty__title">{t('warrantyTitle')}</div>
          <p className="home-warranty__body">{t('registerHint')}</p>
        </div>
        <button type="button" className="button button--primary" onClick={() => void handleRegister()}>
          {t('registerButton')}
        </button>
      </div>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
