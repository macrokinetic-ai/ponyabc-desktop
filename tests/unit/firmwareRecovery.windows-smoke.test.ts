import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { checkStillRunning } from '../../src/main/services/firmwareRecovery';
import type { PendingFirmwareRun } from '../../src/shared/types';

/**
 * Real-Windows validation of "app closed/reopened while an external process may still be
 * running" — the exact scenario the 2026-09-15 cross-restart recovery fix is for. Spawns a
 * completely harmless, genuinely-still-running placeholder process (never the vendor tool, never
 * a real device) whose location matches a synthetic PendingFirmwareRun, then runs the REAL
 * `checkStillRunning` (real `Get-CimInstance Win32_Process` enumeration, not the mocked version
 * used everywhere else) against the real OS process table. Deliberately opt-in only
 * (PONYABC_RUN_RECOVERY_SMOKE=1) and Windows-only — process enumeration + a real spawned process
 * is slow enough, and Windows-specific enough, that it has no place in the ordinary `npm test`
 * run. Dispatched manually via .github/workflows/firmware-recovery-smoke.yml.
 *
 * This intentionally never touches src/main/ipc/firmware.ts's lock/IPC orchestration (that's
 * covered, fully simulated, by tests/unit/firmwareIpc.test.ts) — the one thing that can't be
 * simulated and genuinely needs a real OS is whether `checkStillRunning`'s real process
 * enumeration + string matching actually finds a real still-running process and actually stops
 * finding it once that process exits.
 */
const RUN = process.platform === 'win32' && process.env.PONYABC_RUN_RECOVERY_SMOKE === '1';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-recovery-smoke-'));
  tempDirs.push(dir);
  return dir;
}
const spawned: ChildProcess[] = [];
afterEach(() => {
  for (const child of spawned.splice(0)) {
    if (child.pid && !child.killed) {
      try {
        // Our own harmless placeholder, never the vendor tool — plain test cleanup, not the
        // app's production behavior (which never auto-terminates anything real).
        spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
      } catch {
        // best-effort
      }
    }
  }
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

describe.skipIf(!RUN)('checkStillRunning — real Windows smoke test (harmless placeholder, no vendor tool, no device)', () => {
  it('finds a genuinely still-running harmless placeholder process, then correctly reports it gone once it actually exits', async () => {
    const packageDir = mkTempDir();
    const placeholderPath = path.join(packageDir, 'placeholder.bat');
    // Sleeps for up to 60s — long enough for the test to reliably observe it while running; the
    // test kills it well before that via taskkill, it never runs to completion.
    fs.writeFileSync(placeholderPath, ['@echo off', 'ping -n 60 127.0.0.1 >nul', ''].join('\r\n'));

    const pending: PendingFirmwareRun = {
      startedAtMs: Date.now(),
      workDir: path.join(packageDir, 'does-not-need-to-exist'),
      packageDir,
      entryBatPath: placeholderPath,
    };

    const child = spawn('cmd.exe', ['/c', placeholderPath], { cwd: packageDir, detached: true, stdio: 'ignore', windowsHide: true });
    spawned.push(child);
    // Give the OS a moment to actually register the process before the first check.
    await new Promise((r) => setTimeout(r, 1000));

    const whileRunning = await checkStillRunning(pending);
    console.log('checkStillRunning while the placeholder is still running:', whileRunning);
    expect(whileRunning).toBe('running');

    // Kill our own placeholder (test cleanup of a harmless stand-in — not the production
    // "never auto-terminate the flashing tool" behavior, which is about the real vendor tool).
    await new Promise<void>((resolve) => {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f']);
      killer.on('close', () => resolve());
      killer.on('error', () => resolve());
    });
    await new Promise((r) => setTimeout(r, 1500)); // let the OS actually remove it from the process table

    const afterExit = await checkStillRunning(pending);
    console.log('checkStillRunning after the placeholder was killed:', afterExit);
    expect(afterExit).toBe('not-running');
  }, 30_000);

  it('reports "not-running" for a pending run nothing was ever spawned for, in the same real environment', async () => {
    const packageDir = mkTempDir();
    const pending: PendingFirmwareRun = {
      startedAtMs: Date.now(),
      workDir: path.join(packageDir, 'work'),
      packageDir,
      entryBatPath: path.join(packageDir, 'never-run.bat'),
    };
    expect(await checkStillRunning(pending)).toBe('not-running');
  }, 15_000);
});

describe.skipIf(RUN)('checkStillRunning — real Windows smoke test (skipped)', () => {
  it('is skipped outside an opt-in Windows run — see PONYABC_RUN_RECOVERY_SMOKE', () => {
    expect(true).toBe(true);
  });
});
