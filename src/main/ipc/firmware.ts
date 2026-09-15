import fs from 'node:fs';
import path from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type {
  FirmwareRecoveryStatus,
  FirmwareSelectPackageResult,
  FirmwareStartResult,
  FirmwareUpgradeOutcome,
  FirmwareUpgradePhase,
  PendingFirmwareRun,
} from '@shared/types';
import * as session from '../services/session';
import { acquirePenLock } from '../services/penOperationLock';
import { runElevated, type RunElevatedResult } from '../services/elevatedRun';
import { determineOutcome, inspectFirmwarePackage } from '../services/firmwareUpgrade';
import { endFirmwareUpgrade, isFirmwareUpgradeInProgress, tryBeginFirmwareUpgrade } from '../services/firmwareLock';
import { checkStillRunning, clearPendingRun, readPendingRun, writePendingRun } from '../services/firmwareRecovery';
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
 * mechanism that can release the pen lock / in-progress guard for a confirmed-terminated
 * 'unclear' result. For a NOT-confirmed outcome there is deliberately no release mechanism here
 * at all — NOT even restarting the app, which used to reset the in-memory lock but as of the
 * cross-restart recovery mechanism below no longer does: `checkPendingFirmwareRecoveryOnStartup`
 * re-seeds the same held state from a persisted marker on the next launch and only clears it once
 * a real process check reports 'not-running'.
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

// ---------------------------------------------------------------------------------------
// Cross-restart recovery. A plain app restart is deliberately NOT treated as evidence a
// previous firmware upgrade's elevated process has stopped — see PendingFirmwareRun's own doc
// in shared/types.ts and tasks/lessons.md (2026-09-15). `recoveryRelease` is a second, entirely
// separate release mechanism from `pendingRelease` above: nothing in the UI (including
// acknowledgeFirmwareOutcome) can ever call it — only a checkStillRunning() call itself
// reporting 'not-running' does.
// ---------------------------------------------------------------------------------------

let recoveryState: FirmwareRecoveryStatus = { status: 'none' };
let recoveryRelease: (() => void) | null = null;

export function getFirmwareRecoveryStatus(): FirmwareRecoveryStatus {
  return recoveryState;
}

async function runRecoveryCheck(pending: PendingFirmwareRun): Promise<void> {
  recoveryState = { status: 'checking', pending };
  const result = await checkStillRunning(pending);
  appendDiagnostic(diagnosticsStore(), 'firmware-recovery', {
    result,
    pendingStartedAtMs: pending.startedAtMs,
  });
  if (result === 'not-running') {
    clearPendingRun();
    recoveryRelease?.();
    recoveryRelease = null;
    endFirmwareUpgrade();
    recoveryState = { status: 'none' };
  } else {
    recoveryState = { status: result === 'running' ? 'still-running' : 'unknown', pending, lastCheckedAtMs: Date.now() };
  }
}

/**
 * Called exactly once at app startup, BEFORE any IPC handler is registered — see
 * src/main/index.ts. If a previous session ended with an unresolved firmware upgrade (a crash, a
 * force-quit, or a genuinely uncertain outcome the user never acknowledged), both the pen lock
 * and the firmware in-progress guard are seeded as HELD right here, before any BOOK/DIY write or
 * a new firmware attempt could possibly reach them. This never kills, signals, or otherwise
 * touches the other process — it only looks (via checkStillRunning), then reports what it found.
 */
export async function checkPendingFirmwareRecoveryOnStartup(): Promise<void> {
  const pending = readPendingRun();
  if (!pending) {
    recoveryState = { status: 'none' };
    return;
  }
  tryBeginFirmwareUpgrade();
  recoveryRelease = await acquirePenLock();
  await runRecoveryCheck(pending);
}

/** Re-runs the real check. A no-op (just returns the current status) unless a pending run is
 *  still unresolved — there is nothing to re-check once it's already 'none'. */
export async function recheckFirmwareRecovery(): Promise<FirmwareRecoveryStatus> {
  if (recoveryState.status === 'still-running' || recoveryState.status === 'unknown') {
    await runRecoveryCheck(recoveryState.pending);
  }
  return recoveryState;
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
      // Persisted BEFORE the launch, not after — must survive a crash or a plain quit while the
      // real device might still be mid-write. Cleared below only once termination is confirmed.
      writePendingRun({ startedAtMs, workDir, packageDir: params.packageDir, entryBatPath: info.entryBatPath });
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
        // Termination is confirmed either way now — the persisted marker exists ONLY to protect
        // a future app restart against "we don't know if it's still running," so it's cleared
        // the moment we DO know, independent of whether the user has acknowledged anything yet.
        clearPendingRun();
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
      // at all (pendingRelease is deliberately never assigned here). The persisted pending-run
      // marker (already written above) stays on disk too — even a full app restart re-seeds this
      // same held state from it on the next launch (see checkPendingFirmwareRecoveryOnStartup)
      // and only clears it once a real process check reports 'not-running'.

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
        clearPendingRun();
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
