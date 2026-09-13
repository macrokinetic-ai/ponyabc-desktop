import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type { SettingsStore } from '../services/settingsStore';
import { openRegistrationPage } from './registration';
import { restorePenRoot, selectPenRoot } from './penRoot';
import { chooseSaveDestination, copyRecordings, listDiyRecordings } from './recordings';
import { getSettings, setSettings } from './settings';

let handlersRegistered = false;

export function registerIpcHandlers(getWindow: () => BrowserWindow, store: SettingsStore): void {
  if (handlersRegistered) return; // handlers are process-lifetime singletons; window may change (macOS re-activate)
  handlersRegistered = true;

  ipcMain.handle(IPC.registrationOpen, () => openRegistrationPage());
  ipcMain.handle(IPC.penRootSelect, () => selectPenRoot(getWindow(), store));
  ipcMain.handle(IPC.penRootRestore, () => restorePenRoot(store));
  ipcMain.handle(IPC.recordingsList, () => listDiyRecordings());
  ipcMain.handle(IPC.recordingsChooseDestination, () => chooseSaveDestination(getWindow()));
  ipcMain.handle(IPC.recordingsCopy, (_event, fileNames: string[]) => copyRecordings(getWindow(), fileNames));
  ipcMain.handle(IPC.settingsGet, () => getSettings(store));
  ipcMain.handle(IPC.settingsSet, (_event, partial: unknown) => setSettings(store, partial));
}
