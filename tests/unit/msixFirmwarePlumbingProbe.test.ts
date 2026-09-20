import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = { userDataDir: '' };
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userDataDir : '') },
}));

import { runMsixFirmwarePlumbingProbe } from '../../src/main/services/msixFirmwarePlumbingProbe';

const tempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  h.userDataDir = mkTempDir('ponyabc-userdata-');
});
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('runMsixFirmwarePlumbingProbe', () => {
  it('writes the harmless probe tool under the same real directories startFirmwareUpgrade uses, and never touches a vendor binary', async () => {
    const result = await runMsixFirmwarePlumbingProbe();

    expect(result.workDir).toBe(path.join(h.userDataDir, 'firmwareRun'));
    expect(result.packageDir).toBe(path.join(h.userDataDir, 'firmwareDownloads', 'msix-plumbing-probe'));
    expect(result.probeToolPath).toBe(path.join(result.packageDir, 'probe-tool.bat'));
    expect(path.basename(result.probeToolPath)).not.toMatch(/isd_download|ufw_maker|download\.bat/);
  });

  it('exercises the real writePendingRun/readPendingRun round trip (recovery-marker path)', async () => {
    const result = await runMsixFirmwarePlumbingProbe();
    expect(result.recoveryMarkerReadBackImmediately).toBe(true);
    // clearPendingRun() runs at the end of the probe — the marker must not be left behind.
    const markerPath = path.join(h.userDataDir, 'firmwareRecovery', 'pending.json');
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it('reports unsupported-platform (and no log file) on a non-Windows runner, rather than hanging or fabricating a result', async () => {
    // This test itself runs on whatever OS the test runner is (never Windows in this sandbox) —
    // runElevated's own real, unmocked platform check should short-circuit immediately.
    const result = await runMsixFirmwarePlumbingProbe();
    if (process.platform !== 'win32') {
      expect(result.elevation).toEqual({ status: 'unsupported-platform' });
      expect(result.logFileExisted).toBe(false);
      expect(result.logContainsExpectedMarker).toBe(false);
      expect(result.errors.some((e) => e.includes('run.log'))).toBe(true);
    }
  });

  it('cleans up any previous run.log/workDir before starting, so a stale prior probe result can never leak into a fresh one', async () => {
    const workDir = path.join(h.userDataDir, 'firmwareRun');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'run.log'), 'STALE_PREVIOUS_RUN_OUTPUT', 'utf-8');

    const result = await runMsixFirmwarePlumbingProbe();

    expect(result.logContents === null || !result.logContents.includes('STALE_PREVIOUS_RUN_OUTPUT')).toBe(true);
  });
});
