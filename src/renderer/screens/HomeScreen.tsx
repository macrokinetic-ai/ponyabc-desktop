import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function HomeScreen() {
  const { t } = useTranslation('home');
  const [error, setError] = useState<string | null>(null);

  async function handleRegister() {
    setError(null);
    const result = await window.ponyabc.openRegistrationPage();
    if (!result.ok) setError(t('registerError', { error: result.error }));
  }

  return (
    <div className="screen">
      <h1>{t('title')}</h1>
      <p>{t('intro')}</p>
      <button type="button" className="button button--primary" onClick={() => void handleRegister()}>
        {t('registerButton')}
      </button>
      <p className="hint">{t('registerHint')}</p>
      {error && <p className="error-text">{error}</p>}
    </div>
  );
}
