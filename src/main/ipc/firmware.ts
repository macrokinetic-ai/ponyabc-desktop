import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type {
  FirmwareSelectPackageResult,
  FirmwareStartResult,
  FirmwareUpgradeOutcome,
  FirmwareUpgradePhase,
} from '@shared/types';
import * as session from '../services/session';
import { acquirePenLock } from '../services/penOperationLock';
import { runElevated } from '../services/elevatedRun';
import { determineOutcome, inspectFirmwarePackage } from '../services/firmwareUpgrade';
import { endFirmwareUpgrade, isFirmwareUpgradeInProgress, tryBeginFirmwareUpgrade } from '../services/firmwareLock';
import { appendDiagnostic } from '../services/diagnostics';
import { diagnosticsStore } from './book';

export async function selectFirmwarePackage(window: BrowserWindow): Promise<FirmwareSelectPackageResult> {
  const result = await dialog.showOpenDialog(window, {
    properties: ['openDirectory'],
    title: 'Select the extracted firmware package folder (the one containing download.bat)',
  });
  if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' };
  return { status: 'selected', info: inspectFirmwarePackage(result.filePaths[0]) };
}

export async function isFirmwareInProgress(): Promise<boolean> {
  return isFirmwareUpgradeInProgress();
}

/** Never called for anything but an 'unclear' outcome's pending release — see startFirmwareUpgrade. */
let pendingRelease: (() => void) | null = null;

export function acknowledgeFirmwareOutcome(): { ok: boolean } {
  const was = isFirmwareUpgradeInProgress();
  if (pendingRelease) {
    pendingRelease();
    pendingRelease = null;
  }
  endFirmwareUpgrade();
  return { ok: was };
}

/**
 * Runs the CONFIRMED working entry point — `<packageDir>\download.bat` — via elevatedRun,
 * exactly as the user ran it themselves. Never invokes any inner tool/script directly, never
 * regenerates or re-derives firmware bytes: the package folder is used read-only, exactly as
 * extracted.
 */
export async function startFirmwareUpgrade(window: BrowserWindow, params: { packageDir: string }): Promise<FirmwareStartResult> {
  if (process.platform !== 'win32') return { status: 'unsupported-platform' };
  if (!session.getPenRoot()) return { status: 'no-pen-selected' };

  const info = inspectFirmwarePackage(params.packageDir);
  if (!info.looksValid) return { status: 'invalid-package' };

  if (!tryBeginFirmwareUpgrade()) return { status: 'already-in-progress' };

  const startedAtMs = Date.now();
  void (async () => {
    // Held for the ENTIRE upgrade — this is what actually blocks a concurrent BOOK/DIY pen
    // write; the firmwareLock module-level flag above is a separate, coarser guard that also
    // blocks a second upgrade attempt outright, and (for an 'unclear' result) stays up until
    // the user explicitly acknowledges it.
    const release = await acquirePenLock();
    let accumulatedLog = '';
    let released = false;

    const sendProgress = (phase: FirmwareUpgradePhase) => {
      try {
        window.webContents.send(IPC.firmwareProgress, { phase, logTailText: accumulatedLog.slice(-4000) });
      } catch {
        // window already gone
      }
    };

    try {
      const workDir = path.join(app.getPath('userData'), 'firmwareRun');
      fs.rmSync(workDir, { recursive: true, force: true }); // never reuse a stale prior run's .bat/.ps1/.log
      sendProgress('preparing-launcher');
      sendProgress('awaiting-authorization-or-starting');

      let sawFirstLog = false;
      const elevation = await runElevated({
        exePath: info.entryBatPath,
        args: [],
        cwd: params.packageDir,
        workDir,
        onLogUpdate: (delta) => {
          accumulatedLog += delta;
          if (!sawFirstLog) sawFirstLog = true; // first real evidence the tool actually started
          sendProgress('tool-running');
        },
        logPollIntervalMs: 400,
        // No timeoutMs: giving up watching must be a human decision made in the wizard UI, not
        // a silent internal cutoff — see the module doc comment on why 'unclear' keeps the lock.
      });

      sendProgress('finishing');
      const outcome = determineOutcome({ logText: accumulatedLog, elevation });
      appendDiagnostic(diagnosticsStore(), 'firmware-upgrade', {
        outcome: outcome.status,
        reason: outcome.reason,
        exitCode: outcome.exitCode ?? 'null',
        durationMs: Date.now() - startedAtMs,
      });

      if (outcome.status === 'unclear') {
        // Neither the pen-write lock nor the in-progress guard clear here — only
        // acknowledgeFirmwareOutcome() (an explicit user action) does, since the real device
        // might still be mid-flash for all we actually know.
        pendingRelease = release;
        released = true; // "released" here means "handed off", not "called" — guards the finally below
      } else {
        release();
        released = true;
        endFirmwareUpgrade();
      }

      try {
        window.webContents.send(IPC.firmwareOutcome, outcome satisfies FirmwareUpgradeOutcome);
      } catch {
        // window already gone
      }
    } catch (err) {
      if (!released) release();
      endFirmwareUpgrade();
      try {
        window.webContents.send(IPC.firmwareOutcome, {
          status: 'unclear',
          reason: 'internal-error',
          exitCode: null,
          logExcerpt: err instanceof Error ? err.message : String(err),
        } satisfies FirmwareUpgradeOutcome);
      } catch {
        // window already gone
      }
    }
  })();

  return { status: 'started' };
}
