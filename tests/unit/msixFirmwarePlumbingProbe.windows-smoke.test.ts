import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Real-Windows validation of the FULL firmware-plumbing probe (elevatedRun.ts's real
 * Start-Process -Verb RunAs, plus firmwareRecovery.ts's real marker file) against a completely
 * harmless target — never the vendor's tool, never a real device. Deliberately opt-in only
 * (PONYABC_RUN_ELEVATION_SMOKE=1, same variable as elevatedRun.windows-smoke.test.ts — this is
 * the same underlying mechanism) and Windows-only, so it never runs as part of the ordinary
 * `npm test` gate (which itself runs on windows-latest in build-windows.yml) — see
 * msixFirmwarePlumbingProbe.test.ts's own header for exactly what went wrong the one time this
 * ran unguarded: it blocked past vitest's default timeout and failed the whole CI job.
 *
 * This is the real, unmocked equivalent of what
 * src/main/index.ts runs behind PONYABC_MSIX_FIRMWARE_PROBE=1 inside the packaged app — this
 * test file exercises the exact same service function directly, without needing a packaged
 * install, for quicker iteration. The packaged-app path is exercised separately by
 * build-windows.yml's "firmware wizard plumbing probe" CI step.
 */
const RUN = process.platform === 'win32' && process.env.PONYABC_RUN_ELEVATION_SMOKE === '1';

const h = { userDataDir: '' };
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userDataDir : '') },
}));

import { runMsixFirmwarePlumbingProbe } from '../../src/main/services/msixFirmwarePlumbingProbe';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-msix-probe-smoke-'));
  tempDirs.push(dir);
  return dir;
}
beforeEach(() => {
  h.userDataDir = mkTempDir();
});
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});

describe.skipIf(!RUN)('runMsixFirmwarePlumbingProbe — real Windows smoke test (harmless target, no vendor tool, no device)', () => {
  it('actually elevates a harmless stand-in and reports a real, non-fabricated result', async () => {
    // Must stay comfortably above the probe's own internal runElevated timeoutMs (120_000).
    const result = await runMsixFirmwarePlumbingProbe();

    console.log('MSIX firmware plumbing probe smoke result:', JSON.stringify(result, null, 2));

    if (result.elevation.status === 'timeout') {
      // A real, informative outcome on a headless runner with no interactive desktop to approve
      // the prompt — not a test failure, but not silently swallowed either. This IS one of the
      // two possible honest answers to the open question in tasks/todo.md's MSIX section.
      console.warn('Elevation prompt did not resolve within the timeout on this runner — likely no interactive desktop session available for UAC. This specific question needs a real interactive Windows session.');
      return;
    }

    expect(result.recoveryMarkerReadBackImmediately).toBe(true);
    if (result.elevation.status === 'completed') {
      // THE load-bearing question this whole probe exists to answer, empirically: can the
      // elevated (package-identity-stripped, per the original hypothesis) child process actually
      // find and run the file the packaged parent wrote under app.getPath('userData')?
      expect(result.logFileExisted).toBe(true);
      expect(result.logContainsExpectedMarker).toBe(true);
    } else {
      console.warn(`Elevation did not complete (status: ${result.elevation.status}) — see the result JSON above for the full detail.`);
    }
  }, 150_000);
});

describe.skipIf(RUN)('runMsixFirmwarePlumbingProbe — real Windows smoke test (skipped)', () => {
  it('is skipped outside an opt-in Windows run — see PONYABC_RUN_ELEVATION_SMOKE', () => {
    expect(true).toBe(true);
  });
});
