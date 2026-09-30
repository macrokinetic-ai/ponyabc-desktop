import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type { ConflictDecision, ReplaceStickerSummary, TransferToPenSummary } from '@shared/types';
import * as planner from '../services/transferPlanner';
import { createSnapshot } from '../services/recordingSnapshot';
import { getRecordingLabels, recordingBackupRootDir } from './recordingBackup';
import { resolvePenRoot } from '../services/pathSecurity';
import * as session from '../services/session';

/** The connected pen, or null. Re-resolved rather than trusting a stored path, like everywhere
 *  else: a pen can be unplugged between two clicks. */
function resolvePenForBackup(): { diyDirReal: string; volumeLabel: string | null } | null {
  const penRoot = session.getPenRoot();
  if (!penRoot) return null;
  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status !== 'ok') return null;
  return { diyDirReal: fresh.diyDirReal, volumeLabel: path.basename(fresh.realPath) || fresh.realPath };
}

function backupRootDir(): string {
  return path.join(app.getPath('userData'), 'backups');
}

export const planTransferToPen = planner.planTransferToPen;
export const planReplaceSticker = planner.planReplaceSticker;

/**
 * Sending recordings to the pen, with the pen's own copies kept first.
 *
 * `safeWriteFile` already keeps a loose per-file copy under `userData/backups`, which is the
 * belt-and-braces that makes an interrupted write recoverable. It is not, however, something a
 * teacher can see or put back: it is not a snapshot, so it never appears in the backups list on
 * My Recordings. So before a batch that will replace anything, one snapshot of the pen's
 * recordings is taken through the ordinary snapshot path — the same one the button takes — and it
 * shows up in that list as "Automatic backup before replacing 0451".
 */
export async function executeTransferToPen(
  window: BrowserWindow,
  params: { fileNames: string[]; decisions: Record<string, ConflictDecision>; penGeneration: number },
): Promise<TransferToPenSummary> {
  const replacing = params.fileNames.filter((name) => params.decisions[name] === 'replace');
  if (replacing.length > 0) {
    const pen = resolvePenForBackup();
    if (pen) {
      try {
        await createSnapshot({
          diyDirReal: pen.diyDirReal,
          backupRootDir: recordingBackupRootDir(),
          penVolumeLabel: pen.volumeLabel,
          labels: getRecordingLabels(),
          reason: 'before-replace',
          protecting: replacing.length === 1 ? replacing[0] : null,
        });
      } catch (err) {
        // The pen's copies could not be kept, so nothing is overwritten. A teacher replacing a
        // recording is destroying the only copy of a child's voice if this is skipped.
        return {
          status: 'backup-failed',
          added: [],
          replaced: [],
          skipped: [],
          failed: params.fileNames.map((file) => ({
            file,
            message: err instanceof Error ? err.message : String(err),
            reason: 'backup-failed',
          })),
        };
      }
    }
  }

  return planner.executeTransferToPen({
    ...params,
    backupRootDir: backupRootDir(),
    onProgress: (event) => window.webContents.send(IPC.transferProgress, event),
  });
}

export function executeReplaceSticker(
  window: BrowserWindow,
  params: { penFileName: string; computerFileName: string; penGeneration: number },
): Promise<ReplaceStickerSummary> {
  return planner.executeReplaceSticker({
    ...params,
    backupRootDir: backupRootDir(),
    onProgress: (event) => window.webContents.send(IPC.transferProgress, event),
  });
}
