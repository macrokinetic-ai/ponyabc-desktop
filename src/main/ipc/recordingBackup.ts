import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import { resolvePenRoot } from '../services/pathSecurity';
import * as session from '../services/session';
import { createJsonStore } from '../services/bookStore';
import { createSnapshot, listSnapshots, readManifest, type SnapshotManifest, type SnapshotReason } from '../services/recordingSnapshot';
import { executeRestore, planRestore, type RestoreDecision, type RestorePlan, type RestoreResult } from '../services/recordingRestore';
import {
  deleteFromPen,
  deleteFromSnapshot,
  getLabels,
  reassignStickerNumber,
  renameLabelKey,
  setLabel,
  type DeleteResult,
  type RecordingLabels,
  type ReassignResult,
} from '../services/recordingManage';
import { migrateLegacyBackups, scanLegacyBackups, type LegacyScan, type MigrationResult } from '../services/recordingMigration';

/**
 * The renderer-facing half of recordings v2.
 *
 * Everything here re-resolves the pen fresh on every call and never trusts a stored path — the
 * same rule the rest of the app follows, because a pen can be unplugged between two clicks.
 * Backups live under the app's own userData, so they survive an app update and are never on the
 * pen itself.
 */

export type PenResolution = { status: 'ok'; diyDirReal: string; volumeLabel: string | null } | { status: 'no-pen' };

function resolvePen(): PenResolution {
  const penRoot = session.getPenRoot();
  if (!penRoot) return { status: 'no-pen' };
  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status !== 'ok') {
    if (fresh.status === 'not-found') session.setPenRoot(null);
    return { status: 'no-pen' };
  }
  session.setPenRoot(fresh);
  // Same derivation the BOOK side uses for its verification index, so both features key their
  // per-pen data the same way.
  return { status: 'ok', diyDirReal: fresh.diyDirReal, volumeLabel: path.basename(fresh.realPath) || fresh.realPath };
}

export function recordingBackupRootDir(): string {
  return path.join(app.getPath('userData'), 'RecordingBackups');
}

let labelStore: ReturnType<typeof createJsonStore<RecordingLabels>> | null = null;
function labels() {
  labelStore ??= createJsonStore<RecordingLabels>(path.join(app.getPath('userData'), 'recordingLabels.json'), () => ({}));
  return labelStore;
}

export interface SnapshotSummary {
  snapshotId: string;
  createdAtMs: number;
  penVolumeLabel: string | null;
  recordingCount: number;
  /** Snapshots written before rc6 carry no reason; they were all made by the button. */
  reason: SnapshotReason;
  /** The recording this backup was protecting, for the automatic reasons. */
  protecting: string | null;
}

/** One recording inside a backup, as the screen needs to show it. */
export interface SnapshotEntrySummary {
  fileName: string;
  /** The friendly name as it was when the backup was taken, if one had been set. */
  label: string | null;
  sizeBytes: number;
  mtimeMs: number;
}

export type SnapshotContents =
  | { status: 'no-such-backup' }
  | {
      status: 'ok';
      snapshotId: string;
      createdAtMs: number;
      reason: SnapshotReason;
      protecting: string | null;
      entries: SnapshotEntrySummary[];
    };

const summarise = (manifest: SnapshotManifest): SnapshotSummary => ({
  snapshotId: manifest.snapshotId,
  createdAtMs: manifest.createdAtMs,
  penVolumeLabel: manifest.penVolumeLabel,
  recordingCount: manifest.entries.length,
  reason: manifest.reason ?? 'manual',
  protecting: manifest.protecting ?? null,
});

/**
 * What is actually inside one backup.
 *
 * rc5 could tell you a backup held twenty recordings and then show you nothing, because the
 * summary above was the only thing the screen ever received — the entries never left the main
 * process. The owner found exactly that.
 */
export function getRecordingBackupContents(params: { snapshotId: string }): SnapshotContents {
  const found = snapshotDirFor(params.snapshotId);
  if (!found) return { status: 'no-such-backup' };
  return {
    status: 'ok',
    snapshotId: found.manifest.snapshotId,
    createdAtMs: found.manifest.createdAtMs,
    reason: found.manifest.reason ?? 'manual',
    protecting: found.manifest.protecting ?? null,
    entries: found.manifest.entries
      .map((e) => ({ fileName: e.fileName, label: e.label, sizeBytes: e.sizeBytes, mtimeMs: e.mtimeMs }))
      .sort((a, b) => a.fileName.localeCompare(b.fileName)),
  };
}

export function listRecordingBackups(): SnapshotSummary[] {
  return listSnapshots(recordingBackupRootDir()).map((s) => summarise(s.manifest));
}

export function getRecordingLabels(): Record<string, string> {
  const pen = resolvePen();
  return getLabels(labels().get(), pen.status === 'ok' ? pen.volumeLabel : null);
}

export function setRecordingLabel(params: { fileName: string; label: string }): Record<string, string> {
  const pen = resolvePen();
  const penLabel = pen.status === 'ok' ? pen.volumeLabel : null;
  const next = setLabel(labels().get(), penLabel, params.fileName, params.label);
  labels().set(next);
  return getLabels(next, penLabel);
}

export type BackupCreateResult =
  | { status: 'no-pen-selected' }
  | { status: 'ok'; snapshotId: string; recordingCount: number; dedupedCount: number; failedCount: number };

export async function createRecordingBackup(window: BrowserWindow): Promise<BackupCreateResult> {
  const pen = resolvePen();
  if (pen.status !== 'ok') return { status: 'no-pen-selected' };

  const result = await createSnapshot({
    diyDirReal: pen.diyDirReal,
    backupRootDir: recordingBackupRootDir(),
    penVolumeLabel: pen.volumeLabel,
    labels: getRecordingLabels(),
    reason: 'manual',
    onProgress: (event) => {
      try {
        window.webContents.send(IPC.recordingBackupProgress, event);
      } catch {
        // window gone
      }
    },
  });

  return {
    status: 'ok',
    snapshotId: result.snapshotId,
    recordingCount: result.manifest.entries.length,
    dedupedCount: result.dedupedCount,
    failedCount: result.failed.length,
  };
}

function snapshotDirFor(snapshotId: string): { dir: string; manifest: SnapshotManifest } | null {
  // Never build the path from the renderer's string directly — look it up among the snapshots we
  // actually hold, so an id is only ever a key, never a path fragment.
  const found = listSnapshots(recordingBackupRootDir()).find((s) => s.snapshotId === snapshotId);
  if (!found) return null;
  const manifest = readManifest(found.snapshotDir);
  return manifest ? { dir: found.snapshotDir, manifest } : null;
}

export type RestorePlanResult = { status: 'no-pen-selected' } | { status: 'no-such-backup' } | ({ status: 'ok' } & RestorePlan);

export async function planRecordingRestore(params: { snapshotId: string; fileNames?: string[] }): Promise<RestorePlanResult> {
  const pen = resolvePen();
  if (pen.status !== 'ok') return { status: 'no-pen-selected' };
  const found = snapshotDirFor(params.snapshotId);
  if (!found) return { status: 'no-such-backup' };

  const plan = await planRestore({
    snapshotDir: found.dir,
    manifest: found.manifest,
    diyDirReal: pen.diyDirReal,
    fileNames: params.fileNames,
  });
  return { ...plan, status: 'ok' };
}

export type RestoreExecuteResult = { status: 'no-pen-selected' } | { status: 'no-such-backup' } | ({ status: 'ok' } & RestoreResult);

export async function executeRecordingRestore(
  window: BrowserWindow,
  params: { snapshotId: string; plan: RestorePlan; decisions: Record<string, RestoreDecision> },
): Promise<RestoreExecuteResult> {
  const pen = resolvePen();
  if (pen.status !== 'ok') return { status: 'no-pen-selected' };
  const found = snapshotDirFor(params.snapshotId);
  if (!found) return { status: 'no-such-backup' };

  const result = await executeRestore({
    snapshotDir: found.dir,
    plan: params.plan,
    diyDirReal: pen.diyDirReal,
    decisions: params.decisions,
    backupRootDir: recordingBackupRootDir(),
    penVolumeLabel: pen.volumeLabel,
    labels: getRecordingLabels(),
    onProgress: (event) => {
      try {
        window.webContents.send(IPC.recordingBackupProgress, event);
      } catch {
        // window gone
      }
    },
  });
  return { ...result, status: 'ok' };
}

export type PenDeleteResult = { status: 'no-pen-selected' } | { status: 'backup-failed'; error: string } | ({ status: 'ok' } & DeleteResult);

export async function deleteRecordingsFromPen(params: { fileNames: string[] }): Promise<PenDeleteResult> {
  const pen = resolvePen();
  if (pen.status !== 'ok') return { status: 'no-pen-selected' };

  const result = await deleteFromPen({
    diyDirReal: pen.diyDirReal,
    fileNames: params.fileNames,
    backupRootDir: recordingBackupRootDir(),
    penVolumeLabel: pen.volumeLabel,
    labels: getRecordingLabels(),
  });
  if ('status' in result) return result;
  return { ...result, status: 'ok' };
}

export type BackupDeleteResult = { status: 'no-such-backup' } | ({ status: 'ok' } & DeleteResult);

export function deleteRecordingsFromBackup(params: { snapshotId: string; fileNames: string[] }): BackupDeleteResult {
  const found = snapshotDirFor(params.snapshotId);
  if (!found) return { status: 'no-such-backup' };
  return { ...deleteFromSnapshot({ snapshotDir: found.dir, fileNames: params.fileNames }), status: 'ok' };
}

export type ReassignIpcResult = { status: 'no-pen-selected' } | ReassignResult;

export async function reassignRecording(params: { fileName: string; input: string }): Promise<ReassignIpcResult> {
  const pen = resolvePen();
  if (pen.status !== 'ok') return { status: 'no-pen-selected' };

  const result = await reassignStickerNumber({
    diyDirReal: pen.diyDirReal,
    currentFileName: params.fileName,
    input: params.input,
    backupRootDir: recordingBackupRootDir(),
    penVolumeLabel: pen.volumeLabel,
    labels: getRecordingLabels(),
  });
  // The label describes the recording, not the number, so it follows the file.
  if (result.status === 'ok') labels().set(renameLabelKey(labels().get(), pen.volumeLabel, params.fileName, result.fileName));
  return result;
}

export async function scanLegacyRecordingBackups(params: { folder: string }): Promise<LegacyScan> {
  return scanLegacyBackups(params.folder);
}

export async function migrateLegacyRecordingBackups(params: { scan: LegacyScan; choices: Record<string, string> }): Promise<MigrationResult> {
  const pen = resolvePen();
  return migrateLegacyBackups({
    scan: params.scan,
    choices: params.choices,
    backupRootDir: recordingBackupRootDir(),
    penVolumeLabel: pen.status === 'ok' ? pen.volumeLabel : null,
  });
}
