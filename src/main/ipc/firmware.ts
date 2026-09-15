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
import { runElevated, type RunElevatedResult } from '../services/elevatedRun';
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

/**
 * ONLY ever assigned by startFirmwareUpgrade when `outcome.processTerminationConfirmed` is
 * true — i.e. there is positive evidence the elevated process is no longer running. Never
 * assigned for a 'timeout'/'unparseable'/uncertain-internal-error outcome; see the doc on
 * `FirmwareUpgradeOutcome.processTerminationConfirmed` in shared/types.ts. This is the ONLY
 * mechanism that can release the pen lock / in-progress guard for an 'unclear' result — there is
 * deliberately no other way to release them for a NOT-confirmed outcome short of restarting the
 * app, which resets this in-memory state on its own.
 */
let pendingRelease: (() => void) | null = null;

/**
 * The user clicking "I understand" is evidence they've SEEN the ambiguous result, never evidence
 * the real device has stopped writing — see `pendingRelease`'s own doc. When nothing is pending
 * (either there was no unclear outcome, or its termination could not be confirmed), this is a
 * deliberate no-op: `locked: true` in the result tells the caller the pen lock / in-progress
 * guard are still held and there is no in-app action that will release them.
 */
export function acknowledgeFirmwareOutcome(): { ok: boolean; locked: boolean } {
  const wasInProgress = isFirmwareUpgradeInProgress();
  if (pendingRelease) {
    pendingRelease();
    pendingRelease = null;
    endFirmwareUpgrade();
    return { ok: wasInProgress, locked: false };
  }
  return { ok: false, locked: wasInProgress };
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
    // Set true only immediately before the elevated launch is attempted, and read in the catch
    // below to tell "nothing was ever launched" (safe to release) apart from "the launch was
    // attempted but we don't know what happened to it" (NOT safe to release) — see the catch
    // block's own comment.
    let calledRunElevated = false;
    let elevationResult: RunElevatedResult | null = null;

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
      calledRunElevated = true;
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
      elevationResult = elevation; // positive record that runElevated resolved, and with what

      sendProgress('finishing');
      const outcome = determineOutcome({ logText: accumulatedLog, elevation });
      appendDiagnostic(diagnosticsStore(), 'firmware-upgrade', {
        outcome: outcome.status,
        reason: outcome.reason,
        exitCode: outcome.exitCode ?? 'null',
        durationMs: Date.now() - startedAtMs,
      });

      if (outcome.processTerminationConfirmed) {
        if (outcome.status === 'unclear') {
          // The process is confirmed gone, but we don't know if it succeeded — require the user
          // to look at the log and explicitly acknowledge before a new attempt or a BOOK/DIY
          // write can run. acknowledgeFirmwareOutcome() is the only thing that calls this.
          pendingRelease = release;
        } else {
          release();
          endFirmwareUpgrade();
        }
      }
      // else: processTerminationConfirmed is false ('timeout' or 'unparseable-wrapper-output') —
      // the pen lock and the in-progress guard MUST stay held, with no in-app release mechanism
      // at all (pendingRelease is deliberately never assigned here). The user acknowledging the
      // outcome in the UI is not evidence the real device has stopped writing — only restarting
      // the app (which resets this in-memory lock state) can clear it.

      try {
        window.webContents.send(IPC.firmwareOutcome, outcome satisfies FirmwareUpgradeOutcome);
      } catch {
        // window already gone
      }
    } catch (err) {
      // Distinguish "confirmed nothing was ever launched" from "the launch was attempted but we
      // don't know what happened next" — the fix this replaces used to release unconditionally
      // on ANY caught error, which would have wrongly unlocked even if the error happened after
      // an elevated process may already have been spawned.
      const terminationConfirmed = !calledRunElevated || elevationResult?.status === 'completed';
      if (terminationConfirmed) {
        release();
        endFirmwareUpgrade();
      }
      // else: leave the lock held, same reasoning as the processTerminationConfirmed===false
      // branch above — no pendingRelease is stashed, so acknowledgeFirmwareOutcome() cannot
      // release it either.
      try {
        window.webContents.send(IPC.firmwareOutcome, {
          status: 'unclear',
          reason: terminationConfirmed ? 'internal-error-before-launch' : 'internal-error-uncertain',
          exitCode: null,
          logExcerpt: err instanceof Error ? err.message : String(err),
          processTerminationConfirmed: terminationConfirmed,
        } satisfies FirmwareUpgradeOutcome);
      } catch {
        // window already gone
      }
    }
  })();

  return { status: 'started' };
}
