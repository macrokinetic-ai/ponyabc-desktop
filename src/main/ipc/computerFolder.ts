import fs from 'node:fs';
import { dialog, type BrowserWindow } from 'electron';
import type { ComputerFile, ComputerFolderListResult, ComputerFolderResult } from '@shared/types';
import { isEligibleMp3FileName, resolveContainedFile } from '../services/pathSecurity';
import * as session from '../services/session';
import type { SettingsStore } from '../services/settingsStore';

function resolveFolder(chosenPath: string): { status: 'ok'; realPath: string } | { status: 'not-found' | 'not-a-directory'; path: string } {
  let realPath: string;
  try {
    realPath = fs.realpathSync(chosenPath);
  } catch {
    return { status: 'not-found', path: chosenPath };
  }
  try {
    if (!fs.statSync(realPath).isDirectory()) return { status: 'not-a-directory', path: chosenPath };
  } catch {
    return { status: 'not-found', path: chosenPath };
  }
  return { status: 'ok', realPath };
}

export async function selectComputerFolder(window: BrowserWindow, store: SettingsStore): Promise<ComputerFolderResult> {
  // Test-only override so automated/CDP verification can seed the right pane without a
  // native OS dialog, which cannot be driven programmatically. Never used unless the
  // developer explicitly sets this env var.
  const testOverride = process.env.PONYABC_TEST_COMPUTER_FOLDER;
  if (testOverride) {
    const resolved = resolveFolder(testOverride);
    if (resolved.status === 'ok') {
      session.setComputerFolder(resolved.realPath);
      store.update({ lastComputerFolderPath: resolved.realPath });
      return { status: 'ok', path: resolved.realPath };
    }
  }

  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: 'Choose (or create) a folder on your computer',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (canceled || filePaths.length === 0) return { status: 'cancelled' };

  const resolved = resolveFolder(filePaths[0]);
  if (resolved.status !== 'ok') return resolved;

  session.setComputerFolder(resolved.realPath);
  store.update({ lastComputerFolderPath: resolved.realPath });
  return { status: 'ok', path: resolved.realPath };
}

export function restoreComputerFolder(store: SettingsStore): ComputerFolderResult {
  const testOverride = process.env.PONYABC_TEST_COMPUTER_FOLDER;
  const lastPath = testOverride || store.get().lastComputerFolderPath;
  if (!lastPath) return { status: 'none' };

  const resolved = resolveFolder(lastPath);
  if (resolved.status !== 'ok') return resolved;

  session.setComputerFolder(resolved.realPath);
  return { status: 'ok', path: resolved.realPath };
}

export function listComputerFolder(): ComputerFolderListResult {
  const folder = session.getComputerFolder();
  if (!folder) return { status: 'no-folder-selected' };

  const resolved = resolveFolder(folder);
  if (resolved.status === 'not-found') return { status: 'not-found', path: folder };
  if (resolved.status !== 'ok') return { status: 'error', message: `Selected folder is not usable: ${folder}` };

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(resolved.realPath, { withFileTypes: true });
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }

  const files: ComputerFile[] = [];
  for (const entry of entries) {
    if (!isEligibleMp3FileName(entry.name)) continue;
    const fileResolution = resolveContainedFile(resolved.realPath, entry.name);
    if (fileResolution.status !== 'ok') continue;
    try {
      const stat = fs.statSync(fileResolution.realPath);
      if (!stat.isFile()) continue;
      files.push({ name: entry.name, sizeBytes: stat.size, mtimeMs: stat.mtimeMs });
    } catch {
      // Vanished between readdir and stat — omit it.
    }
  }

  return { status: 'ok', files, folderPath: resolved.realPath };
}
