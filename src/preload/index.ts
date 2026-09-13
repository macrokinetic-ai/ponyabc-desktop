import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type {
  ChooseDestinationResult,
  CopyProgressEvent,
  CopySummary,
  PenRootResult,
  PonyAbcApi,
  RecordingsListResult,
  Settings,
} from '@shared/types';

const api: PonyAbcApi = {
  platform: process.platform,
  openRegistrationPage: () => ipcRenderer.invoke(IPC.registrationOpen),
  selectPenRoot: () => ipcRenderer.invoke(IPC.penRootSelect) as Promise<PenRootResult>,
  restorePenRoot: () => ipcRenderer.invoke(IPC.penRootRestore) as Promise<PenRootResult>,
  listDiyRecordings: () => ipcRenderer.invoke(IPC.recordingsList) as Promise<RecordingsListResult>,
  chooseSaveDestination: () => ipcRenderer.invoke(IPC.recordingsChooseDestination) as Promise<ChooseDestinationResult>,
  copyRecordings: (fileNames: string[]) => ipcRenderer.invoke(IPC.recordingsCopy, fileNames) as Promise<CopySummary>,
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet) as Promise<Settings>,
  setSettings: (partial) => ipcRenderer.invoke(IPC.settingsSet, partial) as Promise<Settings>,
  onCopyProgress: (listener: (event: CopyProgressEvent) => void) => {
    const wrapped = (_event: unknown, payload: CopyProgressEvent) => listener(payload);
    ipcRenderer.on(IPC.recordingsCopyProgress, wrapped);
    return () => ipcRenderer.removeListener(IPC.recordingsCopyProgress, wrapped);
  },
};

contextBridge.exposeInMainWorld('ponyabc', api);
