import { ipcMain, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type { SettingsStore } from '../services/settingsStore';
import { currentMountFingerprint } from '../services/volumeDiscovery';
import { openPrivacyPolicyPage, openRegistrationPage } from './registration';
import { openSupportEmail } from './support';
import { chooseCandidatePenRoot, scanPenRoot, selectPenRoot } from './penRoot';
import { copyRecordingsToComputer, listDiyRecordings } from './recordings';
import { listComputerFolder, restoreComputerFolder, selectComputerFolder } from './computerFolder';
import { executeReplaceSticker, executeTransferToPen, planReplaceSticker, planTransferToPen } from './transfer';
import { readAudioPreview } from './audioPreview';
import {
  bookAdd,
  bookBackups,
  bookCatalogRefresh,
  bookDownloadBatch,
  bookDownloadBatchCancel,
  bookDownloadCancel,
  bookList,
  bookReinstall,
  bookRemove,
  bookRestore,
  bookUpdate,
  bookVerifyCancel,
  bookVerifyContent,
} from './book';
import { exportDiagnostics, getDiagnosticsSummary, logAppStart } from './diagnostics';
import { getSettings, setSettings } from './settings';
import { getAppInfo } from './appInfo';
import { checkForUpdates, openLatestReleasePage } from './updates';
import {
  acknowledgeFirmwareOutcome,
  getFirmwareRecoveryStatus,
  isFirmwareInProgress,
  recheckFirmwareRecovery,
  selectFirmwarePackage,
  startFirmwareUpgrade,
} from './firmware';

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
  ipcMain.handle(IPC.privacyPolicyOpen, () => openPrivacyPolicyPage());
  ipcMain.handle(IPC.supportEmailOpen, (_event, params: { subject: string }) => openSupportEmail(params));

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

  ipcMain.handle(IPC.audioPreviewRead, (_event, params) => readAudioPreview(params));

  ipcMain.handle(IPC.bookList, () => bookList());
  ipcMain.handle(IPC.bookCatalogRefresh, () => bookCatalogRefresh());
  ipcMain.handle(IPC.bookAdd, (_event, params) => bookAdd(getWindow(), params));
  ipcMain.handle(IPC.bookUpdate, (_event, params) => bookUpdate(getWindow(), params));
  ipcMain.handle(IPC.bookReinstall, (_event, params) => bookReinstall(getWindow(), params));
  ipcMain.handle(IPC.bookRemove, (_event, params) => bookRemove(params));
  ipcMain.handle(IPC.bookBackups, () => bookBackups());
  ipcMain.handle(IPC.bookRestore, (_event, params) => bookRestore(params));
  ipcMain.handle(IPC.bookDownloadCancel, (_event, contentId: string) => bookDownloadCancel(contentId));
  ipcMain.handle(IPC.bookDownloadBatch, (_event, params) => bookDownloadBatch(getWindow(), params));
  ipcMain.handle(IPC.bookDownloadBatchCancel, () => bookDownloadBatchCancel());
  ipcMain.handle(IPC.bookVerifyContent, (_event, params) => bookVerifyContent(getWindow(), params));
  ipcMain.handle(IPC.bookVerifyCancel, () => bookVerifyCancel());

  ipcMain.handle(IPC.diagnosticsSummary, () => getDiagnosticsSummary());
  ipcMain.handle(IPC.diagnosticsExport, () => exportDiagnostics(getWindow()));

  ipcMain.handle(IPC.settingsGet, () => getSettings(store));
  ipcMain.handle(IPC.settingsSet, (_event, partial: unknown) => setSettings(store, partial));

  ipcMain.handle(IPC.appInfoGet, () => getAppInfo());
  ipcMain.handle(IPC.appCheckForUpdates, () => checkForUpdates());
  ipcMain.handle(IPC.appOpenLatestReleasePage, () => openLatestReleasePage());

  ipcMain.handle(IPC.firmwareSelectPackage, () => selectFirmwarePackage(getWindow()));
  ipcMain.handle(IPC.firmwareStart, (_event, params) => startFirmwareUpgrade(getWindow(), params));
  ipcMain.handle(IPC.firmwareAcknowledgeOutcome, () => acknowledgeFirmwareOutcome());
  ipcMain.handle(IPC.firmwareIsInProgress, () => isFirmwareInProgress());
  ipcMain.handle(IPC.firmwareRecoveryStatus, () => getFirmwareRecoveryStatus());
  ipcMain.handle(IPC.firmwareRecoveryRecheck, () => recheckFirmwareRecovery());

  logAppStart();
  startVolumeWatcher(getWindow);
}
