import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { PendingFirmwareRun } from '@shared/types';

const execFileAsync = promisify(execFile);

function pendingRunFilePath(): string {
  // Deliberately its own directory, NOT inside firmwareRun/ (the scratch dir startFirmwareUpgrade
  // wipes at the top of every run) — this marker must survive that wipe; it is only ever removed
  // by clearPendingRun(), once termination is actually confirmed.
  return path.join(app.getPath('userData'), 'firmwareRecovery', 'pending.json');
}

/**
 * Written just before the elevated launch is attempted (see startFirmwareUpgrade in
 * src/main/ipc/firmware.ts), so it survives an app crash or a plain quit while the real device
 * might still be mid-write. Cleared ONLY once process termination is confirmed — either by the
 * live run itself, or by a later recovery check finding no matching process.
 */
export function writePendingRun(info: PendingFirmwareRun): void {
  const p = pendingRunFilePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(info), 'utf-8');
}

export function readPendingRun(): PendingFirmwareRun | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(pendingRunFilePath(), 'utf-8'));
    if (
      parsed &&
      typeof parsed.startedAtMs === 'number' &&
      typeof parsed.workDir === 'string' &&
      typeof parsed.packageDir === 'string' &&
      typeof parsed.entryBatPath === 'string'
    ) {
      return parsed as PendingFirmwareRun;
    }
    return null;
  } catch {
    return null; // no file, or unreadable/corrupt — treated the same as "nothing pending"
  }
}

export function clearPendingRun(): void {
  try {
    fs.rmSync(pendingRunFilePath(), { force: true });
  } catch {
    // best-effort — a leftover file just means the next startup re-checks (and re-clears) it
  }
}

export interface RunningProcessInfo {
  pid: number;
  name: string | null;
  executablePath: string | null;
  commandLine: string | null;
}

/**
 * Real Windows-only process enumeration via CIM (gives CommandLine, unlike plain `tasklist`).
 * Strictly read-only — never signals, suspends, or terminates anything it finds. Throws on any
 * failure (powershell unavailable, timeout, malformed output); callers must treat a thrown error
 * as "unknown", never as "not running" — see `checkStillRunning`.
 */
export async function listRunningProcessesWindows(): Promise<RunningProcessInfo[]> {
  if (process.platform !== 'win32') return [];
  const { stdout } = await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress',
    ],
    { timeout: 15_000, maxBuffer: 16 * 1024 * 1024 },
  );
  const trimmed = stdout.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  const list = Array.isArray(parsed) ? parsed : [parsed]; // ConvertTo-Json yields a bare object, not a 1-item array, for a single result
  return list.map((p: { ProcessId: number; Name?: string; ExecutablePath?: string; CommandLine?: string }) => ({
    pid: p.ProcessId,
    name: p.Name ?? null,
    executablePath: p.ExecutablePath ?? null,
    commandLine: p.CommandLine ?? null,
  }));
}

/**
 * A running process "matches" a pending run if either its executable path or its full command
 * line mentions the run's scratch `workDir` (covers our own generated run.bat/run.ps1 and the
 * elevated cmd.exe host that ran them) or the vendor `packageDir` (covers isd_download.exe/
 * ufw_maker.exe/etc. launched from inside it). Deliberately a broad substring match rather than
 * an exact PID match: we never captured the elevated process's real PID in the first place —
 * `Start-Process -Verb RunAs -PassThru`'s `$p` is only assigned once `-Wait` itself returns,
 * which is exactly the thing we don't have across an app restart.
 */
export function matchesPendingRun(proc: RunningProcessInfo, pending: PendingFirmwareRun): boolean {
  const needles = [pending.workDir, pending.packageDir].map((s) => s.toLowerCase()).filter((s) => s.length > 0);
  const haystack = `${proc.executablePath ?? ''} ${proc.commandLine ?? ''}`.toLowerCase();
  return needles.some((needle) => haystack.includes(needle));
}

export type StillRunningResult = 'running' | 'not-running' | 'unknown';

/**
 * Never kills, signals, or otherwise touches anything it finds — read-only enumeration plus a
 * string match. `listProcesses` is injectable so tests can simulate "still running"/"not
 * running"/a failed check without a real elevated process; production always uses the real
 * `listRunningProcessesWindows`. Any failure enumerating is reported as 'unknown', never
 * 'not-running' — a failed check must never be treated as safe to proceed.
 */
export async function checkStillRunning(
  pending: PendingFirmwareRun,
  listProcesses: () => Promise<RunningProcessInfo[]> = listRunningProcessesWindows,
): Promise<StillRunningResult> {
  let processes: RunningProcessInfo[];
  try {
    processes = await listProcesses();
  } catch {
    return 'unknown';
  }
  return processes.some((p) => matchesPendingRun(p, pending)) ? 'running' : 'not-running';
}
