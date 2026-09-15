// Regression coverage for the 2026-09-15 lock-safety fixes in src/main/ipc/firmware.ts.
// Entirely simulated: runElevated is mocked, so no real elevated process, vendor tool, or pen is
// ever touched. The whole point of these tests is to prove a genuinely-uncertain outcome
// (timeout / unparseable wrapper output / an error thrown after the elevated launch was
// attempted) can NEVER be unlocked by acknowledgeFirmwareOutcome() — only a confirmed-terminated
// outcome can. Module state (firmwareLock.ts's in-progress flag, penOperationLock.ts's mutex
// chain) is intentionally left permanently held in the "unconfirmed" cases, so every test uses a
// fresh module graph via vi.resetModules() + dynamic import — reusing one module instance across
// tests would leak a permanently-stuck lock from one test into the next.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { IPC } from '../../src/shared/ipcChannels';
import type { FirmwareUpgradeOutcome } from '../../src/shared/types';

const REAL_PLATFORM = process.platform;

const h = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userDataDir : '') },
  dialog: { showOpenDialog: vi.fn() },
}));
vi.mock('../../src/main/services/elevatedRun', () => ({ runElevated: vi.fn() }));
// Partial mock: real persistence (writePendingRun/readPendingRun/clearPendingRun) so a marker
// genuinely round-trips through real fs across a simulated app restart within a test, but
// checkStillRunning is replaced with a controllable vi.fn() so "still running" / "not running" /
// "the check itself failed" can be simulated deterministically without a real elevated process.
vi.mock('../../src/main/services/firmwareRecovery', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/main/services/firmwareRecovery')>();
  return { ...actual, checkStillRunning: vi.fn() };
});

const tempDirs: string[] = [];
function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

// Mirrors firmwareUpgrade.ts's REQUIRED_RELATIVE_FILES by hand — inspectFirmwarePackage's own
// tests (firmwareUpgrade.test.ts) catch drift between the two lists.
const REQUIRED_FILES = [
  'download.bat',
  path.join('soundbox', 'standard', 'download.bat'),
  'isd_download.exe',
  'ufw_maker.exe',
  'remove_tailing_zeros.exe',
  'uboot.boot',
  'ota.bin',
  'script.ver',
  path.join('soundbox', 'standard', 'app.bin'),
  path.join('soundbox', 'standard', 'br25loader.bin'),
  'text.bin',
  'data.bin',
  'data_code.bin',
  'aec.bin',
  'wav.bin',
  'ape.bin',
  'flac.bin',
  'm4a.bin',
  'amr.bin',
  'dts.bin',
  'fm.bin',
  'mp3.bin',
  'wma.bin',
  path.join('soundbox', 'standard', 'tone.cfg'),
  path.join('soundbox', 'standard', 'cfg_tool.bin'),
  path.join('soundbox', 'standard', '026AC690X-5309.key'),
  path.join('soundbox', 'standard', 'jl_isd.fw'),
  path.join('soundbox', 'standard', 'isd_config.ini'),
];

function writeFullPackage(dir: string): void {
  for (const rel of REQUIRED_FILES) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');
  }
}

function makeWindow() {
  const send = vi.fn();
  return { win: { webContents: { send } } as unknown as BrowserWindow, send };
}

async function waitForOutcome(send: ReturnType<typeof vi.fn>, timeoutMs = 3000): Promise<FirmwareUpgradeOutcome> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const call = send.mock.calls.find((c) => c[0] === IPC.firmwareOutcome);
    if (call) return call[1] as FirmwareUpgradeOutcome;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('timed out waiting for a firmwareOutcome send()');
}

/** Resolves true iff the lock was free to take within timeoutMs — used to assert a queued
 *  BOOK/DIY-style write either proceeds (lock released) or stays blocked (lock still held). */
async function acquiresWithin(acquire: () => Promise<() => void>, timeoutMs = 150): Promise<boolean> {
  let acquired = false;
  const done = acquire().then((release) => {
    acquired = true;
    release();
  });
  await Promise.race([done, new Promise((r) => setTimeout(r, timeoutMs))]);
  return acquired;
}

let packageDir: string;

beforeEach(() => {
  vi.resetModules();
  h.userDataDir = mkTempDir('ponyabc-userdata-');
  packageDir = mkTempDir('ponyabc-fw-pkg-');
  writeFullPackage(packageDir);
  Object.defineProperty(process, 'platform', { value: 'win32', configurable: true });
});

afterEach(() => {
  Object.defineProperty(process, 'platform', { value: REAL_PLATFORM, configurable: true });
  vi.restoreAllMocks();
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

async function freshImports() {
  const session = await import('../../src/main/services/session');
  const { resolvePenRoot } = await import('../../src/main/services/pathSecurity');
  const { runElevated } = await import('../../src/main/services/elevatedRun');
  const firmwareRecovery = await import('../../src/main/services/firmwareRecovery');
  const firmwareIpc = await import('../../src/main/ipc/firmware');
  const penOperationLock = await import('../../src/main/services/penOperationLock');

  const penDir = mkTempDir('ponyabc-pen-');
  fs.mkdirSync(path.join(penDir, 'BOOK'));
  fs.mkdirSync(path.join(penDir, 'DIY'));
  const resolved = resolvePenRoot(penDir);
  if (resolved.status !== 'ok') throw new Error('fixture pen root invalid');
  session.setPenRoot(resolved);

  return {
    session,
    runElevated: vi.mocked(runElevated),
    checkStillRunning: vi.mocked(firmwareRecovery.checkStillRunning),
    firmwareIpc,
    penOperationLock,
  };
}

describe('startFirmwareUpgrade — lock only releases with confirmed process termination', () => {
  it('success (log contains the confirmed signal): lock released, a queued BOOK/DIY write proceeds', async () => {
    const { runElevated, firmwareIpc, penOperationLock } = await freshImports();
    runElevated.mockImplementationOnce(async (params) => {
      params.onLogUpdate?.('start...\ndownload success\n');
      return { status: 'completed', exitCode: 0 };
    });

    const { win, send } = makeWindow();
    expect(await firmwareIpc.startFirmwareUpgrade(win, { packageDir })).toEqual({ status: 'started' });
    const outcome = await waitForOutcome(send);
    expect(outcome).toMatchObject({ status: 'success', processTerminationConfirmed: true });
    expect(await firmwareIpc.isFirmwareInProgress()).toBe(false);
    expect(await acquiresWithin(() => penOperationLock.acquirePenLock())).toBe(true);
  });

  it('unclear + confirmed termination (no-recognized-signal): stays locked until acknowledged, then a queued write proceeds', async () => {
    const { runElevated, firmwareIpc, penOperationLock } = await freshImports();
    runElevated.mockResolvedValueOnce({ status: 'completed', exitCode: 0 });

    const { win, send } = makeWindow();
    await firmwareIpc.startFirmwareUpgrade(win, { packageDir });
    const outcome = await waitForOutcome(send);
    expect(outcome).toMatchObject({ status: 'unclear', reason: 'no-recognized-signal', processTerminationConfirmed: true });

    expect(await firmwareIpc.isFirmwareInProgress()).toBe(true);
    expect(await acquiresWithin(() => penOperationLock.acquirePenLock())).toBe(false);

    expect(firmwareIpc.acknowledgeFirmwareOutcome()).toEqual({ ok: true, locked: false });
    expect(await firmwareIpc.isFirmwareInProgress()).toBe(false);
    expect(await acquiresWithin(() => penOperationLock.acquirePenLock())).toBe(true);
  });

  it('timeout: termination NOT confirmed — stays locked, and acknowledging does NOT release it', async () => {
    const { runElevated, firmwareIpc, penOperationLock } = await freshImports();
    runElevated.mockResolvedValueOnce({ status: 'timeout' });

    const { win, send } = makeWindow();
    await firmwareIpc.startFirmwareUpgrade(win, { packageDir });
    const outcome = await waitForOutcome(send);
    expect(outcome).toMatchObject({ status: 'unclear', reason: 'timeout', processTerminationConfirmed: false });

    expect(await firmwareIpc.isFirmwareInProgress()).toBe(true);
    expect(await acquiresWithin(() => penOperationLock.acquirePenLock())).toBe(false);

    // The core regression check: clicking "I understand" must NOT be able to release a lock
    // for an outcome whose termination was never confirmed.
    expect(firmwareIpc.acknowledgeFirmwareOutcome()).toEqual({ ok: false, locked: true });
    expect(await firmwareIpc.isFirmwareInProgress()).toBe(true);
    expect(await acquiresWithin(() => penOperationLock.acquirePenLock())).toBe(false);
  });

  it('unparseable wrapper output: termination NOT confirmed — same as timeout, never releasable via acknowledge', async () => {
    const { runElevated, firmwareIpc, penOperationLock } = await freshImports();
    runElevated.mockResolvedValueOnce({ status: 'unparseable', raw: 'garbage' });

    const { win, send } = makeWindow();
    await firmwareIpc.startFirmwareUpgrade(win, { packageDir });
    const outcome = await waitForOutcome(send);
    expect(outcome).toMatchObject({ status: 'unclear', reason: 'unparseable-wrapper-output', processTerminationConfirmed: false });

    expect(firmwareIpc.acknowledgeFirmwareOutcome()).toEqual({ ok: false, locked: true });
    expect(await firmwareIpc.isFirmwareInProgress()).toBe(true);
    expect(await acquiresWithin(() => penOperationLock.acquirePenLock())).toBe(false);
  });

  it('an error thrown BEFORE the elevated launch was ever attempted: confirmed safe, released immediately', async () => {
    const { runElevated, firmwareIpc, penOperationLock } = await freshImports();
    const rmSyncSpy = vi.spyOn(fs, 'rmSync').mockImplementationOnce(() => {
      throw new Error('boom-before-launch');
    });

    const { win, send } = makeWindow();
    await firmwareIpc.startFirmwareUpgrade(win, { packageDir });
    const outcome = await waitForOutcome(send);
    expect(outcome).toMatchObject({ status: 'unclear', reason: 'internal-error-before-launch', processTerminationConfirmed: true });
    expect(outcome.logExcerpt).toContain('boom-before-launch');
    expect(runElevated).not.toHaveBeenCalled(); // proves the throw really happened pre-launch

    expect(await firmwareIpc.isFirmwareInProgress()).toBe(false);
    expect(await acquiresWithin(() => penOperationLock.acquirePenLock())).toBe(true);
    rmSyncSpy.mockRestore();
  });

  it('an error thrown AFTER the elevated launch was attempted: termination NOT confirmed, stays locked', async () => {
    const { runElevated, firmwareIpc, penOperationLock } = await freshImports();
    runElevated.mockImplementationOnce(async () => {
      throw new Error('boom-after-launch');
    });

    const { win, send } = makeWindow();
    await firmwareIpc.startFirmwareUpgrade(win, { packageDir });
    const outcome = await waitForOutcome(send);
    expect(outcome).toMatchObject({ status: 'unclear', reason: 'internal-error-uncertain', processTerminationConfirmed: false });
    expect(outcome.logExcerpt).toContain('boom-after-launch');
    expect(runElevated).toHaveBeenCalled(); // the launch really was attempted — this is the ambiguous case

    expect(firmwareIpc.acknowledgeFirmwareOutcome()).toEqual({ ok: false, locked: true });
    expect(await firmwareIpc.isFirmwareInProgress()).toBe(true);
    expect(await acquiresWithin(() => penOperationLock.acquirePenLock())).toBe(false);
  });

  it('a declined UAC prompt (nothing ever launched) still releases immediately — unaffected by this fix', async () => {
    const { runElevated, firmwareIpc, penOperationLock } = await freshImports();
    runElevated.mockResolvedValueOnce({ status: 'declined' });

    const { win, send } = makeWindow();
    await firmwareIpc.startFirmwareUpgrade(win, { packageDir });
    const outcome = await waitForOutcome(send);
    expect(outcome).toMatchObject({ status: 'failed', reason: 'declined', processTerminationConfirmed: true });
    expect(await firmwareIpc.isFirmwareInProgress()).toBe(false);
    expect(await acquiresWithin(() => penOperationLock.acquirePenLock())).toBe(true);
  });
});

describe('cross-restart recovery — simulates "app closed/reopened while an external process may still be running"', () => {
  // Each "session" here is a fully fresh module graph (vi.resetModules() + dynamic import),
  // exactly mirroring a real app restart's reset in-memory state — but h.userDataDir (and
  // therefore the pending-run marker on real disk) is NOT reset, exactly mirroring how a real
  // restart keeps the same userData directory. Nothing here spawns a real elevated process —
  // "the external process is still running" is simulated purely via the injectable
  // checkStillRunning mock.

  it('a timeout leaves a marker; a simulated restart re-locks and reports still-running; only a later check finding it gone clears everything', async () => {
    // --- "session 1": a firmware attempt whose outcome is a timeout ---
    const s1 = await freshImports();
    s1.runElevated.mockResolvedValueOnce({ status: 'timeout' });
    const { win: win1, send: send1 } = makeWindow();
    await s1.firmwareIpc.startFirmwareUpgrade(win1, { packageDir });
    const outcome1 = await waitForOutcome(send1);
    expect(outcome1).toMatchObject({ status: 'unclear', reason: 'timeout', processTerminationConfirmed: false });

    const markerPath = path.join(h.userDataDir, 'firmwareRecovery', 'pending.json');
    expect(fs.existsSync(markerPath)).toBe(true); // the marker outlives "session 1"

    // --- simulate the app fully quitting and a fresh process starting: reset ALL module state,
    // but the on-disk userData (and therefore the marker) is untouched. ---
    vi.resetModules();
    const s2 = await freshImports();
    s2.checkStillRunning.mockResolvedValueOnce('running'); // the harmless placeholder "vendor tool" is still up

    await s2.firmwareIpc.checkPendingFirmwareRecoveryOnStartup();
    expect(s2.checkStillRunning).toHaveBeenCalledTimes(1);

    const status1 = s2.firmwareIpc.getFirmwareRecoveryStatus();
    expect(status1.status).toBe('still-running');
    if (status1.status !== 'still-running') throw new Error('unreachable');
    expect(status1.pending).toMatchObject({ packageDir });

    // Restarting did NOT unlock anything — new firmware attempts and BOOK/DIY writes both stay
    // blocked purely because of the persisted marker, before the user has done anything at all.
    expect(await s2.firmwareIpc.isFirmwareInProgress()).toBe(true);
    expect(await acquiresWithin(() => s2.penOperationLock.acquirePenLock())).toBe(false);
    expect(await s2.firmwareIpc.startFirmwareUpgrade(win1, { packageDir })).toEqual({ status: 'already-in-progress' });
    expect(fs.existsSync(markerPath)).toBe(true); // still persisted — a further restart would find it too

    // --- the harmless placeholder process finishes; a manual recheck notices ---
    s2.checkStillRunning.mockResolvedValueOnce('not-running');
    const status2 = await s2.firmwareIpc.recheckFirmwareRecovery();
    expect(status2).toEqual({ status: 'none' });
    expect(await s2.firmwareIpc.isFirmwareInProgress()).toBe(false);
    expect(await acquiresWithin(() => s2.penOperationLock.acquirePenLock())).toBe(true);
    expect(fs.existsSync(markerPath)).toBe(false); // cleared only by the confirming check, nothing else
  });

  it('when the check itself fails (real process listing unavailable), stays locked exactly like "still-running" — never treated as safe', async () => {
    const s1 = await freshImports();
    s1.runElevated.mockResolvedValueOnce({ status: 'timeout' });
    const { win: win1, send: send1 } = makeWindow();
    await s1.firmwareIpc.startFirmwareUpgrade(win1, { packageDir });
    await waitForOutcome(send1);

    vi.resetModules();
    const s2 = await freshImports();
    s2.checkStillRunning.mockResolvedValueOnce('unknown');
    await s2.firmwareIpc.checkPendingFirmwareRecoveryOnStartup();

    const status = s2.firmwareIpc.getFirmwareRecoveryStatus();
    expect(status.status).toBe('unknown');
    expect(await s2.firmwareIpc.isFirmwareInProgress()).toBe(true);
    expect(await acquiresWithin(() => s2.penOperationLock.acquirePenLock())).toBe(false);

    s2.checkStillRunning.mockResolvedValueOnce('not-running');
    expect(await s2.firmwareIpc.recheckFirmwareRecovery()).toEqual({ status: 'none' });
    expect(await s2.firmwareIpc.isFirmwareInProgress()).toBe(false);
  });

  it('a fresh app start with nothing pending is a complete no-op — no lock held, no check ever run', async () => {
    const { checkStillRunning, firmwareIpc, penOperationLock } = await freshImports();
    await firmwareIpc.checkPendingFirmwareRecoveryOnStartup();
    expect(checkStillRunning).not.toHaveBeenCalled();
    expect(firmwareIpc.getFirmwareRecoveryStatus()).toEqual({ status: 'none' });
    expect(await firmwareIpc.isFirmwareInProgress()).toBe(false);
    expect(await acquiresWithin(() => penOperationLock.acquirePenLock())).toBe(true);
  });

  it('recheckFirmwareRecovery is a no-op once already "none" — never calls checkStillRunning again', async () => {
    const { checkStillRunning, firmwareIpc } = await freshImports();
    await firmwareIpc.checkPendingFirmwareRecoveryOnStartup(); // nothing pending → 'none'
    expect(await firmwareIpc.recheckFirmwareRecovery()).toEqual({ status: 'none' });
    expect(checkStillRunning).not.toHaveBeenCalled();
  });
});
