import type { SupportedLocale } from './locales';

export interface Settings {
  version: 1;
  locale: SupportedLocale;
  /** Display path only, for showing "last used: X" in the UI before restore/scan is confirmed. */
  lastPenRootPath: string | null;
  lastComputerFolderPath: string | null;
}

/** A pen root actively in use — always carries the generation it was resolved under. */
export interface PenRootOk {
  status: 'ok';
  path: string;
  volumeLabel: string;
  /** Bumped by the main process on every connect/disconnect/switch — never reused for a different device. */
  generation: number;
}

export type PenRootResult =
  | PenRootOk
  | { status: 'invalid'; path: string; missing: Array<'BOOK' | 'DIY'> }
  | { status: 'not-found'; path: string }
  | { status: 'cancelled' }
  | { status: 'none' } // no pen selected / nothing to restore
  | { status: 'error'; message: string };

export interface PenVolumeCandidate {
  /** Index into the main process's last scan results — chosen by index, never by a raw path
   *  the renderer supplies, so selection stays server-trusted. */
  index: number;
  path: string;
  volumeLabel: string;
}

export type PenRootScanResult =
  | (PenRootOk & { auto: true }) // exactly one candidate (or a persisted-preference match) — auto-selected
  | { status: 'choose'; candidates: PenVolumeCandidate[] }
  | { status: 'none' }
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

export type ComputerFolderResult =
  | { status: 'ok'; path: string }
  | { status: 'cancelled' }
  | { status: 'not-found'; path: string }
  | { status: 'not-a-directory'; path: string }
  | { status: 'none' }
  | { status: 'error'; message: string };

export interface ComputerFile {
  name: string;
  sizeBytes: number;
  mtimeMs: number;
}

export type ComputerFolderListResult =
  | { status: 'ok'; files: ComputerFile[]; folderPath: string }
  | { status: 'no-folder-selected' }
  | { status: 'not-found'; path: string }
  | { status: 'error'; message: string };

export type CopyFailureReason =
  | 'not-found'
  | 'permission'
  | 'no-space'
  | 'io-error'
  | 'disconnected'
  | 'device-changed'
  | 'security-rejected'
  | 'hash-mismatch'
  | 'backup-failed'
  | 'other';

export interface CopyProgressEvent {
  fileIndex: number;
  fileCount: number;
  fileName: string;
  fileStatus: 'copying' | 'done' | 'renamed' | 'failed' | 'backing-up' | 'replaced' | 'added' | 'skipped';
  savedAs?: string;
  error?: string;
}

/** Result of "Save selected to computer" (pen DIY -> computer folder). Computer-side collisions auto-rename. */
export interface CopySummary {
  status:
    | 'completed'
    | 'no-pen-selected'
    | 'no-computer-folder-selected'
    | 'invalid-destination'
    | 'device-disconnected'
    | 'error';
  succeeded: string[];
  renamed: Array<{ original: string; savedAs: string }>;
  failed: Array<{ file: string; message: string; reason: CopyFailureReason }>;
  destinationPath?: string;
  message?: string;
}

export interface TransferPlanItem {
  fileName: string;
  sizeBytes: number;
}

export interface TransferConflictItem {
  fileName: string;
  sourceSizeBytes: number;
  existingSizeBytes: number;
}

export interface TransferToPenPlan {
  status: 'ok';
  toAdd: TransferPlanItem[];
  conflicts: TransferConflictItem[];
  /** Files that were selected but failed re-validation at the transfer entry point (e.g. a
   *  ._ AppleDouble file, a non-mp3, or one that vanished) — excluded from toAdd/conflicts. */
  rejected: Array<{ fileName: string; reason: 'not-mp3' | 'not-found' | 'security-rejected' }>;
  destinationVolumeLabel: string;
  requiredBytes: number;
  freeBytes: number;
  hasEnoughSpace: boolean;
  /** The pen connection this plan was computed against — must still match at execute time. */
  penGeneration: number;
}

export type TransferToPenPlanResult =
  | TransferToPenPlan
  | { status: 'no-pen-selected' }
  | { status: 'no-computer-folder-selected' }
  | { status: 'device-disconnected' }
  | { status: 'invalid'; missing: Array<'BOOK' | 'DIY'> }
  | { status: 'error'; message: string };

export type ConflictDecision = 'replace' | 'skip';

export interface TransferToPenSummary {
  status:
    | 'completed'
    | 'stale-plan'
    | 'no-pen-selected'
    | 'no-computer-folder-selected'
    | 'device-disconnected'
    | 'no-space'
    | 'error';
  added: string[];
  replaced: Array<{ fileName: string; backupPath: string }>;
  skipped: string[];
  failed: Array<{ file: string; message: string; reason: CopyFailureReason }>;
  backupFolder?: string;
  message?: string;
}

export interface ReplaceStickerPlan {
  status: 'ok';
  /** The sticker filename on the pen that will be overwritten (left pane selection). */
  penFileName: string;
  penFileSizeBytes: number;
  /** The teacher-recorded source on the computer (right pane selection) — filename shown for
   *  confirmation only; it is NOT what gets written to the pen. */
  computerFileName: string;
  computerFileSizeBytes: number;
  penGeneration: number;
}

export type ReplaceStickerPlanResult =
  | ReplaceStickerPlan
  | { status: 'no-pen-selected' }
  | { status: 'no-computer-folder-selected' }
  | { status: 'device-disconnected' }
  | { status: 'invalid'; missing: Array<'BOOK' | 'DIY'> }
  | { status: 'not-found'; which: 'pen-file' | 'computer-file' }
  | { status: 'error'; message: string };

export interface ReplaceStickerSummary {
  status: 'completed' | 'stale-plan' | 'backup-failed' | 'device-disconnected' | 'no-space' | 'error';
  backupPath?: string;
  message?: string;
}

export interface PonyAbcApi {
  /** process.platform value from the main process, e.g. 'darwin' | 'win32' | 'linux'. */
  platform: string;

  openRegistrationPage: () => Promise<{ ok: true } | { ok: false; error: string }>;

  // Pen root — auto-detection + manual fallback.
  scanForPenRoot: () => Promise<PenRootScanResult>;
  chooseCandidatePenRoot: (index: number) => Promise<PenRootResult>;
  selectPenRoot: () => Promise<PenRootResult>;
  listDiyRecordings: () => Promise<RecordingsListResult>;
  onPenVolumesChanged: (listener: () => void) => () => void;

  // Computer-side folder (right pane).
  selectComputerFolder: () => Promise<ComputerFolderResult>;
  restoreComputerFolder: () => Promise<ComputerFolderResult>;
  listComputerFolder: () => Promise<ComputerFolderListResult>;

  // Operation A: pen -> computer.
  copyRecordingsToComputer: (fileNames: string[]) => Promise<CopySummary>;

  // Operation B: computer -> pen.
  planTransferToPen: (fileNames: string[]) => Promise<TransferToPenPlanResult>;
  executeTransferToPen: (params: {
    fileNames: string[];
    decisions: Record<string, ConflictDecision>;
    penGeneration: number;
  }) => Promise<TransferToPenSummary>;

  // Operation C: replace one sticker's audio.
  planReplaceSticker: (params: { penFileName: string; computerFileName: string }) => Promise<ReplaceStickerPlanResult>;
  executeReplaceSticker: (params: {
    penFileName: string;
    computerFileName: string;
    penGeneration: number;
  }) => Promise<ReplaceStickerSummary>;

  onTransferProgress: (listener: (event: CopyProgressEvent) => void) => () => void;

  getSettings: () => Promise<Settings>;
  setSettings: (partial: Partial<Pick<Settings, 'locale'>>) => Promise<Settings>;
}
