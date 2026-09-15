import { app, BrowserWindow } from 'electron';
import { registerIpcHandlers } from './ipc';
import { checkPendingFirmwareRecoveryOnStartup } from './ipc/firmware';
import { createSettingsStore } from './services/settingsStore';
import { resolveSystemLocale } from './services/localeResolver';
import { createMainWindow } from './window';

app.whenReady().then(async () => {
  // MUST run before registerIpcHandlers below: if a previous session left an unresolved
  // firmware upgrade (crash, force-quit, or an outcome the user never got to confirm), this
  // seeds both the pen lock and the firmware in-progress guard as HELD before any IPC handler
  // exists to be called — a BOOK/DIY write or a new firmware attempt can never race it. A no-op,
  // near-instant fast path when nothing is pending (the overwhelmingly common case).
  await checkPendingFirmwareRecoveryOnStartup();

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
