import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type {
  AppInfo,
  AudioPreviewResult,
  AudioSource,
  BookActionResult,
  BookBackupSummary,
  BookDownloadBatchStartResult,
  BookDownloadBatchSummaryEvent,
  BookDownloadProgressEvent,
  BookListResult,
  BookRemoveResult,
  BookVerifyContentResult,
  BookVerifyProgressEvent,
  BookVerifyUpdateEvent,
  ComputerFolderListResult,
  DiagnosticsExportResult,
  DiagnosticsSummary,
  ComputerFolderResult,
  ConflictDecision,
  CopyProgressEvent,
  CopySummary,
  FirmwareProgressEvent,
  FirmwareSelectPackageResult,
  FirmwareStartResult,
  FirmwareUpgradeOutcome,
  PenRootResult,
  PenRootScanResult,
  PonyAbcApi,
  RecordingsListResult,
  ReplaceStickerPlanResult,
  ReplaceStickerSummary,
  Settings,
  TransferToPenPlanResult,
  TransferToPenSummary,
  UpdateCheckResult,
} from '@shared/types';

function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const wrapped = (_event: unknown, payload: T) => listener(payload);
  ipcRenderer.on(channel, wrapped);
  return () => ipcRenderer.removeListener(channel, wrapped);
}

const api: PonyAbcApi = {
  platform: process.platform,

  openRegistrationPage: () => ipcRenderer.invoke(IPC.registrationOpen),
  openPrivacyPolicyPage: () => ipcRenderer.invoke(IPC.privacyPolicyOpen),
  openSupportEmail: (params: { subject: string }) => ipcRenderer.invoke(IPC.supportEmailOpen, params) as Promise<{ ok: true } | { ok: false; error: string }>,

  scanForPenRoot: () => ipcRenderer.invoke(IPC.penRootScan) as Promise<PenRootScanResult>,
  chooseCandidatePenRoot: (index: number) => ipcRenderer.invoke(IPC.penRootChooseCandidate, index) as Promise<PenRootResult>,
  selectPenRoot: () => ipcRenderer.invoke(IPC.penRootSelect) as Promise<PenRootResult>,
  listDiyRecordings: () => ipcRenderer.invoke(IPC.recordingsList) as Promise<RecordingsListResult>,
  onPenVolumesChanged: (listener: () => void) => subscribe(IPC.penRootVolumesChanged, () => listener()),

  selectComputerFolder: () => ipcRenderer.invoke(IPC.computerFolderSelect) as Promise<ComputerFolderResult>,
  restoreComputerFolder: () => ipcRenderer.invoke(IPC.computerFolderRestore) as Promise<ComputerFolderResult>,
  listComputerFolder: () => ipcRenderer.invoke(IPC.computerFolderList) as Promise<ComputerFolderListResult>,

  copyRecordingsToComputer: (fileNames: string[]) => ipcRenderer.invoke(IPC.copyToComputer, fileNames) as Promise<CopySummary>,

  planTransferToPen: (fileNames: string[]) => ipcRenderer.invoke(IPC.transferToPenPlan, fileNames) as Promise<TransferToPenPlanResult>,
  executeTransferToPen: (params: { fileNames: string[]; decisions: Record<string, ConflictDecision>; penGeneration: number }) =>
    ipcRenderer.invoke(IPC.transferToPenExecute, params) as Promise<TransferToPenSummary>,

  planReplaceSticker: (params: { penFileName: string; computerFileName: string }) =>
    ipcRenderer.invoke(IPC.replaceStickerPlan, params) as Promise<ReplaceStickerPlanResult>,
  executeReplaceSticker: (params: { penFileName: string; computerFileName: string; penGeneration: number }) =>
    ipcRenderer.invoke(IPC.replaceStickerExecute, params) as Promise<ReplaceStickerSummary>,

  onTransferProgress: (listener: (event: CopyProgressEvent) => void) => subscribe(IPC.transferProgress, listener),

  readAudioPreview: (params: { source: AudioSource; fileName: string }) => ipcRenderer.invoke(IPC.audioPreviewRead, params) as Promise<AudioPreviewResult>,

  bookList: () => ipcRenderer.invoke(IPC.bookList) as Promise<BookListResult>,
  bookCatalogRefresh: () => ipcRenderer.invoke(IPC.bookCatalogRefresh) as Promise<BookListResult>,
  bookAdd: (params: { contentId: string; penGeneration: number }) => ipcRenderer.invoke(IPC.bookAdd, params) as Promise<BookActionResult>,
  bookUpdate: (params: { contentId: string; penGeneration: number }) => ipcRenderer.invoke(IPC.bookUpdate, params) as Promise<BookActionResult>,
  bookReinstall: (params: { contentId: string; penGeneration: number }) => ipcRenderer.invoke(IPC.bookReinstall, params) as Promise<BookActionResult>,
  bookRemove: (params: { fileName: string; penGeneration: number }) => ipcRenderer.invoke(IPC.bookRemove, params) as Promise<BookRemoveResult>,
  bookBackups: () => ipcRenderer.invoke(IPC.bookBackups) as Promise<BookBackupSummary[]>,
  bookRestore: (params: { backupId: string; penGeneration: number }) => ipcRenderer.invoke(IPC.bookRestore, params) as Promise<BookActionResult>,
  bookDownloadCancel: (contentId: string) => ipcRenderer.invoke(IPC.bookDownloadCancel, contentId) as Promise<{ ok: boolean }>,
  onBookDownloadProgress: (listener: (event: BookDownloadProgressEvent) => void) => subscribe(IPC.bookDownloadProgress, listener),

  bookDownloadBatch: (params: { contentIds: string[] }) => ipcRenderer.invoke(IPC.bookDownloadBatch, params) as Promise<BookDownloadBatchStartResult>,
  bookDownloadBatchCancel: () => ipcRenderer.invoke(IPC.bookDownloadBatchCancel) as Promise<{ ok: boolean }>,
  onBookDownloadBatchSummary: (listener: (event: BookDownloadBatchSummaryEvent) => void) => subscribe(IPC.bookDownloadBatchSummary, listener),

  bookVerifyContent: (params: { fileNames: string[]; penGeneration: number }) => ipcRenderer.invoke(IPC.bookVerifyContent, params) as Promise<BookVerifyContentResult>,
  bookVerifyCancel: () => ipcRenderer.invoke(IPC.bookVerifyCancel) as Promise<{ ok: boolean }>,
  onBookVerifyProgress: (listener: (event: BookVerifyProgressEvent) => void) => subscribe(IPC.bookVerifyProgress, listener),
  onBookVerifyUpdate: (listener: (event: BookVerifyUpdateEvent) => void) => subscribe(IPC.bookVerifyUpdate, listener),

  getDiagnosticsSummary: () => ipcRenderer.invoke(IPC.diagnosticsSummary) as Promise<DiagnosticsSummary>,
  exportDiagnostics: () => ipcRenderer.invoke(IPC.diagnosticsExport) as Promise<DiagnosticsExportResult>,

  getSettings: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<Settings>,
  setSettings: (partial) => ipcRenderer.invoke(IPC.settingsSet, partial) as Promise<Settings>,

  getAppInfo: () => ipcRenderer.invoke(IPC.appInfoGet) as Promise<AppInfo>,
  checkForUpdates: () => ipcRenderer.invoke(IPC.appCheckForUpdates) as Promise<UpdateCheckResult>,
  openLatestReleasePage: () => ipcRenderer.invoke(IPC.appOpenLatestReleasePage),

  selectFirmwarePackage: () => ipcRenderer.invoke(IPC.firmwareSelectPackage) as Promise<FirmwareSelectPackageResult>,
  startFirmwareUpgrade: (params: { packageDir: string }) => ipcRenderer.invoke(IPC.firmwareStart, params) as Promise<FirmwareStartResult>,
  onFirmwareProgress: (listener: (event: FirmwareProgressEvent) => void) => subscribe(IPC.firmwareProgress, listener),
  onFirmwareOutcome: (listener: (event: FirmwareUpgradeOutcome) => void) => subscribe(IPC.firmwareOutcome, listener),
  acknowledgeFirmwareOutcome: () => ipcRenderer.invoke(IPC.firmwareAcknowledgeOutcome) as Promise<{ ok: boolean }>,
  isFirmwareUpgradeInProgress: () => ipcRenderer.invoke(IPC.firmwareIsInProgress) as Promise<boolean>,
};

contextBridge.exposeInMainWorld('ponyabc', api);
