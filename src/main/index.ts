import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc';
import { createSettingsStore } from './services/settingsStore';
import { resolveSystemLocale } from './services/localeResolver';
import { createMainWindow } from './window';

app.whenReady().then(() => {
  const store = createSettingsStore(app.getPath('userData'), () =>
    resolveSystemLocale(app.getPreferredSystemLanguages()),
  );

  let currentWindow = createMainWindow();
  registerIpcHandlers(() => currentWindow, store);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      currentWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
