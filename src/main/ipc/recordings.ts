import fs from 'node:fs';
import { dialog, type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type { ChooseDestinationResult, CopySummary, RecordingFile, RecordingsListResult } from '@shared/types';
import { copyFiles, type CopyFileTask } from '../services/copyService';
import { resolveDestination, resolveDiySourceFile, resolvePenRoot } from '../services/pathSecurity';
import * as session from '../services/session';

const AUDIO_EXTENSION = /\.mp3$/i;

export function listDiyRecordings(): RecordingsListResult {
  const penRoot = session.getPenRoot();
  if (!penRoot) return { status: 'no-pen-selected' };

  // Re-validate live — the pen may have been unplugged or its folders removed since selection.
  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status === 'not-found') return { status: 'device-disconnected' };
  if (fresh.status === 'invalid') return { status: 'invalid', missing: fresh.missing };
  session.setPenRoot(fresh);

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(fresh.diyDirReal, { withFileTypes: true });
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  const files: RecordingFile[] = [];
  for (const entry of entries) {
    if (!AUDIO_EXTENSION.test(entry.name)) continue;
    const resolution = resolveDiySourceFile(fresh.diyDirReal, entry.name);
    if (resolution.status !== 'ok') continue; // symlink escapes or races — silently excluded from the list
    try {
      const stat = fs.statSync(resolution.realPath);
      if (!stat.isFile()) continue;
      files.push({ name: entry.name, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // File vanished between readdir and stat — just omit it.
    }
  }

  return { status: 'ok', files, diyFolderName: fresh.diyDirName };
}

export async function chooseSaveDestination(window: BrowserWindow): Promise<ChooseDestinationResult> {
  const penRoot = session.getPenRoot();
  if (!penRoot) return { status: 'no-pen-selected' };

  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: 'Choose where to save the selected recordings',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || filePaths.length === 0) return { status: 'cancelled' };

  const resolution = resolveDestination(filePaths[0], penRoot.realPath);
  if (resolution.status === 'on-pen') {
    return { status: 'invalid-destination', reason: 'on-pen', path: resolution.path };
  }
  if (resolution.status !== 'ok') {
    return { status: 'error', message: `Selected folder is not usable: ${resolution.path}` };
  }

  session.setDestination(resolution.realPath);
  return { status: 'ok', path: resolution.realPath };
}

function emptySummary(status: CopySummary['status'], message?: string): CopySummary {
  return { status, succeeded: [], renamed: [], failed: [], message };
}

export async function copyRecordings(window: BrowserWindow, fileNames: string[]): Promise<CopySummary> {
  const penRoot = session.getPenRoot();
  if (!penRoot) return emptySummary('no-pen-selected');

  const destinationRealPath = session.getDestination();
  if (!destinationRealPath) return emptySummary('no-destination-selected');

  // Re-validate everything immediately before touching disk — nothing here is trusted
  // just because it was valid at selection time.
  const freshPenRoot = resolvePenRoot(penRoot.realPath);
  if (freshPenRoot.status === 'not-found') return emptySummary('device-disconnected');
  if (freshPenRoot.status === 'invalid') {
    return emptySummary('error', `Expected folder(s) missing on the pen: ${freshPenRoot.missing.join(', ')}`);
  }
  session.setPenRoot(freshPenRoot);

  const destResolution = resolveDestination(destinationRealPath, freshPenRoot.realPath);
  if (destResolution.status === 'on-pen') {
    return emptySummary('invalid-destination', 'The destination is on the pen itself. Choose a folder on your computer instead.');
  }
  if (destResolution.status !== 'ok') {
    return emptySummary('error', 'The chosen destination folder is no longer available. Please choose again.');
  }

  if (!Array.isArray(fileNames) || fileNames.length === 0) {
    return emptySummary('error', 'No files were selected.');
  }
  if (fileNames.length > 5000) {
    return emptySummary('error', 'Too many files selected in one batch.');
  }

  const tasks: CopyFileTask[] = [];
  const preRejected: CopySummary['failed'] = [];
  for (const fileName of fileNames) {
    const resolution = resolveDiySourceFile(freshPenRoot.diyDirReal, fileName);
    if (resolution.status === 'ok') {
      tasks.push({ sourcePath: resolution.realPath, fileName });
    } else if (resolution.status === 'not-found') {
      preRejected.push({ file: fileName, message: 'File no longer exists on the pen.', reason: 'not-found' });
    } else {
      preRejected.push({ file: fileName, message: 'File name was rejected for security reasons.', reason: 'security-rejected' });
    }
  }

  const result = await copyFiles(tasks, destResolution.realPath, {
    onProgress: (event) => window.webContents.send(IPC.recordingsCopyProgress, event),
    isSourceRootAvailable: () => fs.existsSync(freshPenRoot.diyDirReal),
  });

  return {
    status: result.aborted ? 'device-disconnected' : 'completed',
    succeeded: result.succeeded,
    renamed: result.renamed,
    failed: [...preRejected, ...result.failed],
    destinationPath: destResolution.realPath,
  };
}
