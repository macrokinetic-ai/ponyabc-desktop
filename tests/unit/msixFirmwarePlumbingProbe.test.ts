import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunElevatedResult } from '../../src/main/services/elevatedRun';

// This file must stay FAST and SAFE on every platform, including a real Windows CI runner —
// npm test itself runs on windows-latest in build-windows.yml. A real, unmocked runElevated()
// call attempts a genuine Start-Process -Verb RunAs on Windows, which can block indefinitely on
// an unanswerable UAC prompt in a non-interactive session (confirmed by a real CI run: it hung
// past vitest's default 5s test timeout and failed the whole job before packaging even started).
// The real, unmocked mechanism is exercised separately and deliberately, opt-in only, in
// msixFirmwarePlumbingProbe.windows-smoke.test.ts — same convention as
// elevatedRun.windows-smoke.test.ts / PONYABC_RUN_ELEVATION_SMOKE.
const h = {
  userDataDir: '',
  elevationResult: { status: 'completed', exitCode: 0 } as RunElevatedResult,
};
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userDataDir : '') },
}));
vi.mock('../../src/main/services/elevatedRun', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/services/elevatedRun')>();
  return {
    ...actual,
    runElevated: vi.fn(async (params: { workDir: string }) => {
      // Simulates exactly what a real elevated run writes to run.log — never actually invokes
      // Start-Process/PowerShell/UAC. Only fires when the configured outcome is 'completed'
      // (a declined/launch-error/timeout run never gets to write a log in the real mechanism
      // either).
      if (h.elevationResult.status === 'completed') {
        await fs.promises.mkdir(params.workDir, { recursive: true });
        await fs.promises.writeFile(path.join(params.workDir, 'run.log'), 'PONYABC_MSIX_PROBE_OK\n', 'utf-8');
      }
      return h.elevationResult;
    }),
  };
});

import { runMsixFirmwarePlumbingProbe } from '../../src/main/services/msixFirmwarePlumbingProbe';

const tempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  h.userDataDir = mkTempDir('ponyabc-userdata-');
  h.elevationResult = { status: 'completed', exitCode: 0 };
});
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('runMsixFirmwarePlumbingProbe (fast, mocked elevation — see the .windows-smoke sibling for the real thing)', () => {
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

  it('reads back the real log content the (mocked) elevated run wrote, and confirms the expected marker', async () => {
    const result = await runMsixFirmwarePlumbingProbe();
    expect(result.elevation).toEqual({ status: 'completed', exitCode: 0 });
    expect(result.logFileExisted).toBe(true);
    expect(result.logContainsExpectedMarker).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('reports a missing log file honestly (never fabricates content) when elevation never actually completed', async () => {
    h.elevationResult = { status: 'declined' };
    const result = await runMsixFirmwarePlumbingProbe();
    expect(result.logFileExisted).toBe(false);
    expect(result.logContainsExpectedMarker).toBe(false);
    expect(result.errors.some((e) => e.includes('run.log'))).toBe(true);
  });

  it('cleans up any previous run.log/workDir before starting, so a stale prior probe result can never leak into a fresh one', async () => {
    const workDir = path.join(h.userDataDir, 'firmwareRun');
    fs.mkdirSync(workDir, { recursive: true });
    fs.writeFileSync(path.join(workDir, 'run.log'), 'STALE_PREVIOUS_RUN_OUTPUT', 'utf-8');

    const result = await runMsixFirmwarePlumbingProbe();

    expect(result.logContents === null || !result.logContents.includes('STALE_PREVIOUS_RUN_OUTPUT')).toBe(true);
  });
});
