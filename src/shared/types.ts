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
  /** The server's own last-save time for this row (insert or any update, including a
   *  metadata-only edit) — epoch ms, or null if the server didn't declare one (never
   *  guessed). Used only to compute the 14-day "NEW" badge; never implies new AXB bytes,
   *  and is never the local download/cache time. */
  updatedAtMs: number | null;
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

// ---------------------------------------------------------------------------------------
// Dual-pane BOOK view (mirrors My Recordings' pen/computer split): the LEFT pane lists the
// pen's actual BOOK folder contents (matched-to-catalog or "Unknown" — read-only, never
// selectable/removable, enforced by the main process itself, not just the UI); the RIGHT
// pane lists the App's BOOK database (server catalog + local cache), each entry showing its
// relationship to whatever's currently on the pen.
// ---------------------------------------------------------------------------------------

export type BookPenMatchStatus =
  /** Matched by filename — present on the pen, but its content has NOT been verified against
   *  the official hash (this session, or ever, or the prior verification is now stale). This
   *  is the ordinary resting state after a plain refresh — refreshing/listing never reads a
   *  pen file's bytes, so "present" must never be read as "confirmed identical to official." */
  | 'present'
  /** An explicit "verify selected content" action is actively hashing this file right now. */
  | 'verifying'
  /** The last explicit verification (this session, still valid — see BookVerifyRecord) found
   *  this file's content matches the official hash. */
  | 'verified-current'
  /** The last explicit verification found this file's content differs from the official hash. */
  | 'verified-differs'
  /** The catalog has no official hash for this entry at all — can never be verified. */
  | 'matched-hash-unknown'
  /** No catalog has ever been successfully fetched, so this file has genuinely never been
   *  checked against anything — distinct from 'unknown', which means a real catalog exists
   *  and this file specifically isn't in it. Always non-removable, exactly like 'unknown'. */
  | 'awaiting-catalog'
  | 'unknown';

export interface BookPenItem {
  fileName: string;
  sizeBytes: number;
  /** null only when status === 'unknown'. */
  contentId: string | null;
  friendlyName: string | null;
  friendlyNameI18n: Record<string, string> | null;
  status: BookPenMatchStatus;
  /** Main-process-computed hint for the renderer — but removeFromPen() independently
   *  re-verifies and refuses regardless of what this says; this is never the only gate.
   *  Always false when status === 'unknown'. */
  removable: boolean;
  /** The matched catalog entry's updatedAtMs, or null when unmatched/no catalog entry. */
  updatedAtMs: number | null;
}

export type BookCatalogItemStatus =
  | 'not-on-pen'
  /** Matched by filename, present on the pen, content not verified — see BookPenMatchStatus's
   *  'present'. This is a PEN-presence fact, independent of `cached` (App's own local
   *  download cache) — a catalog item can be on-pen-present with cached=false, or not-on-pen
   *  with cached=true, and the UI must show both facts separately, never merge them. */
  | 'on-pen-present'
  | 'on-pen-verifying'
  | 'on-pen-current'
  | 'on-pen-differs'
  | 'metadata-incomplete'
  | 'ambiguous';

export interface BookCatalogItem {
  contentId: string;
  filename: string;
  friendlyName: string;
  friendlyNameI18n: Record<string, string> | null;
  sizeBytes: number;
  status: BookCatalogItemStatus;
  /** Whether a verified-good copy sits in the App's own local download cache — entirely about
   *  the LOCAL CACHE, never about what's on the pen. Independent of `status`. */
  cached: boolean;
  /** true for 'not-on-pen', 'on-pen-present', and 'on-pen-differs' — declared filename +
   *  trustworthy hash, not ambiguous, and not already confirmed current. Gates "Add"/"Replace"
   *  in the UI; bookInstall.ts enforces the same eligibility rule independently via
   *  isInstallEligible(). Never true while 'on-pen-verifying' (avoid racing a write against an
   *  in-flight read) or 'on-pen-current' (nothing to do). */
  actionable: boolean;
  updatedAtMs: number | null;
}

/** Outcome of the most recent catalog fetch attempt this run, independent of whether that
 *  attempt's data got applied — this is what lets the UI show a comprehensible reason
 *  instead of a single stuck "offline" flag, and stops a stale, once-successful state from
 *  reading as "connected" forever after a later attempt actually failed. */
export interface BookCatalogCheck {
  state: 'ok' | 'error';
  atMs: number;
  /** Present when a response actually came back with a non-2xx/malformed body; absent for a
   *  network-level failure (DNS/timeout/refused) — a different failure to explain to the user. */
  httpStatus: number | null;
  /** Number of books returned on a successful fetch — 0 is a valid, distinct outcome from a
   *  failure and must never be shown the same way. */
  itemCount: number | null;
  message: string | null;
  durationMs: number;
}

export interface BookLibraryMeta {
  /** Last successful catalog fetch, or null if the catalog has never been fetched. */
  fetchedAtMs: number | null;
  source: 'live' | 'fixture' | 'none';
  /** true only when NO catalog fetch has ever succeeded (nothing to fall back to at all) —
   *  a later failed refresh while a prior snapshot still exists does NOT set this; that case
   *  is instead reported through lastCheck, with the older snapshot kept and clearly marked
   *  offline-cached in the UI. */
  offline: boolean;
  conflicts: BookCatalogConflict[];
  /** null only before the very first attempt this run (e.g. this exact call is that attempt). */
  lastCheck: BookCatalogCheck | null;
}

export interface BookListResult {
  status: 'ok';
  /** null when no pen is connected — the right pane (catalog) still works fully offline of
   *  a pen; only left-pane rendering and any write/remove action require one. */
  penItems: BookPenItem[] | null;
  catalogItems: BookCatalogItem[];
  meta: BookLibraryMeta;
}

// ---------------------------------------------------------------------------------------
// Explicit on-pen content verification — a user-triggered action (never automatic on a plain
// refresh/list), so hashing a large AXB never happens without the user asking for it. Results
// are cached in a small, capped, App-managed index (never written to the pen's own SD card)
// keyed to the exact pen generation + file size/mtime + official hash, so re-verifying an
// unchanged file within the same connected session is a cache hit, not a re-read.
// ---------------------------------------------------------------------------------------

/** One remembered verification outcome. Acceleration/display only — never treated as a
 *  standing integrity guarantee; every safety-critical path (download-hash check, the
 *  immediately-before-delete re-hash in bookRemove.ts) re-verifies independently regardless of
 *  what's cached here. Invalidated (via findValidVerifyRecord) the moment the pen's device
 *  identity, the file's size/mtime, or the catalog's official hash no longer match exactly —
 *  never trusted merely because the volume label or path looks the same. */
export interface BookVerifyRecord {
  penVolumeLabel: string;
  /** session.getGeneration() at verify time — changes on every real connect/disconnect/swap,
   *  never on a no-op re-scan of the same still-mounted card. */
  penGenerationAtVerify: number;
  fileName: string;
  sizeBytes: number;
  mtimeMs: number;
  observedSha256: string;
  officialSha256: string;
  contentId: string;
  verifiedAtMs: number;
}

/** Pushed once an explicit verification finishes computing one file's hash, so both panes
 *  resolve without a full re-list round trip. `result` is null when the file could no longer
 *  be read (vanished, permission error, etc.) partway through — the renderer falls back to
 *  'present' (unverified) rather than guessing a current/differs outcome. */
export interface BookVerifyUpdateEvent {
  fileName: string;
  contentId: string;
  result: { penStatus: 'verified-current' | 'verified-differs'; catalogStatus: 'on-pen-current' | 'on-pen-differs' } | null;
}

export type BookVerifyProgressPhase = 'reading' | 'done' | 'failed' | 'cancelled';

/** Real byte-level progress for an in-flight explicit verification — never a fake/animated
 *  percentage. `completedCount`/`totalCount` track progress through the whole selected batch,
 *  not just the current file. */
export interface BookVerifyProgressEvent {
  fileName: string;
  contentId: string;
  bytesRead: number;
  totalBytes: number;
  completedCount: number;
  totalCount: number;
  phase: BookVerifyProgressPhase;
}

export type BookVerifyContentResult =
  | { status: 'started' }
  | { status: 'no-pen-selected' }
  | { status: 'device-disconnected' }
  | { status: 'stale-plan' };

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
  /** restoreFromBackup only: refuses a backup whose reason is 'uncatalogued' — the old
   *  Unknown-content backup/restore path is retired; restore only ever works for a matched
   *  BOOK's own backup (made before removing/replacing it). */
  | 'restore-not-allowed'
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
  /** The target resolves to an "Unknown" (not-in-catalog) pen file — removal is categorically
   *  refused, enforced here in the main process regardless of what the renderer requested. */
  | 'unknown-content'
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

// ---------------------------------------------------------------------------------------
// Diagnostics — a small, capped, redacted event log for support/debugging. Deliberately
// narrow: never carries auth headers/tokens, full local filesystem paths, personal data, or
// any audio/AXB bytes. Reached via a hidden (not real access-control) passcode entry point
// in Settings; export goes through a native save dialog the user drives, never auto-uploaded.
// ---------------------------------------------------------------------------------------

export type DiagnosticEntryKind = 'app-start' | 'catalog-fetch' | 'pen-reconcile' | 'book-download' | 'pen-verify' | 'pen-verify-batch';

export interface DiagnosticEntry {
  atMs: number;
  kind: DiagnosticEntryKind;
  /** Pre-redacted by the writer at insert time — never a raw spread of an arbitrary object. */
  detail: Record<string, string | number | boolean | null>;
}

export interface DiagnosticsSummary {
  appVersion: string;
  platform: string;
  arch: string;
  entries: DiagnosticEntry[];
}

export type DiagnosticsExportResult = { status: 'ok'; path: string } | { status: 'cancelled' } | { status: 'error'; message: string };

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

  // Explicit on-pen content verification — never triggered automatically by list/refresh.
  bookVerifyContent: (params: { fileNames: string[]; penGeneration: number }) => Promise<BookVerifyContentResult>;
  bookVerifyCancel: () => Promise<{ ok: boolean }>;
  onBookVerifyProgress: (listener: (event: BookVerifyProgressEvent) => void) => () => void;
  onBookVerifyUpdate: (listener: (event: BookVerifyUpdateEvent) => void) => () => void;

  // Diagnostics — see the block comment above these types.
  getDiagnosticsSummary: () => Promise<DiagnosticsSummary>;
  exportDiagnostics: () => Promise<DiagnosticsExportResult>;

  getSettings: () => Promise<Settings>;
  setSettings: (partial: Partial<Pick<Settings, 'locale'>>) => Promise<Settings>;

  getAppInfo: () => Promise<AppInfo>;
  checkForUpdates: () => Promise<UpdateCheckResult>;
  openLatestReleasePage: () => Promise<{ ok: true } | { ok: false; error: string }>;
}
