import * as internal from '@internal';
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
  beginPenBookBatch,
  commitBookIndexReset,
  completePendingBookIndexReset,
  endPenBookBatch,
  fixBookIndex,
  getBookIndexStatus,
} from './bookIndex';
import {
  createRecordingBackup,
  deleteRecordingsFromBackup,
  deleteRecordingsFromPen,
  executeRecordingRestore,
  getRecordingLabels,
  listRecordingBackups,
  migrateLegacyRecordingBackups,
  planRecordingRestore,
  reassignRecording,
  scanLegacyRecordingBackups,
  setRecordingLabel,
} from './recordingBackup';
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
  cancelFirmwareDownload,
  exportFirmwareDiagnostics,
  getFirmwareRecoveryStatus,
  getOfficialFirmwareRelease,
  isFirmwareInProgress,
  prepareOfficialFirmwarePackage,
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

  // A reset we already owe this pen is finished the moment it reconnects. The customer decided
  // to add or remove a book; being asked to confirm the consequence again would be asking them
  // about something they have already done.
  const afterPenResolved = <T extends { status: string }>(result: T): T => {
    if (result.status === 'ok') void completePendingBookIndexReset();
    return result;
  };

  ipcMain.handle(IPC.penRootScan, async () => afterPenResolved(await scanPenRoot(store)));
  ipcMain.handle(IPC.penRootChooseCandidate, async (_event, index: number) => afterPenResolved(await chooseCandidatePenRoot(store, index)));
  ipcMain.handle(IPC.penRootSelect, async () => afterPenResolved(await selectPenRoot(getWindow(), store)));
  ipcMain.handle(IPC.recordingsList, () => listDiyRecordings());

  ipcMain.handle(IPC.computerFolderSelect, () => selectComputerFolder(getWindow(), store));
  ipcMain.handle(IPC.computerFolderRestore, () => restoreComputerFolder(store));
  ipcMain.handle(IPC.computerFolderList, () => listComputerFolder());

  ipcMain.handle(IPC.copyToComputer, (_event, fileNames: string[]) => copyRecordingsToComputer(getWindow(), fileNames));

  ipcMain.handle(IPC.transferToPenPlan, (_event, fileNames: string[]) => planTransferToPen(fileNames));
  ipcMain.handle(IPC.transferToPenExecute, (_event, params) => executeTransferToPen(getWindow(), params));

  ipcMain.handle(IPC.replaceStickerPlan, (_event, params) => planReplaceSticker(params));
  ipcMain.handle(IPC.replaceStickerExecute, (_event, params) => executeReplaceSticker(getWindow(), params));

  ipcMain.handle(IPC.bookIndexStatus, () => getBookIndexStatus());

  // Testing mode. `internal` is the stub in a Store build, so these answer "off" and the
  // folder picker returns null — there is no dialog and no stored key to reach.
  ipcMain.handle(IPC.testingModeGet, () => internal.getTestingMode());
  ipcMain.handle(IPC.testingModeSet, (_e, patch) => internal.setTestingMode(patch ?? {}));
  ipcMain.handle(IPC.testingModeChooseFolder, () => internal.chooseTestCatalogueFolder(getWindow()));
  ipcMain.handle(IPC.bookIndexCommit, (_event, params) => commitBookIndexReset(params ?? {}));
  ipcMain.handle(IPC.bookBatchBegin, () => {
    beginPenBookBatch();
    return { ok: true };
  });
  ipcMain.handle(IPC.bookBatchEnd, (_event, params) => endPenBookBatch(params ?? {}));
  ipcMain.handle(IPC.bookIndexFix, () => fixBookIndex());

  ipcMain.handle(IPC.audioPreviewRead, (_event, params) => readAudioPreview(params));

  // Recordings v2. Every one of these re-resolves the pen itself; none trusts a stored path.
  ipcMain.handle(IPC.recordingBackupCreate, () => createRecordingBackup(getWindow()));
  ipcMain.handle(IPC.recordingBackupList, () => listRecordingBackups());
  ipcMain.handle(IPC.recordingRestorePlan, (_event, params) => planRecordingRestore(params));
  ipcMain.handle(IPC.recordingRestoreExecute, (_event, params) => executeRecordingRestore(getWindow(), params));
  ipcMain.handle(IPC.recordingDeleteFromPen, (_event, params) => deleteRecordingsFromPen(params));
  ipcMain.handle(IPC.recordingDeleteFromBackup, (_event, params) => deleteRecordingsFromBackup(params));
  ipcMain.handle(IPC.recordingReassign, (_event, params) => reassignRecording(params));
  ipcMain.handle(IPC.recordingLabelsGet, () => getRecordingLabels());
  ipcMain.handle(IPC.recordingLabelSet, (_event, params) => setRecordingLabel(params));
  ipcMain.handle(IPC.recordingLegacyScan, (_event, params) => scanLegacyRecordingBackups(params));
  ipcMain.handle(IPC.recordingLegacyMigrate, (_event, params) => migrateLegacyRecordingBackups(params));

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

  ipcMain.handle(IPC.firmwareGetOfficialRelease, () => getOfficialFirmwareRelease());
  ipcMain.handle(IPC.firmwarePrepareOfficialPackage, (_event, params) => prepareOfficialFirmwarePackage(getWindow(), params));
  ipcMain.handle(IPC.firmwareCancelDownload, () => cancelFirmwareDownload());
  ipcMain.handle(IPC.firmwareDiagnosticsExport, () => exportFirmwareDiagnostics(getWindow()));

  logAppStart();
  startVolumeWatcher(getWindow);
}
