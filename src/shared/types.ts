import type { SupportedLocale } from './locales';
import type { AppInfo } from './appVariant';

export type { AppInfo };

export type UpdateCheckResult =
  | { status: 'up-to-date'; currentVersion: string }
  | { status: 'update-available'; currentVersion: string; latestVersion: string }
  | { status: 'error'; message: string };

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

/** A mounted volume the scan checked but that did not qualify as a pen — surfaced instead of
 *  silently dropped, so "nothing plugged in" and "found a drive, but it's missing DIY" don't
 *  look identical to the user. */
export interface VolumeDiagnostic {
  volumeLabel: string;
  path: string;
  reason: 'missing-book' | 'missing-diy' | 'missing-both';
}

export type PenRootScanResult =
  | (PenRootOk & { auto: true }) // exactly one candidate (or a persisted-preference match) — auto-selected
  | { status: 'choose'; candidates: PenVolumeCandidate[] }
  | { status: 'none'; diagnostics?: VolumeDiagnostic[] }
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

// ---------------------------------------------------------------------------------------
// Local-only audio preview (both panes). The main process reads a fully-validated file (same
// resolveContainedFile/isEligibleMp3FileName boundary as every other file operation, re-
// resolved fresh — never trusts the renderer's fileName beyond a plain basename lookup
// against the currently-authorized DIY/computer folder) and returns the raw bytes as base64;
// the renderer turns that into a Blob/object URL for a native <audio> element. Nothing is
// streamed to or from a network location, and no path the renderer supplies is ever used
// directly — only a name looked up inside an already-authorized directory.
export type AudioSource = 'pen' | 'computer';

export type AudioPreviewResult =
  | { status: 'ok'; base64: string; mimeType: string; sizeBytes: number }
  | { status: 'no-pen-selected' }
  | { status: 'no-computer-folder-selected' }
  | { status: 'device-disconnected' }
  | { status: 'invalid'; missing: Array<'BOOK' | 'DIY'> }
  | { status: 'not-found' }
  | { status: 'rejected' }
  | { status: 'too-large' }
  | { status: 'error'; message: string };

// ---------------------------------------------------------------------------------------
// BOOK library — catalog browsing, local cache, and safe pen install/remove/restore.
// The catalog comes from a secret-free public endpoint (no credential embedded in this
// app); "sync" only ever refreshes catalog metadata, never auto-mirrors the pen's BOOK
// folder against it, and un-cataloged pen content is retained by default.
// ---------------------------------------------------------------------------------------

/** One published BOOK entry from the catalog. */
export interface BookCatalogEntry {
  contentId: string;
  /** The exact filename this must be written to the pen's BOOK folder as. */
  filename: string;
  /** 'declared' = the server told us this filename explicitly. 'fallback-storage-key' means
   *  it didn't (a defensive fallback, not expected in normal operation) — install is refused
   *  in that case regardless of what the UI shows, see isInstallEligible(). */
  filenameSource: 'declared' | 'fallback-storage-key';
  /** null = the catalog can't currently attest a hash for this entry. */
  sha256: string | null;
  sizeBytes: number;
  /** Raw fallback display name, as returned by the API. */
  friendlyName: string;
  /** Full { locale: name } map, retained as-is so an offline UI-language switch can
   *  recompute the displayed name instantly — never pre-picked down to one string. */
  friendlyNameI18n: Record<string, string> | null;
  contentLanguages: string[];
  sortOrder: number;
  downloadUrl: string;
}

export interface BookCatalogConflict {
  filenameLower: string;
  contentIds: string[];
}

export interface BookCatalogSnapshot {
  entries: BookCatalogEntry[];
  /** Set only on a SUCCESSFUL fetch — never cleared or overwritten by a failed refresh. */
  fetchedAtMs: number;
  source: 'live' | 'fixture';
  conflicts: BookCatalogConflict[];
}

export interface BookCacheEntry {
  contentId: string;
  sha256: string;
  sizeBytes: number;
  filename: string;
  cachedAtMs: number;
}

export type BookBackupReason = 'uncatalogued' | 'differs-from-official' | 'pre-removal-current-version';

export interface BookBackupEntry {
  backupId: string;
  originalFileName: string;
  sizeBytes: number;
  sha256: string;
  reason: BookBackupReason;
  matchedContentId: string | null;
  createdAtMs: number;
  /** When set, this backup's bytes are an existing verified cache file at this content/hash
   *  rather than a duplicate copy — safe because this app has no cache-eviction feature, so a
   *  referenced cache file is never cleaned up out from under a backup. */
  cacheRef: { contentId: string; sha256: string } | null;
}

export type BookItemStatus =
  | 'catalog-not-cached'
  | 'catalog-cached-current'
  | 'catalog-cached-stale'
  | 'on-pen-current'
  /** Same filename, pen's hash != the catalog's current hash. Deliberately neutral — no local
   *  inference about which one is "newer" is ever made (there is no server-trusted version
   *  order to reason from). Never "update available," never auto-overwritten. */
  | 'on-pen-differs-from-official'
  /** Pen file matched by filename, but the catalog's sha256 is null (or unreadable pen file) —
   *  genuinely cannot compare. */
  | 'on-pen-hash-unknown'
  | 'not-in-catalog'
  /** filenameSource is 'fallback-storage-key' — display-only, install/update/reinstall
   *  structurally refused (see isInstallEligible), not just hidden in the UI. */
  | 'catalog-incomplete-metadata'
  /** This entry's filename collides (case-insensitively) with another catalog entry's —
   *  display-only, install disabled, see validateCatalogEntries. */
  | 'catalog-ambiguous';

export type BookAction = 'add' | 'replace' | 'reinstall' | 'remove' | 'restore';

export interface BookLibraryItem {
  /** null only for a not-in-catalog pen file. */
  contentId: string | null;
  filename: string;
  /** Both null only when not-in-catalog (no catalog name available). Kept as raw
   *  name/i18n-map fields — not a pre-picked string — so the renderer can recompute the
   *  displayed name instantly on a UI language switch via resolveBookDisplayName, with no
   *  IPC round trip. */
  friendlyName: string | null;
  friendlyNameI18n: Record<string, string> | null;
  status: BookItemStatus;
  sizeBytes: number;
  cached: boolean;
  onPen: boolean;
  availableActions: BookAction[];
}

export interface BookLibraryMeta {
  /** Last successful catalog fetch, or null if the catalog has never been fetched. */
  fetchedAtMs: number | null;
  source: 'live' | 'fixture' | 'none';
  offline: boolean;
  conflicts: BookCatalogConflict[];
}

export interface BookListResult {
  status: 'ok';
  items: BookLibraryItem[];
  meta: BookLibraryMeta;
}

export type BookDownloadPhase = 'downloading' | 'verifying' | 'done' | 'failed' | 'cancelled';

export interface BookDownloadProgressEvent {
  contentId: string;
  bytesReceived: number;
  totalBytes: number;
  phase: BookDownloadPhase;
}

export type BookActionStatus =
  | 'completed'
  | 'no-pen-selected'
  | 'device-disconnected'
  | 'invalid'
  | 'stale-plan'
  | 'no-space'
  | 'metadata-incomplete'
  | 'network-error'
  | 'cancelled'
  | 'backup-failed'
  | 'target-changed-since-backup'
  | 'error';

export interface BookActionResult {
  status: BookActionStatus;
  message?: string;
  backupPath?: string;
  missing?: Array<'BOOK' | 'DIY'>;
}

export type BookRemoveStatus =
  | 'completed'
  | 'no-pen-selected'
  | 'device-disconnected'
  | 'invalid'
  | 'stale-plan'
  | 'backup-failed'
  | 'target-changed-since-backup'
  | 'error';

export interface BookRemoveResult {
  status: BookRemoveStatus;
  freedBytes?: number;
  /** The backup id this removal's backup was recorded under, so the UI can offer "restore"
   *  for it directly. */
  backupPath?: string;
  message?: string;
  missing?: Array<'BOOK' | 'DIY'>;
}

/** Renderer-facing view of a BookBackupEntry — omits cacheRef/internal path details, which
 *  are main-process-only plumbing. */
export interface BookBackupSummary {
  backupId: string;
  originalFileName: string;
  sizeBytes: number;
  reason: BookBackupReason;
  matchedContentId: string | null;
  createdAtMs: number;
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

  // Local-only preview playback — never modifies anything, never leaves the machine.
  readAudioPreview: (params: { source: AudioSource; fileName: string }) => Promise<AudioPreviewResult>;

  // BOOK library — catalog browsing, local cache, and safe pen install/remove/restore.
  bookList: () => Promise<BookListResult>;
  bookCatalogRefresh: () => Promise<BookListResult>;
  bookAdd: (params: { contentId: string; penGeneration: number }) => Promise<BookActionResult>;
  bookUpdate: (params: { contentId: string; penGeneration: number }) => Promise<BookActionResult>;
  bookReinstall: (params: { contentId: string; penGeneration: number }) => Promise<BookActionResult>;
  bookRemove: (params: { fileName: string; penGeneration: number }) => Promise<BookRemoveResult>;
  bookBackups: () => Promise<BookBackupSummary[]>;
  bookRestore: (params: { backupId: string; penGeneration: number }) => Promise<BookActionResult>;
  bookDownloadCancel: (contentId: string) => Promise<{ ok: boolean }>;
  onBookDownloadProgress: (listener: (event: BookDownloadProgressEvent) => void) => () => void;

  getSettings: () => Promise<Settings>;
  setSettings: (partial: Partial<Pick<Settings, 'locale'>>) => Promise<Settings>;

  getAppInfo: () => Promise<AppInfo>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  openLatestReleasePage: () => Promise<{ ok: true } | { ok: false; error: string }>;
}
