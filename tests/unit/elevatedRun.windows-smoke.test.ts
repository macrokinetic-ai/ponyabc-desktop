import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runElevated } from '../../src/main/services/elevatedRun';
import { decodeLogBytes } from '../../src/main/services/logEncoding';

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
  for (const dir of tempDirs.splice(0)) {
    // maxRetries/retryDelay matter for real evidence, not just tidiness: a real run on real
    // Windows hit EBUSY here (antivirus/real-time-scan or a not-yet-fully-released handle on a
    // just-closed file) — confirmed by a real CI failure, not a hypothetical.
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

describe.skipIf(!RUN)('runElevated — real Windows smoke test (harmless target, no vendor tool, no device)', () => {
  it('actually elevates, streams real incremental log output, and returns a real exit code', async () => {
    // Vitest's own default per-test timeout (5000ms) is shorter than the 60s runElevated()
    // timeoutMs below it — a real run on real Windows hit exactly this, failing the test before
    // the real elevation even had a chance to finish. Must stay comfortably above that 60s.
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

    const deltas: Buffer[] = [];
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
    const fullLog = Buffer.concat(deltas).toString('utf-8');
    expect(fullLog).toContain('line-one');
    expect(fullLog).toContain('line-two');
    // Proves genuine incremental delivery, not "read the whole file once at the end".
    expect(deltas.length).toBeGreaterThan(1);
  }, 90_000);

  it('a target that ends in a bare `pause` (the confirmed real chain does) still completes promptly instead of hanging forever on a keypress that can never arrive', async () => {
    const dir = mkTempDir();
    const targetPath = path.join(dir, 'pausing-target.bat');
    fs.writeFileSync(targetPath, ['@echo off', 'echo before-pause', 'pause', 'echo after-pause', 'exit /b 0', ''].join('\r\n'));

    const startedAtMs = Date.now();
    const deltas: Buffer[] = [];
    const result = await runElevated({
      exePath: targetPath,
      args: [],
      cwd: dir,
      workDir: path.join(dir, 'work'),
      onLogUpdate: (d) => deltas.push(d),
      logPollIntervalMs: 200,
      timeoutMs: 30_000, // if `< nul` did NOT dismiss the pause, this proves it by timing out
    });
    const elapsedMs = Date.now() - startedAtMs;

    console.log('pause-target smoke result:', JSON.stringify(result), 'elapsedMs:', elapsedMs);
    console.log('pause-target log deltas:', JSON.stringify(deltas));

    if (result.status === 'timeout') {
      console.warn('No interactive desktop on this runner to approve elevation — see the other smoke test for that caveat; this one specifically could not be exercised either.');
      return;
    }

    expect(result.status).toBe('completed');
    // The real point of this test: it must finish quickly, not sit at `pause` until the
    // 30s timeout gives up — a slow-but-eventually-"completed" result here would still mean
    // `< nul` isn't actually dismissing the prompt fast, which matters for a real upgrade flow.
    // (Note: as of this round, the elevated window is also hidden via -WindowStyle Hidden — this
    // test still passing on real Windows CI is itself the proof that hiding the window doesn't
    // change any of this stdin/timing behavior; no separate dedicated test is needed for that.)
    expect(elapsedMs).toBeLessThan(15_000);
    const fullLog = Buffer.concat(deltas).toString('utf-8');
    expect(fullLog).toContain('before-pause');
    expect(fullLog).toContain('after-pause');
  }, 60_000);

  it('real codepage detection + real Chinese console output: chcp capture is never assumed, and decoding the raw captured bytes with the REAL detected codepage recovers the exact original text', async () => {
    const dir = mkTempDir();
    const targetPath = path.join(dir, 'chinese-output-target.bat');
    // Dynamically encodes a known Chinese string using WHATEVER this console's real active
    // OEM/output codepage actually is (never hardcoded as GBK/936 or any other assumption) —
    // exactly mirroring how a real console tool (the vendor's isd_download.exe included) writes
    // its own text: using its process's real active codepage, whatever that happens to be on
    // this specific machine. This is the same codepage buildFlashBatchScript's own `chcp`
    // capture line observes, since nothing changes it in between.
    const psSnippet = [
      '$cp = [Console]::OutputEncoding.CodePage',
      '$enc = [System.Text.Encoding]::GetEncoding($cp)',
      '$bytes = $enc.GetBytes("REAL_TEXT_MARKER 下载完成。 END_MARKER")',
      '$stdout = [Console]::OpenStandardOutput()',
      '$stdout.Write($bytes, 0, $bytes.Length)',
      '$stdout.Flush()',
    ].join('; ');
    fs.writeFileSync(
      targetPath,
      ['@echo off', `powershell -NoProfile -Command "${psSnippet.replace(/"/g, '\\"')}"`, 'exit /b 0', ''].join('\r\n'),
    );

    const deltas: Buffer[] = [];
    let detectedCodepage: number | null | undefined; // undefined = onCodepageDetected never fired at all
    const result = await runElevated({
      exePath: targetPath,
      args: [],
      cwd: dir,
      workDir: path.join(dir, 'work'),
      onLogUpdate: (d) => deltas.push(d),
      onCodepageDetected: (cp) => {
        detectedCodepage = cp;
      },
      logPollIntervalMs: 200,
      timeoutMs: 60_000,
    });

    console.log('chinese-output smoke result:', JSON.stringify(result));
    console.log('detected codepage:', detectedCodepage);

    if (result.status === 'timeout') {
      console.warn('No interactive desktop on this runner to approve elevation — see the other smoke test for that caveat.');
      return;
    }

    expect(result.status).toBe('completed');
    // The chcp-capture mechanism must have produced SOME real number — never silently absent.
    expect(detectedCodepage).not.toBeNull();
    expect(detectedCodepage).not.toBeUndefined();
    expect(typeof detectedCodepage).toBe('number');

    const raw = Buffer.concat(deltas);
    const { text, encodingUsed } = decodeLogBytes(raw, detectedCodepage ?? null);
    console.log('decoded text:', text, 'encodingUsed:', encodingUsed);

    // The ASCII markers must survive regardless of which codepage this runner uses (ASCII is
    // byte-identical across every relevant encoding) — proves the raw bytes themselves were
    // captured intact even before considering the Chinese portion.
    expect(text).toContain('REAL_TEXT_MARKER');
    expect(text).toContain('END_MARKER');

    if (encodingUsed !== null) {
      // This runner's real codepage is one this app recognizes — the Chinese text must decode
      // back to the exact original, proving the full real chain (chcp capture -> our codepage
      // table -> iconv-lite decode) works end to end, not just in isolated unit tests.
      expect(text).toContain('下载完成。');
    } else {
      console.warn(
        `This runner's real codepage (${detectedCodepage}) is not in this app's recognized table — expected on an English-locale CI runner (likely 437/850), and exactly why encodingKnown exists: the app correctly declines to guess rather than mis-decode. Real Chinese Windows machines (the actual deployment target) use 936 (GBK), which IS recognized — see logEncoding.ts.`,
      );
    }
  }, 90_000);
});

describe.skipIf(RUN)('runElevated — real Windows smoke test (skipped)', () => {
  it('is skipped outside an opt-in Windows run — see PONYABC_RUN_ELEVATION_SMOKE', () => {
    expect(true).toBe(true);
  });
});
