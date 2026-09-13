import type { SupportedLocale } from './locales';

export interface Settings {
  version: 1;
  locale: SupportedLocale;
  /** Display path only, for showing "last used: X" in the UI before restore is confirmed. */
  lastPenRootPath: string | null;
}

export type PenRootResult =
  | { status: 'ok'; path: string }
  | { status: 'invalid'; path: string; missing: Array<'BOOK' | 'DIY'> }
  | { status: 'not-found'; path: string }
  | { status: 'cancelled' }
  | { status: 'none' } // no pen selected / nothing to restore
  | { status: 'error'; message: string };

export interface RecordingFile {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

export type RecordingsListResult =
  | { status: 'ok'; files: RecordingFile[]; diyFolderName: string }
  | { status: 'no-pen-selected' }
  | { status: 'invalid'; missing: Array<'BOOK' | 'DIY'> }
  | { status: 'device-disconnected' }
  | { status: 'error'; message: string };

export type ChooseDestinationResult =
  | { status: 'ok'; path: string }
  | { status: 'cancelled' }
  | { status: 'invalid-destination'; reason: 'on-pen'; path: string }
  | { status: 'no-pen-selected' }
  | { status: 'error'; message: string };

export type CopyFailureReason =
  | 'not-found'
  | 'permission'
  | 'no-space'
  | 'io-error'
  | 'disconnected'
  | 'security-rejected'
  | 'other';

export interface CopyProgressEvent {
  fileIndex: number;
  fileCount: number;
  fileName: string;
  fileStatus: 'copying' | 'done' | 'renamed' | 'failed';
  savedAs?: string;
  error?: string;
}

export interface CopySummary {
  status: 'completed' | 'no-pen-selected' | 'no-destination-selected' | 'invalid-destination' | 'device-disconnected' | 'error';
  succeeded: string[];
  renamed: Array<{ original: string; savedAs: string }>;
  failed: Array<{ file: string; message: string; reason: CopyFailureReason }>;
  destinationPath?: string;
  message?: string;
}

export interface PonyAbcApi {
  /** process.platform value from the main process, e.g. 'darwin' | 'win32' | 'linux'. */
  platform: string;
  openRegistrationPage: () => Promise<{ ok: true } | { ok: false; error: string }>;
  selectPenRoot: () => Promise<PenRootResult>;
  restorePenRoot: () => Promise<PenRootResult>;
  listDiyRecordings: () => Promise<RecordingsListResult>;
  chooseSaveDestination: () => Promise<ChooseDestinationResult>;
  copyRecordings: (fileNames: string[]) => Promise<CopySummary>;
  getSettings: () => Promise<Settings>;
  setSettings: (partial: Partial<Pick<Settings, 'locale'>>) => Promise<Settings>;
  onCopyProgress: (listener: (event: CopyProgressEvent) => void) => () => void;
}
