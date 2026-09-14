import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, BrowserWindow } from 'electron';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged,
    },
  });

  // The window may never navigate away from the bundled UI or open new windows/tabs.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());

  // Preload/renderer startup failures (e.g. a bad preload build) must be diagnosable from
  // the terminal even when DevTools is disabled in the packaged app — log them loudly here
  // rather than silently white-screening.
  window.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[main] preload script failed to load at ${preloadPath}:`, error);
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    console.error('[main] renderer process gone:', details);
  });
  window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[main] page failed to load (${errorCode} ${errorDescription}): ${validatedURL}`);
  });

  window.once('ready-to-show', () => window.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    window.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  return window;
}
