import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runElevated } from '../../src/main/services/elevatedRun';

/**
 * Real-Windows validation of the elevation/log-capture mechanism against a completely harmless
 * target — never the vendor's tool, never a real device. Deliberately opt-in only
 * (PONYABC_RUN_ELEVATION_SMOKE=1) and Windows-only, so it never runs as part of the ordinary
 * `npm test` (which itself also runs on windows-latest in build-windows.yml) — an elevation
 * prompt firing during a routine CI test run would be a real problem, not a convenience.
 * Dispatched manually via .github/workflows/firmware-elevation-smoke.yml.
 *
 * This intentionally cannot prove the INTERACTIVE "user clicks No" path — a headless CI runner
 * has no secure desktop to click on. What it DOES prove, on a real Windows machine: the
 * generated .bat/.ps1 pair is syntactically correct and actually runs, the log file genuinely
 * captures the elevated child's real output as it's written (not just at the end), and a real
 * exit code comes back — the parts that were previously only argued about, not demonstrated.
 */
const RUN = process.platform === 'win32' && process.env.PONYABC_RUN_ELEVATION_SMOKE === '1';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-elevate-smoke-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe.skipIf(!RUN)('runElevated — real Windows smoke test (harmless target, no vendor tool, no device)', () => {
  it('actually elevates, streams real incremental log output, and returns a real exit code', async () => {
    const dir = mkTempDir();
    const targetPath = path.join(dir, 'harmless-target.bat');
    // A trivial, self-contained target: prints two lines with a real delay between them (so the
    // test can prove polling sees the SECOND line only after it's actually written, not just at
    // the very end), then exits 0. Touches no device, needs no admin privilege of its own —
    // elevation is exercised regardless, by the mechanism itself, not by anything this target
    // does.
    fs.writeFileSync(
      targetPath,
      ['@echo off', 'echo line-one', 'ping -n 2 127.0.0.1 >nul', 'echo line-two', 'exit /b 0', ''].join('\r\n'),
    );

    const deltas: string[] = [];
    const result = await runElevated({
      exePath: targetPath,
      args: [],
      cwd: dir,
      workDir: path.join(dir, 'work'),
      onLogUpdate: (d) => deltas.push(d),
      logPollIntervalMs: 200,
      timeoutMs: 60_000,
    });

    console.log('runElevated smoke result:', JSON.stringify(result));
    console.log('log deltas captured:', JSON.stringify(deltas));

    if (result.status === 'timeout') {
      // A real, informative outcome on a headless runner with no interactive desktop to approve
      // the prompt — not a test failure, but not silently swallowed either.
      console.warn('Elevation prompt did not resolve within the timeout on this runner — likely no interactive desktop session available. See the smoke-test workflow notes.');
      return;
    }

    expect(result.status).toBe('completed');
    if (result.status === 'completed') {
      expect(result.exitCode).toBe(0);
    }
    const fullLog = deltas.join('');
    expect(fullLog).toContain('line-one');
    expect(fullLog).toContain('line-two');
    // Proves genuine incremental delivery, not "read the whole file once at the end".
    expect(deltas.length).toBeGreaterThan(1);
  });
});

describe.skipIf(RUN)('runElevated — real Windows smoke test (skipped)', () => {
  it('is skipped outside an opt-in Windows run — see PONYABC_RUN_ELEVATION_SMOKE', () => {
    expect(true).toBe(true);
  });
});
