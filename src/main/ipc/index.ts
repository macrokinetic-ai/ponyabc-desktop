import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type { SettingsStore } from '../services/settingsStore';
import { currentMountFingerprint } from '../services/volumeDiscovery';
import { openRegistrationPage } from './registration';
import { chooseCandidatePenRoot, scanPenRoot, selectPenRoot } from './penRoot';
import { copyRecordingsToComputer, listDiyRecordings } from './recordings';
import { listComputerFolder, restoreComputerFolder, selectComputerFolder } from './computerFolder';
import { executeReplaceSticker, executeTransferToPen, planReplaceSticker, planTransferToPen } from './transfer';
import { getSettings, setSettings } from './settings';

let handlersRegistered = false;

const VOLUME_POLL_INTERVAL_MS = 2500;

/** Detects mounted-volume changes (USB connect/disconnect) by polling a cheap directory-name
 *  fingerprint — there is no cross-platform native mount-change event available here without
 *  adding a native dependency, and this app's volume set changes rarely, so a short poll is a
 *  reasonable, dependency-free way to satisfy "rescan on mount change". Pushes an event the
 *  renderer can react to (e.g. by rescanning); never touches pen content itself. */
function startVolumeWatcher(getWindow: () => BrowserWindow): void {
  let lastFingerprint = currentMountFingerprint();
  setInterval(() => {
    const next = currentMountFingerprint();
    if (next !== lastFingerprint) {
      lastFingerprint = next;
      try {
        getWindow().webContents.send(IPC.penRootVolumesChanged);
      } catch {
        // window may be mid-teardown; nothing to notify
      }
    }
  }, VOLUME_POLL_INTERVAL_MS).unref();
}

export function registerIpcHandlers(getWindow: () => BrowserWindow, store: SettingsStore): void {
  if (handlersRegistered) return; // handlers are process-lifetime singletons; window may change (macOS re-activate)
  handlersRegistered = true;

  ipcMain.handle(IPC.registrationOpen, () => openRegistrationPage());

  ipcMain.handle(IPC.penRootScan, () => scanPenRoot(store));
  ipcMain.handle(IPC.penRootChooseCandidate, (_event, index: number) => chooseCandidatePenRoot(store, index));
  ipcMain.handle(IPC.penRootSelect, () => selectPenRoot(getWindow(), store));
  ipcMain.handle(IPC.recordingsList, () => listDiyRecordings());

  ipcMain.handle(IPC.computerFolderSelect, () => selectComputerFolder(getWindow(), store));
  ipcMain.handle(IPC.computerFolderRestore, () => restoreComputerFolder(store));
  ipcMain.handle(IPC.computerFolderList, () => listComputerFolder());

  ipcMain.handle(IPC.copyToComputer, (_event, fileNames: string[]) => copyRecordingsToComputer(getWindow(), fileNames));

  ipcMain.handle(IPC.transferToPenPlan, (_event, fileNames: string[]) => planTransferToPen(fileNames));
  ipcMain.handle(IPC.transferToPenExecute, (_event, params) => executeTransferToPen(getWindow(), params));

  ipcMain.handle(IPC.replaceStickerPlan, (_event, params) => planReplaceSticker(params));
  ipcMain.handle(IPC.replaceStickerExecute, (_event, params) => executeReplaceSticker(getWindow(), params));

  ipcMain.handle(IPC.settingsGet, () => getSettings(store));
  ipcMain.handle(IPC.settingsSet, (_event, partial: unknown) => setSettings(store, partial));

  startVolumeWatcher(getWindow);
}
