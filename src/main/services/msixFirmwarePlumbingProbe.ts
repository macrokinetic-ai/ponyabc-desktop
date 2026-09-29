import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';
import { runElevated, type RunElevatedResult } from './elevatedRun';
import { checkStillRunning, clearPendingRun, readPendingRun, writePendingRun } from './firmwareRecovery';

/**
 * Test/diagnostic-only, never wired into any real firmware IPC path. Exercises the REAL
 * production functions used by the firmware wizard (runElevated, writePendingRun/readPendingRun/
 * clearPendingRun/checkStillRunning) against the REAL directories `startFirmwareUpgrade` uses
 * (`<userData>/firmwareRun`, `<userData>/firmwareDownloads/...`, `<userData>/firmwareRecovery/
 * pending.json`) — but with a harmless, obviously-not-a-vendor-file batch script standing in for
 * the downloaded vendor tool. Never touches a real vendor executable, never signals or requires a
 * real pen. Exists specifically to answer, empirically rather than by assumption, whether the
 * elevated child process (spawned via `Start-Process -Verb RunAs`, see elevatedRun.ts) can find
 * and read files the packaged (MSIX) parent process wrote under `app.getPath('userData')` — the
 * open risk documented in tasks/todo.md's MSIX section. Triggered only via
 * PONYABC_MSIX_FIRMWARE_PROBE=1 (see src/main/index.ts) — never runs otherwise.
 *
 * Optional PONYABC_MSIX_PROBE_DELAY_SECONDS (1-60, integer): the probe-tool.bat pauses for this
 * long (the standard harmless `ping -n <n> 127.0.0.1 >nul` batch-delay technique, same one
 * already used in elevatedRun.windows-smoke.test.ts) BEFORE printing its marker. Without this,
 * the harmless script finishes in well under a second — far too fast for a human tester to
 * deliberately interrupt mid-flight to test the app's crash/interruption recovery behavior. This
 * changes nothing else about the probe; it's purely a window of time for a human to act in.
 */

const EXPECTED_MARKER = 'PONYABC_MSIX_PROBE_OK';
const MAX_PROBE_DELAY_SECONDS = 60;

function parseProbeDelaySeconds(): number {
  const raw = process.env.PONYABC_MSIX_PROBE_DELAY_SECONDS;
  if (!raw) return 0;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.min(n, MAX_PROBE_DELAY_SECONDS);
}

export interface MsixFirmwarePlumbingProbeResult {
  userDataPath: string;
  workDir: string;
  packageDir: string;
  probeToolPath: string;
  recoveryMarkerReadBackImmediately: boolean;
  elevation: RunElevatedResult;
  logFileExisted: boolean;
  logContents: string | null;
  logContainsExpectedMarker: boolean;
  stillRunningAfterCompletion: 'running' | 'not-running' | 'unknown' | null;
  errors: string[];
}

export async function runMsixFirmwarePlumbingProbe(): Promise<MsixFirmwarePlumbingProbeResult> {
  const errors: string[] = [];
  const userDataPath = app.getPath('userData');
  // Same real paths startFirmwareUpgrade (src/main/ipc/firmware.ts) uses — this is the whole
  // point: prove the real paths work, not a path chosen to be convenient for the probe.
  const workDir = path.join(userDataPath, 'firmwareRun');
  const packageDir = path.join(userDataPath, 'firmwareDownloads', 'msix-plumbing-probe');
  const probeToolPath = path.join(packageDir, 'probe-tool.bat');

  fs.rmSync(workDir, { recursive: true, force: true });
  fs.rmSync(packageDir, { recursive: true, force: true });
  fs.mkdirSync(packageDir, { recursive: true });
  // Harmless stand-in for a vendor tool: optionally pauses (see parseProbeDelaySeconds above),
  // then prints a marker and exits 0. No network, no hardware, no vendor binary of any kind.
  const delaySeconds = parseProbeDelaySeconds();
  const batchLines = ['@echo off'];
  if (delaySeconds > 0) batchLines.push(`ping -n ${delaySeconds + 1} 127.0.0.1 >nul`);
  batchLines.push(`echo ${EXPECTED_MARKER}`, 'exit /b 0', '');
  fs.writeFileSync(probeToolPath, batchLines.join('\r\n'), 'utf-8');

  const startedAtMs = Date.now();
  writePendingRun({ startedAtMs, workDir, packageDir, entryBatPath: probeToolPath });
  let recoveryMarkerReadBackImmediately = false;
  try {
    recoveryMarkerReadBackImmediately = readPendingRun() !== null;
  } catch (err) {
    errors.push(`readPendingRun threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Generous timeout on purpose: a hung/blocked interactive UAC prompt in a non-interactive CI
  // session is itself a meaningful, reportable finding, not something to paper over with a short
  // timeout that would just look like a generic failure.
  const elevation = await runElevated({ exePath: probeToolPath, args: [], cwd: packageDir, workDir, timeoutMs: 120_000 });

  const logPath = path.join(workDir, 'run.log');
  let logFileExisted = false;
  let logContents: string | null = null;
  try {
    logContents = fs.readFileSync(logPath, 'utf-8');
    logFileExisted = true;
  } catch (err) {
    errors.push(`could not read run.log at ${logPath}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const logContainsExpectedMarker = logContents != null && logContents.includes(EXPECTED_MARKER);

  let stillRunningAfterCompletion: 'running' | 'not-running' | 'unknown' | null = null;
  try {
    stillRunningAfterCompletion = await checkStillRunning({ startedAtMs, workDir, packageDir, entryBatPath: probeToolPath });
  } catch (err) {
    errors.push(`checkStillRunning threw: ${err instanceof Error ? err.message : String(err)}`);
  }

  clearPendingRun();

  return {
    userDataPath,
    workDir,
    packageDir,
    probeToolPath,
    recoveryMarkerReadBackImmediately,
    elevation,
    logFileExisted,
    logContents,
    logContainsExpectedMarker,
    stillRunningAfterCompletion,
    errors,
  };
}
