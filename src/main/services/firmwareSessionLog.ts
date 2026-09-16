import fs from 'node:fs';
import path from 'node:path';

/**
 * Per-upgrade-attempt structured diagnostic logging — separate from the general, capped
 * diagnostics.json (src/main/services/diagnostics.ts), which is too coarse for this: each
 * firmware session needs its OWN incrementally-persisted record plus a full raw vendor-output
 * byte capture, not a handful of summary fields sharing a 500-entry cap with every other kind of
 * event in the app.
 *
 * Pure, Electron-free module (no `electron` import anywhere in this file) — everything here is
 * plain filesystem + JSON, fully unit-testable without mocking Electron APIs. The one Electron
 * touchpoint (a save/open dialog for export) lives in src/main/ipc/firmware.ts, which calls into
 * the pure functions here to do the actual work.
 *
 * Every public function that touches disk swallows its own errors — logging failures must never
 * interrupt flashing (explicit requirement). Callers never need their own try/catch around these.
 */

export type FirmwareSessionStage =
  | 'download'
  | 'verification'
  | 'extraction'
  | 'launch'
  | 'uac-outcome'
  | 'flashing-output'
  | 'process-termination'
  | 'result-classification'
  | 'finish'
  | 'lock'
  | 'recovery-marker'
  | 'exception'
  | 'timeout'
  | 'unexpected-shutdown';

export interface FirmwareSessionStageEvent {
  atMs: number;
  stage: FirmwareSessionStage;
  detail?: Record<string, string | number | boolean | null>;
}

export interface FirmwareCompletionSignal {
  kind: 'en' | 'zh' | 'none';
  matchedText: string | null;
  /** A few lines of decoded text immediately around the match, for real investigation — never
   *  the full log (that's the separate raw/decoded export). */
  contextLines: string | null;
}

export interface FirmwareSessionRecord {
  sessionId: string;
  startedAtMs: number;
  endedAtMs: number | null;
  appVersion: string;
  platform: string;
  osVersion: string;
  source: 'official-download' | 'local-folder' | null;
  firmwareVersion: string | null;
  packageDate: string | null;
  expectedSha256: string | null;
  /** Whether the download's own hash check confirmed a match — never a separately-stored "actual
   *  hash" value, since a mismatch already stops the flow before a session reaches flashing at
   *  all (see firmwareDownload.ts's hash-mismatch outcome). null for a local-folder source,
   *  which has no download/verify step. */
  packageHashVerified: boolean | null;
  packageValidation: { looksValid: boolean; missingFiles: string[] } | null;
  /** Redacted only at EXPORT time (see redactSessionRecordForExport) — kept in full internally
   *  so local troubleshooting isn't hampered by the app's own redaction. */
  workDir: string | null;
  entryBatPath: string | null;
  detectedCodepage: number | null;
  decoderUsed: string | null;
  decodingFallbackApplied: boolean | null;
  completionSignal: FirmwareCompletionSignal | null;
  exitCode: number | null;
  processTerminationConfirmed: boolean | null;
  outcomeStatus: 'success' | 'failed' | 'unclear' | null;
  outcomeReason: string | null;
  userMessageKey: string | null;
  /** These three are deliberately kept as separate fields, never collapsed into one another —
   *  see the module doc in firmwareUpgrade.ts and this app's whole reason for existing: "the
   *  tool's process stopped" (toolProcessConfirmedFinished), "a recognized completion string was
   *  seen" (successSignalDetected), and "the pen's actual on-pen firmware version was read back
   *  and confirmed" (penFirmwareVersionVerified) are three different claims with three different
   *  levels of evidence, and conflating any two of them is exactly the mistake this whole
   *  logging system exists to make impossible to reintroduce by accident. */
  toolProcessConfirmedFinished: boolean | null;
  successSignalDetected: boolean | null;
  /** ALWAYS false — no mechanism exists today to read a connected pen's actual firmware version.
   *  A literal type (not `false | true`) so a future accidental `= true` assignment is a
   *  same-file compile error, not a silent behavior change. */
  penFirmwareVersionVerified: false;
  stages: FirmwareSessionStageEvent[];
}

export type NewFirmwareSessionInput = Omit<FirmwareSessionRecord, 'sessionId' | 'startedAtMs' | 'endedAtMs' | 'stages'>;

const MAX_SESSIONS = 20;
/** Per-session cap on captured raw vendor output — this vendor tool's real output is a few KB;
 *  this is a safety bound against a pathological/looping tool, not a size anyone should expect
 *  to hit in normal use. */
const MAX_RAW_LOG_BYTES = 2 * 1024 * 1024;

function sessionsDir(userDataPath: string): string {
  return path.join(userDataPath, 'firmwareDiagnostics', 'sessions');
}
function sessionJsonPath(userDataPath: string, sessionId: string): string {
  return path.join(sessionsDir(userDataPath), `${sessionId}.json`);
}
function sessionRawLogPath(userDataPath: string, sessionId: string): string {
  return path.join(sessionsDir(userDataPath), `${sessionId}.rawlog.bin`);
}

function safeWriteJsonAtomic(filePath: string, data: unknown): void {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    // Write-to-temp-then-rename: a crash/power-loss mid-write can never leave a half-written,
    // unparseable session file in the real path — either the old complete version or the new
    // complete version is there, never a partial one.
    const tmp = `${filePath}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8');
    fs.renameSync(tmp, filePath);
  } catch {
    // Logging failures must never interrupt flashing.
  }
}

/** A live session — created once per upgrade attempt, updated incrementally as real events
 *  happen so a crash/power-loss loses at most the events since the last update, never
 *  everything. Every method is a safe no-throw no-op on failure. */
export class FirmwareSessionHandle {
  private record: FirmwareSessionRecord;
  private readonly userDataPath: string;
  private rawBytesWritten = 0;

  constructor(userDataPath: string, record: FirmwareSessionRecord) {
    this.userDataPath = userDataPath;
    this.record = record;
    safeWriteJsonAtomic(sessionJsonPath(this.userDataPath, this.record.sessionId), this.record);
  }

  get sessionId(): string {
    return this.record.sessionId;
  }

  /** Snapshot only — callers must not mutate the returned object. */
  get currentRecord(): Readonly<FirmwareSessionRecord> {
    return this.record;
  }

  update(patch: Partial<FirmwareSessionRecord>): void {
    try {
      this.record = { ...this.record, ...patch };
      safeWriteJsonAtomic(sessionJsonPath(this.userDataPath, this.record.sessionId), this.record);
    } catch {
      // never throw
    }
  }

  recordStage(stage: FirmwareSessionStage, detail?: Record<string, string | number | boolean | null>): void {
    try {
      this.record = { ...this.record, stages: [...this.record.stages, { atMs: Date.now(), stage, detail }] };
      safeWriteJsonAtomic(sessionJsonPath(this.userDataPath, this.record.sessionId), this.record);
    } catch {
      // never throw
    }
  }

  /** Appends RAW bytes only — never decodes here (same principle as elevatedRun.ts's log
   *  polling: decode the full accumulated buffer fresh at read/export time, never per-chunk). */
  appendRawLogBytes(buf: Buffer): void {
    try {
      if (this.rawBytesWritten >= MAX_RAW_LOG_BYTES) return;
      const remaining = MAX_RAW_LOG_BYTES - this.rawBytesWritten;
      const toWrite = buf.length > remaining ? buf.subarray(0, remaining) : buf;
      fs.mkdirSync(sessionsDir(this.userDataPath), { recursive: true });
      fs.appendFileSync(sessionRawLogPath(this.userDataPath, this.record.sessionId), toWrite);
      this.rawBytesWritten += toWrite.length;
    } catch {
      // never throw
    }
  }

  finish(patch: Partial<FirmwareSessionRecord> = {}): void {
    try {
      this.record = { ...this.record, ...patch, endedAtMs: Date.now() };
      safeWriteJsonAtomic(sessionJsonPath(this.userDataPath, this.record.sessionId), this.record);
      pruneOldSessions(this.userDataPath);
    } catch {
      // never throw
    }
  }
}

export function startFirmwareSession(userDataPath: string, initial: NewFirmwareSessionInput): FirmwareSessionHandle {
  const sessionId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 8)}`;
  const record: FirmwareSessionRecord = { ...initial, sessionId, startedAtMs: Date.now(), endedAtMs: null, stages: [] };
  return new FirmwareSessionHandle(userDataPath, record);
}

export interface FirmwareSessionSummary {
  sessionId: string;
  startedAtMs: number;
  endedAtMs: number | null;
  /** True exactly when endedAtMs is null — a session file exists but `finish()` was never
   *  reached, meaning the app was closed/crashed/lost power mid-upgrade. */
  interrupted: boolean;
  outcomeStatus: FirmwareSessionRecord['outcomeStatus'];
}

function toSummary(record: FirmwareSessionRecord): FirmwareSessionSummary {
  return {
    sessionId: record.sessionId,
    startedAtMs: record.startedAtMs,
    endedAtMs: record.endedAtMs,
    interrupted: record.endedAtMs === null,
    outcomeStatus: record.outcomeStatus,
  };
}

/** Newest-first. Tolerant of unreadable/corrupt individual session files — skips them rather
 *  than failing the whole listing. */
export function listFirmwareSessions(userDataPath: string): FirmwareSessionSummary[] {
  try {
    const dir = sessionsDir(userDataPath);
    if (!fs.existsSync(dir)) return [];
    const summaries: FirmwareSessionSummary[] = [];
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.json') || f.includes('.tmp-')) continue;
      try {
        const record = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8')) as FirmwareSessionRecord;
        summaries.push(toSummary(record));
      } catch {
        // skip unreadable/corrupt file
      }
    }
    return summaries.sort((a, b) => b.startedAtMs - a.startedAtMs);
  } catch {
    return [];
  }
}

/** Keeps only the newest MAX_SESSIONS sessions (both the .json and its .rawlog.bin sidecar) —
 *  bounded local retention, never uploaded anywhere. Best-effort: a failure to delete one old
 *  file does not stop the others from being cleaned up. */
export function pruneOldSessions(userDataPath: string): void {
  try {
    const summaries = listFirmwareSessions(userDataPath);
    for (const s of summaries.slice(MAX_SESSIONS)) {
      try {
        fs.rmSync(sessionJsonPath(userDataPath, s.sessionId), { force: true });
      } catch {
        /* best-effort */
      }
      try {
        fs.rmSync(sessionRawLogPath(userDataPath, s.sessionId), { force: true });
      } catch {
        /* best-effort */
      }
    }
  } catch {
    // never throw
  }
}

export interface FullFirmwareSession {
  record: FirmwareSessionRecord;
  rawLogBytes: Buffer;
}

export function readFullFirmwareSession(userDataPath: string, sessionId: string): FullFirmwareSession | null {
  try {
    const record = JSON.parse(fs.readFileSync(sessionJsonPath(userDataPath, sessionId), 'utf-8')) as FirmwareSessionRecord;
    let rawLogBytes = Buffer.alloc(0);
    try {
      rawLogBytes = fs.readFileSync(sessionRawLogPath(userDataPath, sessionId));
    } catch {
      // No raw log captured for this session (e.g. it failed before any tool output) — fine.
    }
    return { record, rawLogBytes };
  } catch {
    return null;
  }
}

/** Redacts personal path components from a session record for export — reuses the exact same
 *  idea as the general diagnostics redaction (src/main/services/diagnostics.ts's redactText:
 *  `C:\Users\<name>\...` -> `<path>`), applied specifically to the two fields known to carry a
 *  full filesystem path (workDir, entryBatPath) plus a best-effort pass over any stage detail
 *  strings, so a shared/exported log never leaks the exporting user's Windows username. */
export function redactSessionRecordForExport(
  record: FirmwareSessionRecord,
  redactText: (text: string) => string,
): FirmwareSessionRecord {
  return {
    ...record,
    workDir: record.workDir ? redactText(record.workDir) : record.workDir,
    entryBatPath: record.entryBatPath ? redactText(record.entryBatPath) : record.entryBatPath,
    stages: record.stages.map((s) => ({
      ...s,
      detail: s.detail
        ? Object.fromEntries(Object.entries(s.detail).map(([k, v]) => [k, typeof v === 'string' ? redactText(v) : v]))
        : s.detail,
    })),
  };
}

/**
 * Best-effort redaction of the RAW captured bytes for export. The raw file is kept specifically
 * so encoding problems can be investigated from the untouched original bytes — full redaction
 * would defeat that purpose, and a real byte-level redaction that's ALSO encoding-aware (the
 * surrounding text might be GBK, Big5, or something else entirely) is out of scope here. What
 * this DOES do: the Windows account username is, in virtually every real case, plain ASCII
 * (e.g. "Benny"), and ASCII bytes are IDENTICAL across every encoding this app deals with — so a
 * plain byte-level search-and-replace of the ASCII-encoded username, preserving the original
 * byte length (replaced with `x` repeated), removes the one specific piece of personal
 * information most likely to appear (in the vendor tool's own printed path banners, e.g.
 * `ota.bin: C:/Users/<name>/...`) without needing to decode the whole buffer first or risk
 * corrupting a multi-byte sequence it doesn't touch. This is explicitly NOT a claim that the raw
 * file is fully scrubbed of every possible personal detail — see the export's own caveat text.
 */
export function redactRawLogBytesForExport(raw: Buffer, username: string): Buffer {
  if (!username || !/^[\x20-\x7e]+$/.test(username)) return raw; // only handle plain-ASCII usernames
  const needle = Buffer.from(username, 'ascii');
  if (needle.length === 0) return raw;
  const replacement = Buffer.from('x'.repeat(needle.length), 'ascii');
  const out = Buffer.from(raw); // copy — never mutate the caller's buffer
  let idx = 0;
  while ((idx = out.indexOf(needle, idx)) !== -1) {
    replacement.copy(out, idx);
    idx += needle.length;
  }
  return out;
}
