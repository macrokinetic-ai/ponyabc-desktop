import fs from 'node:fs';
import { type BrowserWindow } from 'electron';
import { IPC } from '@shared/ipcChannels';
import type { CopySummary, RecordingFile, RecordingsListResult } from '@shared/types';
import { copyFiles, type CopyFileTask } from '../services/copyService';
import { isEligibleMp3FileName, resolveContainedFile, resolveDestination, resolvePenRoot } from '../services/pathSecurity';
import * as session from '../services/session';

export function listDiyRecordings(): RecordingsListResult {
  const penRoot = session.getPenRoot();
  if (!penRoot) return { status: 'no-pen-selected' };

  // Re-validate live — the pen may have been unplugged or its folders removed since selection.
  const fresh = resolvePenRoot(penRoot.realPath);
  if (fresh.status === 'not-found') {
    session.setPenRoot(null); // invalidate immediately so a later reconnect never silently reuses this session
    return { status: 'device-disconnected' };
  }
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
    if (!isEligibleMp3FileName(entry.name)) continue;
    const resolution = resolveContainedFile(fresh.diyDirReal, entry.name);
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

function emptySummary(status: CopySummary['status'], message?: string): CopySummary {
  return { status, succeeded: [], renamed: [], failed: [], message };
}

/** Operation A: copy selected DIY recordings from the pen into the current computer folder
 *  (the persistent right-pane folder — no per-click destination dialog). Never overwrites a
 *  same-named file on the computer; auto-renames instead. Originals stay on the pen. */
export async function copyRecordingsToComputer(window: BrowserWindow, fileNames: string[]): Promise<CopySummary> {
  const penRoot = session.getPenRoot();
  if (!penRoot) return emptySummary('no-pen-selected');

  const computerFolder = session.getComputerFolder();
  if (!computerFolder) return emptySummary('no-computer-folder-selected');

  // Re-validate everything immediately before touching disk — nothing here is trusted
  // just because it was valid at selection time.
  const freshPenRoot = resolvePenRoot(penRoot.realPath);
  if (freshPenRoot.status === 'not-found') {
    session.setPenRoot(null);
    return emptySummary('device-disconnected');
  }
  if (freshPenRoot.status === 'invalid') {
    return emptySummary('error', `Expected folder(s) missing on the pen: ${freshPenRoot.missing.join(', ')}`);
  }
  session.setPenRoot(freshPenRoot);

  const destResolution = resolveDestination(computerFolder, freshPenRoot.realPath);
  if (destResolution.status === 'on-pen') {
    return emptySummary('invalid-destination', 'The computer folder currently points at the pen itself. Choose a folder on your computer instead.');
  }
  if (destResolution.status !== 'ok') {
    return emptySummary('error', 'The computer folder is no longer available. Please choose again.');
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
    if (!isEligibleMp3FileName(fileName)) {
      preRejected.push({ file: fileName, message: 'Not an eligible .mp3 file.', reason: 'security-rejected' });
      continue;
    }
    const resolution = resolveContainedFile(freshPenRoot.diyDirReal, fileName);
    if (resolution.status === 'ok') {
      tasks.push({ sourcePath: resolution.realPath, fileName });
    } else if (resolution.status === 'not-found') {
      preRejected.push({ file: fileName, message: 'File no longer exists on the pen.', reason: 'not-found' });
    } else {
      preRejected.push({ file: fileName, message: 'File name was rejected for security reasons.', reason: 'security-rejected' });
    }
  }

  const result = await copyFiles(tasks, destResolution.realPath, {
    onProgress: (event) => window.webContents.send(IPC.transferProgress, event),
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
