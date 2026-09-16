// Focused coverage for src/main/services/firmwareSessionLog.ts — the Part-B structured,
// per-attempt diagnostic logging system. Pure filesystem module, no Electron mock needed. Never
// touches startFirmwareUpgrade/runElevated/a real vendor tool or pen — every session here is
// synthetic, constructed directly against the module's own API.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  listFirmwareSessions,
  readFullFirmwareSession,
  redactRawLogBytesForExport,
  redactSessionRecordForExport,
  startFirmwareSession,
  type NewFirmwareSessionInput,
} from '../../src/main/services/firmwareSessionLog';

const tempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

let userDataPath: string;
beforeEach(() => {
  userDataPath = mkTempDir('ponyabc-userdata-');
});

const baseInput: NewFirmwareSessionInput = {
  appVersion: '0.3.15',
  platform: 'win32',
  osVersion: '10.0.19045',
  source: 'local-folder',
  firmwareVersion: null,
  packageDate: null,
  expectedSha256: null,
  packageHashVerified: null,
  packageValidation: { looksValid: true, missingFiles: [] },
  workDir: null,
  entryBatPath: 'C:\\Users\\teacher\\Desktop\\tools\\download.bat',
  detectedCodepage: null,
  decoderUsed: null,
  decodingFallbackApplied: null,
  completionSignal: null,
  exitCode: null,
  processTerminationConfirmed: null,
  outcomeStatus: null,
  outcomeReason: null,
  userMessageKey: null,
  toolProcessConfirmedFinished: null,
  successSignalDetected: null,
  penFirmwareVersionVerified: false,
};

function sessionJsonPath(sessionId: string): string {
  return path.join(userDataPath, 'firmwareDiagnostics', 'sessions', `${sessionId}.json`);
}

describe('incremental logging', () => {
  it('persists a session file the moment it is created, before any update or finish() call', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    expect(fs.existsSync(sessionJsonPath(handle.sessionId))).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(sessionJsonPath(handle.sessionId), 'utf-8'));
    expect(onDisk.endedAtMs).toBeNull();
  });

  it('recordStage() appends to the on-disk stages array immediately, without waiting for finish()', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    handle.recordStage('launch', { workDir: 'C:\\work' });
    handle.recordStage('uac-outcome', { elevationStatus: 'completed', exitCode: 0 });
    const onDisk = JSON.parse(fs.readFileSync(sessionJsonPath(handle.sessionId), 'utf-8'));
    expect(onDisk.stages.map((s: { stage: string }) => s.stage)).toEqual(['launch', 'uac-outcome']);
  });

  it('update() merges fields into the persisted record without clobbering unrelated fields', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    handle.update({ workDir: 'C:\\work', detectedCodepage: 936 });
    const onDisk = JSON.parse(fs.readFileSync(sessionJsonPath(handle.sessionId), 'utf-8'));
    expect(onDisk.workDir).toBe('C:\\work');
    expect(onDisk.detectedCodepage).toBe(936);
    expect(onDisk.entryBatPath).toBe(baseInput.entryBatPath); // untouched
  });

  it('a write-to-temp-then-rename is used, so no stray .tmp file is ever left behind after a normal update', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    handle.update({ workDir: 'C:\\work' });
    const files = fs.readdirSync(path.join(userDataPath, 'firmwareDiagnostics', 'sessions'));
    expect(files.every((f) => !f.includes('.tmp-'))).toBe(true);
  });

  it('a logging failure (e.g. an unwritable userData path) never throws — flashing must never be interrupted by a logging problem', () => {
    const readOnlyRoot = path.join(userDataPath, 'this-does-not-exist-and-cannot-be-created\0bad');
    expect(() => {
      const handle = startFirmwareSession(readOnlyRoot, baseInput);
      handle.recordStage('launch');
      handle.update({ workDir: 'x' });
      handle.appendRawLogBytes(Buffer.from('hello'));
      handle.finish({ outcomeStatus: 'success' });
    }).not.toThrow();
  });
});

describe('interrupted sessions', () => {
  it('a session with no finish() call is listed with interrupted: true and endedAtMs: null', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    handle.recordStage('launch');
    const summaries = listFirmwareSessions(userDataPath);
    expect(summaries).toHaveLength(1);
    expect(summaries[0].sessionId).toBe(handle.sessionId);
    expect(summaries[0].interrupted).toBe(true);
    expect(summaries[0].endedAtMs).toBeNull();
  });

  it('a finished session is listed with interrupted: false', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    handle.finish({ outcomeStatus: 'success' });
    const summaries = listFirmwareSessions(userDataPath);
    expect(summaries[0].interrupted).toBe(false);
    expect(summaries[0].endedAtMs).not.toBeNull();
  });

  it('readFullFirmwareSession can still read an interrupted session\'s partial progress (whatever was persisted before the "crash")', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    handle.recordStage('launch', { workDir: 'C:\\work' });
    handle.appendRawLogBytes(Buffer.from('start downloading......\n'));
    // No finish() — simulates a crash/power-loss mid-upgrade.
    const full = readFullFirmwareSession(userDataPath, handle.sessionId);
    expect(full).not.toBeNull();
    expect(full!.record.endedAtMs).toBeNull();
    expect(full!.record.stages).toHaveLength(1);
    expect(full!.rawLogBytes.toString('ascii')).toBe('start downloading......\n');
  });

  it('listFirmwareSessions tolerates a corrupt/unreadable session file by skipping it, not throwing', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    fs.writeFileSync(sessionJsonPath(handle.sessionId), '{ not valid json');
    expect(() => listFirmwareSessions(userDataPath)).not.toThrow();
    expect(listFirmwareSessions(userDataPath)).toEqual([]);
  });
});

describe('encoding preservation', () => {
  it('appendRawLogBytes accumulates the exact original bytes, unmodified, across multiple chunks', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    // A real GBK-encoded Chinese phrase ("下载完成。" success message), split mid-character
    // across two chunks — exactly the scenario that motivated "raw bytes only, decode later".
    const full = Buffer.from([0xcf, 0xc2, 0xd4, 0xd8, 0xcd, 0xea, 0xb3, 0xc9, 0xa1, 0xa3]);
    handle.appendRawLogBytes(full.subarray(0, 3));
    handle.appendRawLogBytes(full.subarray(3));
    handle.finish({ outcomeStatus: 'success' });
    const result = readFullFirmwareSession(userDataPath, handle.sessionId);
    expect(result!.rawLogBytes.equals(full)).toBe(true);
  });

  it('the raw log is capped at a bounded size per session — a pathological/looping tool cannot grow it unbounded', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    const chunk = Buffer.alloc(1024 * 1024, 0x41); // 1MB of 'A'
    for (let i = 0; i < 5; i++) handle.appendRawLogBytes(chunk); // 5MB attempted
    handle.finish({ outcomeStatus: 'unclear' });
    const result = readFullFirmwareSession(userDataPath, handle.sessionId);
    expect(result!.rawLogBytes.length).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('decoderUsed and decodingFallbackApplied are recorded distinctly from the raw bytes themselves', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    handle.finish({ decoderUsed: 'gbk', decodingFallbackApplied: false });
    const onDisk = JSON.parse(fs.readFileSync(sessionJsonPath(handle.sessionId), 'utf-8'));
    expect(onDisk.decoderUsed).toBe('gbk');
    expect(onDisk.decodingFallbackApplied).toBe(false);
  });

  it('a session with no raw output at all (e.g. failed before launch) reports an empty raw buffer, not an error', () => {
    const handle = startFirmwareSession(userDataPath, baseInput);
    handle.finish({ outcomeStatus: 'failed' });
    const result = readFullFirmwareSession(userDataPath, handle.sessionId);
    expect(result!.rawLogBytes.length).toBe(0);
  });
});

describe('redaction', () => {
  const redactText = (text: string) => text.replace(/C:\\Users\\[^\\]+/g, '<path>');

  it('redactSessionRecordForExport removes the username from workDir and entryBatPath but leaves other fields intact', () => {
    const record = {
      ...baseInput,
      sessionId: 's1',
      startedAtMs: 0,
      endedAtMs: 1,
      workDir: 'C:\\Users\\teacher\\AppData\\Roaming\\ponyabc-desktop\\firmwareRun',
      entryBatPath: 'C:\\Users\\teacher\\Desktop\\tools\\download.bat',
      stages: [{ atMs: 0, stage: 'launch' as const, detail: { workDir: 'C:\\Users\\teacher\\Desktop\\tools' } }],
    };
    const redacted = redactSessionRecordForExport(record, redactText);
    expect(redacted.workDir).toBe('<path>\\AppData\\Roaming\\ponyabc-desktop\\firmwareRun');
    expect(redacted.entryBatPath).toBe('<path>\\Desktop\\tools\\download.bat');
    expect(redacted.stages[0].detail!.workDir).toBe('<path>\\Desktop\\tools');
    expect(redacted.firmwareVersion).toBe(record.firmwareVersion); // untouched
    expect(redacted.sessionId).toBe('s1'); // untouched
  });

  it('redactRawLogBytesForExport scrubs ASCII occurrences of the username, preserving byte length and every other byte', () => {
    const raw = Buffer.from('ota.bin: C:/Users/Benny/Desktop/tools/ota.bin\nDONE', 'ascii');
    const redacted = redactRawLogBytesForExport(raw, 'Benny');
    expect(redacted.length).toBe(raw.length); // byte length preserved — no offset corruption
    expect(redacted.toString('ascii')).toBe('ota.bin: C:/Users/xxxxx/Desktop/tools/ota.bin\nDONE');
  });

  it('redactRawLogBytesForExport is a safe no-op for a non-ASCII username (e.g. containing CJK characters) rather than attempting a risky partial byte match', () => {
    const raw = Buffer.from('hello world', 'ascii');
    const redacted = redactRawLogBytesForExport(raw, '教師');
    expect(redacted.equals(raw)).toBe(true);
  });

  it('redactRawLogBytesForExport never mutates the caller\'s original buffer', () => {
    const raw = Buffer.from('user: Benny', 'ascii');
    const original = Buffer.from(raw);
    redactRawLogBytesForExport(raw, 'Benny');
    expect(raw.equals(original)).toBe(true);
  });
});

describe('retention limits', () => {
  it('keeps only the newest sessions once more than the cap have been created, pruning both the .json and its raw sidecar', () => {
    const ids: string[] = [];
    for (let i = 0; i < 25; i++) {
      const handle = startFirmwareSession(userDataPath, baseInput);
      // Force a deterministic creation order — several of these can otherwise land in the same
      // millisecond in a tight loop, which would make "earliest pruned" nondeterministic.
      handle.update({ startedAtMs: i });
      handle.appendRawLogBytes(Buffer.from(`session ${i}`));
      handle.finish({ outcomeStatus: 'success' }); // finish() triggers pruning
      ids.push(handle.sessionId);
    }
    const summaries = listFirmwareSessions(userDataPath);
    expect(summaries.length).toBeLessThanOrEqual(20);
    // The earliest-created sessions are the ones pruned; the most recent survive.
    expect(summaries.some((s) => s.sessionId === ids[ids.length - 1])).toBe(true);
    expect(summaries.some((s) => s.sessionId === ids[0])).toBe(false);
    expect(readFullFirmwareSession(userDataPath, ids[0])).toBeNull();
  });
});

describe('export (via the pure building blocks — the Electron dialog/IPC wrapper lives in firmware.ts)', () => {
  it('the full pipeline (session -> list -> read -> redact) produces a self-consistent, exportable snapshot', () => {
    const handle = startFirmwareSession(userDataPath, { ...baseInput, entryBatPath: 'C:\\Users\\teacher\\Desktop\\tools\\download.bat' });
    handle.recordStage('launch', { workDir: 'C:\\Users\\teacher\\AppData\\firmwareRun' });
    handle.appendRawLogBytes(Buffer.from('download success\n', 'ascii'));
    handle.finish({
      outcomeStatus: 'success',
      outcomeReason: 'log-contains-download-success',
      decoderUsed: null,
      decodingFallbackApplied: true,
      toolProcessConfirmedFinished: true,
      successSignalDetected: true,
      processTerminationConfirmed: true,
    });

    const [summary] = listFirmwareSessions(userDataPath);
    const full = readFullFirmwareSession(userDataPath, summary.sessionId)!;
    const redactText = (text: string) => text.replace(/C:\\Users\\[^\\]+/g, '<path>');
    const redacted = redactSessionRecordForExport(full.record, redactText);

    expect(redacted.entryBatPath).toBe('<path>\\Desktop\\tools\\download.bat');
    expect(redacted.outcomeStatus).toBe('success');
    // The three deliberately-distinct fields are all present and independently set — never
    // collapsed into one another.
    expect(redacted.toolProcessConfirmedFinished).toBe(true);
    expect(redacted.successSignalDetected).toBe(true);
    expect(redacted.penFirmwareVersionVerified).toBe(false);
    expect(full.rawLogBytes.toString('ascii')).toBe('download success\n');
  });
});
