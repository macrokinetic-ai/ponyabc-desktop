import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PendingFirmwareRun } from '../../src/shared/types';

const h = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userDataDir : '') },
}));

import {
  checkStillRunning,
  clearPendingRun,
  matchesPendingRun,
  readPendingRun,
  writePendingRun,
  type RunningProcessInfo,
} from '../../src/main/services/firmwareRecovery';

const tempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

const samplePending: PendingFirmwareRun = {
  startedAtMs: 1_700_000_000_000,
  workDir: 'C:\\Users\\teacher\\AppData\\Roaming\\ponyabc-desktop\\firmwareRun',
  packageDir: 'C:\\Users\\teacher\\Desktop\\tools',
  entryBatPath: 'C:\\Users\\teacher\\Desktop\\tools\\download.bat',
};

beforeEach(() => {
  h.userDataDir = mkTempDir('ponyabc-userdata-');
});
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('writePendingRun / readPendingRun / clearPendingRun — persisted marker survives across "restarts"', () => {
  it('round-trips exactly what was written', () => {
    expect(readPendingRun()).toBeNull();
    writePendingRun(samplePending);
    expect(readPendingRun()).toEqual(samplePending);
  });

  it('is not inside the transient firmwareRun/ workDir that gets wiped every run', () => {
    writePendingRun(samplePending);
    // The marker must live somewhere firmware.ts's `fs.rmSync(workDir, {recursive:true})` never
    // touches — assert its actual on-disk location is a sibling directory, not under workDir.
    const marker = path.join(h.userDataDir, 'firmwareRecovery', 'pending.json');
    expect(fs.existsSync(marker)).toBe(true);
    fs.rmSync(path.join(h.userDataDir, 'firmwareRun'), { recursive: true, force: true }); // simulates the wipe
    expect(readPendingRun()).toEqual(samplePending); // untouched by it
  });

  it('returns null, never throws, for missing or corrupt data', () => {
    expect(readPendingRun()).toBeNull();
    const marker = path.join(h.userDataDir, 'firmwareRecovery', 'pending.json');
    fs.mkdirSync(path.dirname(marker), { recursive: true });
    fs.writeFileSync(marker, 'not valid json{{{');
    expect(readPendingRun()).toBeNull();
    fs.writeFileSync(marker, JSON.stringify({ startedAtMs: 1 })); // missing required fields
    expect(readPendingRun()).toBeNull();
  });

  it('clearPendingRun removes it, and is a safe no-op when nothing is there', () => {
    writePendingRun(samplePending);
    clearPendingRun();
    expect(readPendingRun()).toBeNull();
    expect(() => clearPendingRun()).not.toThrow();
  });
});

describe('matchesPendingRun — pure string matching, no process access', () => {
  const noMatch: RunningProcessInfo = { pid: 1, name: 'notepad.exe', executablePath: 'C:\\Windows\\notepad.exe', commandLine: 'notepad.exe' };

  it('matches when the command line mentions the pending workDir (covers our own run.bat/run.ps1/cmd.exe host)', () => {
    const proc: RunningProcessInfo = {
      pid: 100,
      name: 'cmd.exe',
      executablePath: 'C:\\Windows\\System32\\cmd.exe',
      commandLine: 'cmd.exe /c "C:\\Users\\teacher\\AppData\\Roaming\\ponyabc-desktop\\firmwareRun\\run.bat"',
    };
    expect(matchesPendingRun(proc, samplePending)).toBe(true);
  });

  it('matches when the executable path is inside the pending packageDir (covers isd_download.exe/ufw_maker.exe)', () => {
    const proc: RunningProcessInfo = {
      pid: 101,
      name: 'isd_download.exe',
      executablePath: 'C:\\Users\\teacher\\Desktop\\tools\\isd_download.exe',
      commandLine: null,
    };
    expect(matchesPendingRun(proc, samplePending)).toBe(true);
  });

  it('matches case-insensitively', () => {
    const proc: RunningProcessInfo = {
      pid: 102,
      name: 'isd_download.exe',
      executablePath: 'C:\\USERS\\TEACHER\\DESKTOP\\TOOLS\\ISD_DOWNLOAD.EXE',
      commandLine: null,
    };
    expect(matchesPendingRun(proc, samplePending)).toBe(true);
  });

  it('does not match an unrelated process', () => {
    expect(matchesPendingRun(noMatch, samplePending)).toBe(false);
  });

  it('handles null executablePath/commandLine without throwing', () => {
    expect(matchesPendingRun({ pid: 1, name: null, executablePath: null, commandLine: null }, samplePending)).toBe(false);
  });
});

describe('checkStillRunning — injectable lister, no real process access', () => {
  it('"running" when a matching process is in the list', async () => {
    const list = async (): Promise<RunningProcessInfo[]> => [
      { pid: 1, name: 'notepad.exe', executablePath: 'C:\\notepad.exe', commandLine: null },
      { pid: 2, name: 'isd_download.exe', executablePath: 'C:\\Users\\teacher\\Desktop\\tools\\isd_download.exe', commandLine: null },
    ];
    expect(await checkStillRunning(samplePending, list)).toBe('running');
  });

  it('"not-running" when nothing matches (including an empty list)', async () => {
    expect(await checkStillRunning(samplePending, async () => [])).toBe('not-running');
    expect(
      await checkStillRunning(samplePending, async () => [{ pid: 1, name: 'notepad.exe', executablePath: 'C:\\notepad.exe', commandLine: null }]),
    ).toBe('not-running');
  });

  it('"unknown" (never "not-running") when the listing itself fails — a failed check must never be treated as safe', async () => {
    expect(
      await checkStillRunning(samplePending, async () => {
        throw new Error('powershell unavailable');
      }),
    ).toBe('unknown');
  });
});
