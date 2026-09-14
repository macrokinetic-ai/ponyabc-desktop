import path from 'node:path';
import { app, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type { ConflictDecision, ReplaceStickerSummary, TransferToPenSummary } from '@shared/types';
import * as planner from '../services/transferPlanner';

function backupRootDir(): string {
  return path.join(app.getPath('userData'), 'backups');
}

export const planTransferToPen = planner.planTransferToPen;
export const planReplaceSticker = planner.planReplaceSticker;

export function executeTransferToPen(
  window: BrowserWindow,
  params: { fileNames: string[]; decisions: Record<string, ConflictDecision>; penGeneration: number },
): Promise<TransferToPenSummary> {
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
