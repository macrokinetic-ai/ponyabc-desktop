import { dialog, type BrowserWindow } from 'electron';
import type { PenRootResult } from '@shared/types';
import { resolvePenRoot } from '../services/pathSecurity';
import * as session from '../services/session';
import type { SettingsStore } from '../services/settingsStore';

function toApiResult(resolution: ReturnType<typeof resolvePenRoot>): PenRootResult {
  if (resolution.status === 'ok') return { status: 'ok', path: resolution.realPath };
  if (resolution.status === 'not-found') return { status: 'not-found', path: resolution.path };
  return { status: 'invalid', path: resolution.path, missing: resolution.missing };
}

export async function selectPenRoot(window: BrowserWindow, store: SettingsStore): Promise<PenRootResult> {
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: "Select your pen's storage",
    properties: ['openDirectory'],
  });
  if (canceled || filePaths.length === 0) return { status: 'cancelled' };

  const resolution = resolvePenRoot(filePaths[0]);
  if (resolution.status === 'ok') {
    session.setPenRoot(resolution);
    store.update({ lastPenRootPath: resolution.realPath });
  }
  return toApiResult(resolution);
}

export async function restorePenRoot(store: SettingsStore): Promise<PenRootResult> {
  const lastPath = store.get().lastPenRootPath;
  if (!lastPath) return { status: 'none' };

  const resolution = resolvePenRoot(lastPath);
  if (resolution.status === 'ok') {
    session.setPenRoot(resolution);
  }
  return toApiResult(resolution);
}
