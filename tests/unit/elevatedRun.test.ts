import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildElevationPowerShellScript,
  buildFlashBatchScript,
  parseElevationOutput,
  runElevated,
  startLogPolling,
} from '../../src/main/services/elevatedRun';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-elevate-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('buildFlashBatchScript — pure script generation, no process/filesystem access', () => {
  it('quotes the exe path, cwd, every argument, and the log path — even ones with no spaces', () => {
    const script = buildFlashBatchScript({
      exePath: 'C:\\tools\\isd_download.exe',
      args: ['-dev', 'br23', '-app', 'app.bin'],
      cwd: 'C:\\tools\\soundbox\\standard',
      logFilePath: 'C:\\scratch\\run.log',
      codepageFilePath: 'C:\\scratch\\codepage.txt',
    });
    expect(script).toContain('cd /d "C:\\tools\\soundbox\\standard"');
    expect(script).toContain('"C:\\tools\\isd_download.exe" "-dev" "br23" "-app" "app.bin" < nul > "C:\\scratch\\run.log" 2>&1');
    expect(script).toContain('exit /b %errorlevel%');
  });

  it('captures the real active codepage via chcp, BEFORE the target ever runs — never assumes an encoding', () => {
    const script = buildFlashBatchScript({
      exePath: 'C:\\a.exe',
      args: [],
      cwd: 'C:\\',
      logFilePath: 'C:\\a.log',
      codepageFilePath: 'C:\\codepage.txt',
    });
    const lines = script.split('\r\n').filter((l) => l.length > 0);
    expect(lines[0]).toBe('@echo off');
    expect(lines[1]).toBe('chcp > "C:\\codepage.txt"');
    // Must run before `cd` and before the target — first real command after @echo off.
    expect(lines.indexOf('chcp > "C:\\codepage.txt"')).toBeLessThan(lines.findIndex((l) => l.startsWith('cd /d')));
  });

  it('escapes an embedded double-quote in an argument as "" (the batch-file convention)', () => {
    const script = buildFlashBatchScript({
      exePath: 'C:\\a.exe',
      args: ['weird"arg'],
      cwd: 'C:\\',
      logFilePath: 'C:\\a.log',
      codepageFilePath: 'C:\\codepage.txt',
    });
    expect(script).toContain('"weird""arg"');
  });

  it('produces a valid line even with zero arguments', () => {
    const script = buildFlashBatchScript({
      exePath: 'C:\\a.exe',
      args: [],
      cwd: 'C:\\',
      logFilePath: 'C:\\a.log',
      codepageFilePath: 'C:\\codepage.txt',
    });
    expect(script).toContain('"C:\\a.exe" < nul > "C:\\a.log" 2>&1');
  });

  it('always redirects the target\'s stdin from nul — the confirmed real chain (tools\\download.bat) ends in a bare `pause`, which would otherwise hang forever waiting for a keypress that can never arrive', () => {
    const script = buildFlashBatchScript({
      exePath: 'C:\\tools\\download.bat',
      args: [],
      cwd: 'C:\\tools',
      logFilePath: 'C:\\scratch\\run.log',
      codepageFilePath: 'C:\\scratch\\codepage.txt',
    });
    expect(script).toContain('< nul');
  });
});

describe('buildElevationPowerShellScript — pure', () => {
  it('elevates exactly the given batch path via -Verb RunAs -WindowStyle Hidden -Wait -PassThru', () => {
    const script = buildElevationPowerShellScript('C:\\scratch\\run.bat');
    // -WindowStyle Hidden hides the elevated console window from the user — a pure display
    // property that does not affect -Wait/-PassThru's exit-code contract or stdin/stdout
    // redirection at all (verified for real on Windows CI, not assumed — see
    // .github/workflows/firmware-log-encoding-smoke.yml).
    expect(script).toContain("Start-Process -FilePath 'C:\\scratch\\run.bat' -Verb RunAs -WindowStyle Hidden -Wait -PassThru");
    expect(script).toContain('Write-Output "EXITCODE:$($p.ExitCode)"');
  });

  it("recognizes a declined UAC prompt (Win32 1223 / 'cancelled by the user') as DECLINED, distinct from other launch failures", () => {
    const script = buildElevationPowerShellScript("C:\\scratch\\run.bat");
    expect(script).toContain('$native -eq 1223');
    expect(script).toContain("cancell?ed by the user");
    expect(script).toContain('Write-Output "DECLINED"');
  });

  it("escapes an embedded single-quote in the batch path (PowerShell's own quoting convention)", () => {
    const script = buildElevationPowerShellScript("C:\\weird'path\\run.bat");
    expect(script).toContain("'C:\\weird''path\\run.bat'");
  });
});

describe('parseElevationOutput — pure', () => {
  it('parses a completed run\'s real exit code, including a non-zero failure code', () => {
    expect(parseElevationOutput('EXITCODE:0')).toEqual({ status: 'completed', exitCode: 0 });
    expect(parseElevationOutput('some noise\nEXITCODE:1\n')).toEqual({ status: 'completed', exitCode: 1 });
    expect(parseElevationOutput('EXITCODE:-1')).toEqual({ status: 'completed', exitCode: -1 });
  });

  it('parses a declined UAC prompt', () => {
    expect(parseElevationOutput('DECLINED')).toEqual({ status: 'declined' });
  });

  it('parses a launch error with its message, never silently treating it as success', () => {
    const result = parseElevationOutput('LAUNCH_ERROR:The system cannot find the file specified');
    expect(result).toEqual({ status: 'launch-error', message: 'The system cannot find the file specified' });
  });

  it('falls back to "unparseable" (never a guessed success) for unrecognized output', () => {
    expect(parseElevationOutput('')).toEqual({ status: 'unparseable', raw: '' });
    expect(parseElevationOutput('totally unexpected text')).toEqual({ status: 'unparseable', raw: 'totally unexpected text' });
  });
});

describe('startLogPolling — real filesystem, no elevation/process involved', () => {
  it('reports only the newly-appended RAW BYTES on each poll, never re-sending what was already read, never pre-decoded', async () => {
    const dir = mkTempDir();
    const logPath = path.join(dir, 'run.log');
    const deltas: Buffer[] = [];
    const poller = startLogPolling(logPath, (d) => deltas.push(d), 30);

    await new Promise((r) => setTimeout(r, 60)); // let it poll once while the file doesn't exist yet
    fs.writeFileSync(logPath, 'line1\n');
    await new Promise((r) => setTimeout(r, 80));
    fs.appendFileSync(logPath, 'line2\n');
    await new Promise((r) => setTimeout(r, 80));
    await poller.stop();

    expect(deltas.every((d) => Buffer.isBuffer(d))).toBe(true);
    expect(Buffer.concat(deltas).toString('utf-8')).toBe('line1\nline2\n');
    // Confirms no re-delivery: each individual delta is a strict subset of the total, and the
    // concat above already proves nothing was duplicated or dropped.
    expect(deltas.length).toBeGreaterThanOrEqual(2);
  });

  it('tolerates the log file never being created at all (target failed before writing anything)', async () => {
    const dir = mkTempDir();
    const deltas: Buffer[] = [];
    const poller = startLogPolling(path.join(dir, 'never-created.log'), (d) => deltas.push(d), 20);
    await new Promise((r) => setTimeout(r, 60));
    await poller.stop();
    expect(deltas).toEqual([]);
  });

  it('the final stop() call still captures content written right before stopping', async () => {
    const dir = mkTempDir();
    const logPath = path.join(dir, 'run.log');
    fs.writeFileSync(logPath, '');
    const deltas: Buffer[] = [];
    const poller = startLogPolling(logPath, (d) => deltas.push(d), 10_000); // long interval — only stop()'s own final read should catch this
    fs.writeFileSync(logPath, 'final line\n');
    await poller.stop();
    expect(Buffer.concat(deltas).toString('utf-8')).toBe('final line\n');
  });

  it('a multi-byte character (e.g. GBK-encoded Chinese) split exactly across two separate poll reads is preserved intact once the full raw bytes are concatenated — never corrupted by decoding a partial chunk in isolation', async () => {
    const iconv = await import('iconv-lite');
    const fullBytes = iconv.encode('下载完成。', 'gbk'); // 10 bytes, 5 two-byte GBK characters
    const splitPoint = 3; // lands mid-character (character boundaries are at even offsets)
    const dir = mkTempDir();
    const logPath = path.join(dir, 'run.log');
    fs.writeFileSync(logPath, fullBytes.subarray(0, splitPoint));
    const deltas: Buffer[] = [];
    const poller = startLogPolling(logPath, (d) => deltas.push(d), 30);
    await new Promise((r) => setTimeout(r, 60));
    fs.appendFileSync(logPath, fullBytes.subarray(splitPoint));
    await new Promise((r) => setTimeout(r, 60));
    await poller.stop();

    const { decodeLogBytes } = await import('../../src/main/services/logEncoding');
    const { text } = decodeLogBytes(Buffer.concat(deltas), 936);
    expect(text).toBe('下载完成。');
  });
});

describe('runElevated — platform gating', () => {
  it('returns {status:"unsupported-platform"} immediately on non-Windows, touching no filesystem/process', async () => {
    if (process.platform === 'win32') return; // this test's whole point is the non-Windows path
    const result = await runElevated({
      exePath: 'C:\\whatever.exe',
      args: [],
      cwd: 'C:\\',
      workDir: '/nonexistent/should-never-be-created',
    });
    expect(result).toEqual({ status: 'unsupported-platform' });
    expect(fs.existsSync('/nonexistent/should-never-be-created')).toBe(false);
  });
});
