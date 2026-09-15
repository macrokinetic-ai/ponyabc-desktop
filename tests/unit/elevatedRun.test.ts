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
    });
    expect(script).toContain('cd /d "C:\\tools\\soundbox\\standard"');
    expect(script).toContain('"C:\\tools\\isd_download.exe" "-dev" "br23" "-app" "app.bin" > "C:\\scratch\\run.log" 2>&1');
    expect(script).toContain('exit /b %errorlevel%');
  });

  it('escapes an embedded double-quote in an argument as "" (the batch-file convention)', () => {
    const script = buildFlashBatchScript({
      exePath: 'C:\\a.exe',
      args: ['weird"arg'],
      cwd: 'C:\\',
      logFilePath: 'C:\\a.log',
    });
    expect(script).toContain('"weird""arg"');
  });

  it('produces a valid line even with zero arguments', () => {
    const script = buildFlashBatchScript({ exePath: 'C:\\a.exe', args: [], cwd: 'C:\\', logFilePath: 'C:\\a.log' });
    expect(script).toContain('"C:\\a.exe" > "C:\\a.log" 2>&1');
  });
});

describe('buildElevationPowerShellScript — pure', () => {
  it('elevates exactly the given batch path via -Verb RunAs -Wait -PassThru', () => {
    const script = buildElevationPowerShellScript('C:\\scratch\\run.bat');
    expect(script).toContain("Start-Process -FilePath 'C:\\scratch\\run.bat' -Verb RunAs -Wait -PassThru");
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
  it('reports only the newly-appended text on each poll, never re-sending what was already read', async () => {
    const dir = mkTempDir();
    const logPath = path.join(dir, 'run.log');
    const deltas: string[] = [];
    const poller = startLogPolling(logPath, (d) => deltas.push(d), 30);

    await new Promise((r) => setTimeout(r, 60)); // let it poll once while the file doesn't exist yet
    fs.writeFileSync(logPath, 'line1\n');
    await new Promise((r) => setTimeout(r, 80));
    fs.appendFileSync(logPath, 'line2\n');
    await new Promise((r) => setTimeout(r, 80));
    await poller.stop();

    expect(deltas.join('')).toBe('line1\nline2\n');
    // Confirms no re-delivery: each individual delta is a strict subset of the total, and the
    // join above already proves nothing was duplicated or dropped.
    expect(deltas.length).toBeGreaterThanOrEqual(2);
  });

  it('tolerates the log file never being created at all (target failed before writing anything)', async () => {
    const dir = mkTempDir();
    const deltas: string[] = [];
    const poller = startLogPolling(path.join(dir, 'never-created.log'), (d) => deltas.push(d), 20);
    await new Promise((r) => setTimeout(r, 60));
    await poller.stop();
    expect(deltas).toEqual([]);
  });

  it('the final stop() call still captures content written right before stopping', async () => {
    const dir = mkTempDir();
    const logPath = path.join(dir, 'run.log');
    fs.writeFileSync(logPath, '');
    const deltas: string[] = [];
    const poller = startLogPolling(logPath, (d) => deltas.push(d), 10_000); // long interval — only stop()'s own final read should catch this
    fs.writeFileSync(logPath, 'final line\n');
    await poller.stop();
    expect(deltas.join('')).toBe('final line\n');
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
