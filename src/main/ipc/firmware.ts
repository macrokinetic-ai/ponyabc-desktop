import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { app, dialog, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type {
  DiagnosticsExportResult,
  FirmwareDownloadProgressEvent,
  FirmwarePrepareResult,
  FirmwareRecoveryStatus,
  FirmwareReleaseFetchResult,
  FirmwareReleaseInfo,
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
import { decodeLogBytes } from '../services/logEncoding';
import { endFirmwareUpgrade, isFirmwareUpgradeInProgress, tryBeginFirmwareUpgrade } from '../services/firmwareLock';
import { checkStillRunning, clearPendingRun, readPendingRun, writePendingRun } from '../services/firmwareRecovery';
import { appendDiagnostic, redactText } from '../services/diagnostics';
import { diagnosticsStore } from './book';
import { getOfficialFirmwareRelease as fetchOfficialFirmwareRelease, HARDWARE_REV_CONST } from '../services/firmwareCatalog/httpClient';
import { prepareOfficialFirmwarePackage as runPrepareOfficialFirmwarePackage } from '../services/firmwareRelease';
import {
  listFirmwareSessions,
  readFullFirmwareSession,
  redactRawLogBytesForExport,
  redactSessionRecordForExport,
  startFirmwareSession,
  type FirmwareSessionHandle,
} from '../services/firmwareSessionLog';

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
  // Created the moment a real attempt begins, independent of the try/catch below — an app
  // crash/power-loss anywhere after this line still leaves a session file on disk marked
  // "interrupted" (endedAtMs stays null) rather than losing the attempt entirely. See
  // firmwareSessionLog.ts's own doc for why this is a separate, richer system from the generic
  // capped diagnostics.json appendDiagnostic() calls elsewhere in this file.
  const sessionLog: FirmwareSessionHandle = startFirmwareSession(app.getPath('userData'), {
    appVersion: app.getVersion(),
    platform: process.platform,
    osVersion: os.release(),
    source: params.packageDir.startsWith(firmwareDownloadsRootDir()) ? 'official-download' : 'local-folder',
    firmwareVersion: null,
    packageDate: null,
    expectedSha256: null,
    packageHashVerified: null,
    packageValidation: { looksValid: info.looksValid, missingFiles: info.missingFiles },
    workDir: null,
    entryBatPath: info.entryBatPath,
    detectedCodepage: null,
    decoderUsed: null,
    decodingFallbackApplied: null,
    completionSignal: null,
    exitCode: null,
    processTerminationConfirmed: null,
    outcomeStatus: null,
    outcomeReason: null,
    userMessageKey: null,
    toolProcessConfirmedFinished: null,
    successSignalDetected: null,
    penFirmwareVersionVerified: false,
  });
  void (async () => {
    // Held for the ENTIRE upgrade — this is what actually blocks a concurrent BOOK/DIY pen
    // write; the firmwareLock module-level flag above is a separate, coarser guard that also
    // blocks a second upgrade attempt outright, and (for an 'unclear' result) stays up until
    // the user explicitly acknowledges it.
    const release = await acquirePenLock();
    // Raw bytes ONLY — never decoded incrementally. A multi-byte Chinese character split across
    // two poll reads must never be corrupted by decoding it in isolation; see logEncoding.ts's
    // decodeLogBytes, which is always called on the FULL accumulated buffer, fresh, every time
    // text is actually needed (for the live progress tail or the final outcome).
    let rawLogChunks: Buffer[] = [];
    // Fires once, from runElevated's own codepage-detection poll (see elevatedRun.ts) — null
    // until then, and possibly permanently null if it could never be determined (the elevated
    // launch never actually started, or `chcp`'s own output didn't parse).
    let detectedCodepage: number | null = null;
    // Set true only immediately before the elevated launch is attempted, and read in the catch
    // below to tell "nothing was ever launched" (safe to release) apart from "the launch was
    // attempted but we don't know what happened to it" (NOT safe to release) — see the catch
    // block's own comment.
    let calledRunElevated = false;
    let elevationResult: RunElevatedResult | null = null;

    const decodeAccumulatedLog = () => decodeLogBytes(Buffer.concat(rawLogChunks), detectedCodepage);

    const sendProgress = (phase: FirmwareUpgradePhase) => {
      try {
        const { text } = decodeAccumulatedLog();
        window.webContents.send(IPC.firmwareProgress, { phase, logTailText: text.slice(-4000) });
      } catch {
        // window already gone
      }
    };

    try {
      const workDir = path.join(app.getPath('userData'), 'firmwareRun');
      fs.rmSync(workDir, { recursive: true, force: true }); // never reuse a stale prior run's .bat/.ps1/.log
      sessionLog.update({ workDir });
      sendProgress('preparing-launcher');
      sessionLog.recordStage('launch', { workDir, entryBatPath: info.entryBatPath });
      sendProgress('awaiting-authorization-or-starting');

      let sawFirstLog = false;
      calledRunElevated = true;
      // Persisted BEFORE the launch, not after — must survive a crash or a plain quit while the
      // real device might still be mid-write. Cleared below only once termination is confirmed.
      writePendingRun({ startedAtMs, workDir, packageDir: params.packageDir, entryBatPath: info.entryBatPath });
      sessionLog.recordStage('recovery-marker', { action: 'written' });
      const elevation = await runElevated({
        exePath: info.entryBatPath,
        args: [],
        cwd: params.packageDir,
        workDir,
        onLogUpdate: (delta) => {
          rawLogChunks.push(delta);
          sessionLog.appendRawLogBytes(delta);
          if (!sawFirstLog) {
            sawFirstLog = true; // first real evidence the tool actually started
            sessionLog.recordStage('flashing-output', { firstBytesAtMs: Date.now() });
          }
          sendProgress('tool-running');
        },
        onCodepageDetected: (cp) => {
          detectedCodepage = cp;
          sessionLog.update({ detectedCodepage: cp });
        },
        logPollIntervalMs: 400,
        // No timeoutMs: giving up watching must be a human decision made in the wizard UI, not
        // a silent internal cutoff — see the module doc comment on why 'unclear' keeps the lock.
      });
      elevationResult = elevation; // positive record that runElevated resolved, and with what
      sessionLog.recordStage('uac-outcome', {
        elevationStatus: elevation.status,
        exitCode: elevation.status === 'completed' ? elevation.exitCode : null,
      });

      sendProgress('finishing');
      const { text: decodedLog, encodingUsed } = decodeAccumulatedLog();
      const outcome = determineOutcome({ logText: decodedLog, elevation, encodingKnown: encodingUsed !== null });
      appendDiagnostic(diagnosticsStore(), 'firmware-upgrade', {
        outcome: outcome.status,
        reason: outcome.reason,
        exitCode: outcome.exitCode ?? 'null',
        durationMs: Date.now() - startedAtMs,
      });
      sessionLog.recordStage('process-termination', {
        exitCode: outcome.exitCode ?? null,
        processTerminationConfirmed: outcome.processTerminationConfirmed,
      });
      sessionLog.recordStage('result-classification', { status: outcome.status, reason: outcome.reason });
      // These three are deliberately kept distinct — see the doc on FirmwareSessionRecord's
      // toolProcessConfirmedFinished/successSignalDetected/penFirmwareVersionVerified fields.
      // "The tool's process stopped" is exactly outcome.processTerminationConfirmed;
      // "a recognized completion string was seen" is true only for outcome.status === 'success';
      // an actual on-pen version read-back is never performed, so the third stays permanently
      // false regardless of the other two.
      sessionLog.finish({
        decoderUsed: encodingUsed,
        decodingFallbackApplied: encodingUsed === null,
        completionSignal: {
          kind: outcome.status === 'success' ? (outcome.reason === 'log-contains-download-complete-zh' ? 'zh' : 'en') : 'none',
          matchedText: outcome.status === 'success' ? outcome.reason : null,
          contextLines: outcome.status === 'success' ? outcome.logExcerpt.slice(-500) : null,
        },
        exitCode: outcome.exitCode ?? null,
        processTerminationConfirmed: outcome.processTerminationConfirmed,
        outcomeStatus: outcome.status,
        outcomeReason: outcome.reason,
        userMessageKey:
          outcome.status === 'success'
            ? 'result.successMessage'
            : outcome.status === 'failed'
              ? 'result.failedTitle'
              : outcome.processTerminationConfirmed
                ? 'result.processFinishedMessage'
                : 'result.unclearTitle',
        toolProcessConfirmedFinished: outcome.processTerminationConfirmed,
        successSignalDetected: outcome.status === 'success',
      });

      if (outcome.processTerminationConfirmed) {
        // Termination is confirmed either way now — the persisted marker exists ONLY to protect
        // a future app restart against "we don't know if it's still running," so it's cleared
        // the moment we DO know, independent of whether the user has acknowledged anything yet.
        clearPendingRun();
        sessionLog.recordStage('recovery-marker', { action: 'cleared' });
        if (outcome.status === 'unclear') {
          // The process is confirmed gone, but we don't know if it succeeded — require the user
          // to look at the log and explicitly acknowledge before a new attempt or a BOOK/DIY
          // write can run. acknowledgeFirmwareOutcome() is the only thing that calls this.
          pendingRelease = release;
          sessionLog.recordStage('lock', { action: 'pending-release-stashed' });
        } else {
          release();
          endFirmwareUpgrade();
          sessionLog.recordStage('lock', { action: 'released' });
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
      sessionLog.recordStage('exception', {
        message: err instanceof Error ? err.message : String(err),
        terminationConfirmed,
      });
      sessionLog.finish({
        processTerminationConfirmed: terminationConfirmed,
        outcomeStatus: 'unclear',
        outcomeReason: terminationConfirmed ? 'internal-error-before-launch' : 'internal-error-uncertain',
        userMessageKey: 'result.unclearTitle',
        toolProcessConfirmedFinished: terminationConfirmed,
        successSignalDetected: false,
      });
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
          // Not a vendor-log parsing path — this is our own internal-error message (a plain JS
          // string, always readable), and no vendor log diagnostics were ever extracted here.
          encodingKnown: true,
          otaTableHadFailures: false,
          sawUfwGenerated: false,
          sawNoLicenseWarning: false,
        } satisfies FirmwareUpgradeOutcome);
      } catch {
        // window already gone
      }
    }
  })();

  return { status: 'started' };
}

// ---------------------------------------------------------------------------------------
// Official firmware download flow (Windows only) — talks to the secret-free public
// register.ponyabc.uk firmware catalog. Both handlers apply the exact same platform guard as
// startFirmwareUpgrade above, BEFORE any network call — Mac never makes a request whose only
// purpose would be decorating a screen it's telling the user not to use (FirmwareScreen.tsx's
// isMac branch never even calls these).
// ---------------------------------------------------------------------------------------

function firmwareDownloadsRootDir(): string {
  return path.join(app.getPath('userData'), 'firmwareDownloads');
}

export async function getOfficialFirmwareRelease(): Promise<FirmwareReleaseFetchResult> {
  if (process.platform !== 'win32') return { status: 'unsupported-platform' };
  return fetchOfficialFirmwareRelease(HARDWARE_REV_CONST);
}

/** The in-flight official download's abort controller, if any — cancelFirmwareDownload() is the
 *  only thing that ever aborts it. Module-level and single-slot: only one official download can
 *  usefully run at a time from a single wizard, mirroring the rest of this file's pattern. */
let currentPrepareController: AbortController | null = null;

export async function prepareOfficialFirmwarePackage(
  window: BrowserWindow,
  params: { release: FirmwareReleaseInfo },
): Promise<FirmwarePrepareResult> {
  if (process.platform !== 'win32') return { status: 'unsupported-platform' };

  const controller = new AbortController();
  currentPrepareController = controller;
  try {
    return await runPrepareOfficialFirmwarePackage({
      release: params.release,
      downloadsRootDir: firmwareDownloadsRootDir(),
      signal: controller.signal,
      onProgress: (event) => {
        try {
          window.webContents.send(IPC.firmwareDownloadProgress, event satisfies FirmwareDownloadProgressEvent);
        } catch {
          // window already gone
        }
      },
    });
  } finally {
    if (currentPrepareController === controller) currentPrepareController = null;
  }
}

/** Aborts the in-flight official download, if any. Never touches startFirmwareUpgrade's own
 *  pen lock/in-progress guard — those only ever apply once a package is actually being flashed,
 *  which this download step is strictly before. */
export function cancelFirmwareDownload(): { ok: boolean } {
  const had = currentPrepareController !== null;
  currentPrepareController?.abort();
  return { ok: had };
}

/**
 * The ONLY action on a "normal completion" result screen (success, or confirmed-terminated
 * unclear) — releases any pending lock (reusing the exact same release path
 * acknowledgeFirmwareOutcome already uses; a no-op if there's nothing pending, e.g. a real
 * 'success' outcome already released everything synchronously) and then quits the app. Never
 * reachable from a "termination not confirmed" state (timeout/unparseable) — the renderer never
 * shows/enables this action there, and this function does not attempt to distinguish or block
 * that case itself since quitting the app is not what would be unsafe there (the persisted
 * pending-run marker, see firmwareRecovery.ts, already protects the real invariant across any
 * app exit, clean or not) — what's actually disallowed is the app silently CLAIMING resolution
 * it doesn't have, which is a UI-layer concern, not this function's.
 */
export function finishFirmwareUpgrade(): { ok: boolean } {
  if (pendingRelease) {
    pendingRelease();
    pendingRelease = null;
    endFirmwareUpgrade();
  }
  app.quit();
  return { ok: true };
}

// ---------------------------------------------------------------------------------------
// Firmware diagnostic session export (Settings → Support → "Export firmware diagnostic
// logs"). Reads the structured session records written incrementally by firmwareSessionLog.ts
// during startFirmwareUpgrade above, redacts personal path info, and writes them plus their raw
// vendor-output sidecars to a user-chosen folder. Local-only: this never uploads anything, and
// is a completely separate export from exportDiagnostics() in diagnostics.ts (the general,
// capped app-wide diagnostics log) — a user may want either or both.
// ---------------------------------------------------------------------------------------

const MAX_SESSIONS_TO_EXPORT = 5;

export async function exportFirmwareDiagnostics(window: BrowserWindow): Promise<DiagnosticsExportResult> {
  const result = await dialog.showOpenDialog(window, {
    properties: ['openDirectory'],
    title: 'Choose a folder to save firmware diagnostic logs',
  });
  if (result.canceled || result.filePaths.length === 0) return { status: 'cancelled' };

  try {
    const userDataPath = app.getPath('userData');
    const allSessions = listFirmwareSessions(userDataPath);
    const mostRecentInterrupted = allSessions.find((s) => s.interrupted);
    const toExport = allSessions.slice(0, MAX_SESSIONS_TO_EXPORT);
    if (mostRecentInterrupted && !toExport.some((s) => s.sessionId === mostRecentInterrupted.sessionId)) {
      toExport.push(mostRecentInterrupted);
    }

    const destDir = path.join(result.filePaths[0], `ponyabc-firmware-diagnostics-${new Date().toISOString().replace(/[:.]/g, '-')}`);
    fs.mkdirSync(destDir, { recursive: true });

    const username = os.userInfo().username;
    for (const summary of toExport) {
      const full = readFullFirmwareSession(userDataPath, summary.sessionId);
      if (!full) continue; // corrupt/unreadable session file — skip rather than fail the whole export
      const redactedRecord = redactSessionRecordForExport(full.record, redactText);
      fs.writeFileSync(path.join(destDir, `${summary.sessionId}.json`), JSON.stringify(redactedRecord, null, 2), 'utf-8');
      if (full.rawLogBytes.length > 0) {
        const { text } = decodeLogBytes(full.rawLogBytes, redactedRecord.detectedCodepage);
        fs.writeFileSync(path.join(destDir, `${summary.sessionId}.decoded.txt`), redactText(text), 'utf-8');
        // Raw bytes are kept as close to untouched as possible (only a best-effort ASCII
        // username scrub — see redactRawLogBytesForExport's own doc) specifically so encoding
        // problems remain investigable from the real original bytes.
        fs.writeFileSync(path.join(destDir, `${summary.sessionId}.raw.bin`), redactRawLogBytesForExport(full.rawLogBytes, username));
      }
    }

    return { status: 'ok', path: destDir };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
