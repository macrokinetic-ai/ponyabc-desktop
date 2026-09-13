import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_LOCALE, isSupportedLocale } from '@shared/locales';
import { initI18n } from './i18n';
import App from './App';
import './styles/global.css';

async function bootstrap() {
  const settings = await window.ponyabc.getSettings();
  const locale = isSupportedLocale(settings.locale) ? settings.locale : DEFAULT_LOCALE;
  await initI18n(locale);

  const container = document.getElementById('root');
  if (!container) throw new Error('Root element not found');
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
