import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type {
  AppInfo,
  ComputerFolderListResult,
  ComputerFolderResult,
  ConflictDecision,
  CopyProgressEvent,
  CopySummary,
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

  getSettings: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<Settings>,
  setSettings: (partial) => ipcRenderer.invoke(IPC.settingsSet, partial) as Promise<Settings>,

  getAppInfo: () => ipcRenderer.invoke(IPC.appInfoGet) as Promise<AppInfo>,
  checkForUpdates: () => ipcRenderer.invoke(IPC.appCheckForUpdates) as Promise<UpdateCheckResult>,
  openLatestReleasePage: () => ipcRenderer.invoke(IPC.appOpenLatestReleasePage),
};

contextBridge.exposeInMainWorld('ponyabc', api);
