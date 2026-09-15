import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { determineOutcome, inspectFirmwarePackage } from '../../src/main/services/firmwareUpgrade';
import type { RunElevatedResult } from '../../src/main/services/elevatedRun';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-fw-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function writeFullPackage(dir: string): void {
  fs.writeFileSync(path.join(dir, 'download.bat'), '');
  fs.writeFileSync(path.join(dir, 'isd_download.exe'), '');
  fs.writeFileSync(path.join(dir, 'ufw_maker.exe'), '');
  fs.writeFileSync(path.join(dir, 'uboot.boot'), '');
  fs.writeFileSync(path.join(dir, 'ota.bin'), '');
  fs.writeFileSync(path.join(dir, 'script.ver'), '');
  fs.mkdirSync(path.join(dir, 'soundbox', 'standard'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'soundbox', 'standard', 'download.bat'), '');
  fs.writeFileSync(path.join(dir, 'soundbox', 'standard', 'app.bin'), '');
  fs.writeFileSync(path.join(dir, 'soundbox', 'standard', 'br25loader.bin'), '');
}

describe('inspectFirmwarePackage — real filesystem, never inferred from folder name or mtime', () => {
  it('looksValid=true only once every real dependency of the confirmed chain is present', () => {
    const dir = mkTempDir();
    writeFullPackage(dir);
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(true);
    expect(info.missingFiles).toEqual([]);
    expect(info.entryBatPath).toBe(path.join(dir, 'download.bat'));
  });

  it('reports exactly which files are missing, never a bare pass/fail', () => {
    const dir = mkTempDir();
    writeFullPackage(dir);
    fs.rmSync(path.join(dir, 'isd_download.exe'));
    fs.rmSync(path.join(dir, 'soundbox', 'standard', 'app.bin'));
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(false);
    expect(info.missingFiles).toContain('isd_download.exe');
    expect(info.missingFiles).toContain(path.join('soundbox', 'standard', 'app.bin'));
  });

  it('an empty/unrelated folder is never valid, regardless of its name', () => {
    const dir = mkTempDir();
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(false);
    expect(info.missingFiles.length).toBeGreaterThan(0);
  });
});

describe('determineOutcome — pure, no I/O', () => {
  it('"success" ONLY when the log literally contains the confirmed vendor signal, case-insensitively', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    expect(determineOutcome({ logText: 'blah\nDownload Success\nblah', elevation })).toMatchObject({
      status: 'success',
      reason: 'log-contains-download-success',
      exitCode: 0,
    });
    expect(determineOutcome({ logText: 'DOWNLOAD SUCCESS', elevation })).toMatchObject({ status: 'success' });
  });

  it('a completed run with exit code 0 but WITHOUT the confirmed signal is "unclear", never guessed as success — the confirmed batch chain never checks errorlevel after the real flash step, so a clean exit code alone proves nothing', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    const result = determineOutcome({ logText: 'some unrelated output, no signal here', elevation });
    expect(result.status).toBe('unclear');
    expect(result.reason).toBe('no-recognized-signal');
    expect(result.exitCode).toBe(0);
  });

  it('a completed run with a non-zero exit code but no recognized signal is still "unclear", not "failed" — no vendor-confirmed failure signal exists yet', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 1 };
    const result = determineOutcome({ logText: 'no signal', elevation });
    expect(result.status).toBe('unclear');
    expect(result.exitCode).toBe(1);
  });

  it('a declined UAC prompt is "failed", distinctly reasoned, never silently retried or hidden', () => {
    const elevation: RunElevatedResult = { status: 'declined' };
    expect(determineOutcome({ logText: '', elevation })).toMatchObject({ status: 'failed', reason: 'declined', exitCode: null });
  });

  it('a launch error (before the tool ever ran) is "failed"', () => {
    const elevation: RunElevatedResult = { status: 'launch-error', message: 'nope' };
    expect(determineOutcome({ logText: '', elevation })).toMatchObject({ status: 'failed', reason: 'launch-error' });
  });

  it('a timeout is "unclear", never "failed" — the real process may still be running unobserved', () => {
    const elevation: RunElevatedResult = { status: 'timeout' };
    expect(determineOutcome({ logText: 'partial output so far', elevation })).toMatchObject({ status: 'unclear', reason: 'timeout' });
  });

  it('unparseable wrapper output is "unclear"', () => {
    const elevation: RunElevatedResult = { status: 'unparseable', raw: 'garbage' };
    expect(determineOutcome({ logText: '', elevation })).toMatchObject({ status: 'unclear', reason: 'unparseable-wrapper-output' });
  });

  it('the log excerpt is capped to a tail, never the entire (potentially huge) log', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    const bigLog = 'x'.repeat(10_000) + 'download success';
    const result = determineOutcome({ logText: bigLog, elevation });
    expect(result.logExcerpt.length).toBeLessThan(bigLog.length);
    expect(result.logExcerpt).toContain('download success');
  });
});
