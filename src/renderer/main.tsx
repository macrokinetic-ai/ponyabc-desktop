import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { DEFAULT_LOCALE, isSupportedLocale } from '@shared/locales';
import { initI18n } from './i18n';
import App from './App';
import './styles/global.css';

function renderStartupFailure(container: HTMLElement, message: string) {
  container.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'font-family: -apple-system, sans-serif; padding: 40px; color: #c0392b; max-width: 640px;';
  const title = document.createElement('h1');
  title.textContent = 'PonyABC Desktop failed to start';
  title.style.cssText = 'font-size: 18px; margin-bottom: 12px;';
  const detail = document.createElement('p');
  detail.textContent = message;
  detail.style.cssText = 'font-family: ui-monospace, monospace; font-size: 13px; white-space: pre-wrap;';
  wrapper.appendChild(title);
  wrapper.appendChild(detail);
  container.appendChild(wrapper);
}

async function bootstrap() {
  const container = document.getElementById('root');
  if (!container) {
    // Nothing to render into — this can only be a corrupt index.html; log and stop.
    console.error('[renderer] startup failed: #root element not found in index.html');
    return;
  }

  try {
    if (!window.ponyabc) {
      throw new Error(
        'window.ponyabc is unavailable — the preload script did not run (contextBridge exposeInMainWorld never fired). ' +
          'Check the main process log for a "preload script failed to load" error.',
      );
    }

    const settings = await window.ponyabc.getSettings();
    const locale = isSupportedLocale(settings.locale) ? settings.locale : DEFAULT_LOCALE;
    await initI18n(locale);

    createRoot(container).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  } catch (err) {
    const message = err instanceof Error ? (err.stack ?? err.message) : String(err);
    console.error('[renderer] startup failed:', err);
    renderStartupFailure(container, message);
  }
}

void bootstrap();
