import path from 'node:path';
import { dialog, type BrowserWindow } from 'electron';
import type { PenRootOk, PenRootResult, PenRootScanResult } from '@shared/types';
import { resolvePenRoot, resolvePenRootFromSelection, type PenRootResolution } from '../services/pathSecurity';
import { scanForPenCandidates } from '../services/volumeDiscovery';
import * as session from '../services/session';
import type { SettingsStore } from '../services/settingsStore';

function selectAndTag(resolution: Extract<PenRootResolution, { status: 'ok' }>, store: SettingsStore | null): PenRootOk {
  const { generation } = session.setPenRoot(resolution);
  if (store) store.update({ lastPenRootPath: resolution.realPath });
  // path.basename('D:\') is '' on a bare Windows drive root — fall back to the full path.
  const volumeLabel = path.basename(resolution.realPath) || resolution.realPath;
  return { status: 'ok', path: resolution.realPath, volumeLabel, generation };
}

function toUnresolvedResult(resolution: Exclude<PenRootResolution, { status: 'ok' }>): PenRootResult {
  if (resolution.status === 'not-found') return { status: 'not-found', path: resolution.path };
  return { status: 'invalid', path: resolution.path, missing: resolution.missing };
}

/**
 * Scans currently-mounted volumes for a pen. Exactly one candidate (or, among several, one
 * that matches the last manually-confirmed path) is auto-selected — this never copies,
 * overwrites, or deletes anything; it only identifies and remembers which volume to use.
 * Multiple unresolvable candidates are returned for the user to pick from; zero candidates
 * falls back to re-checking the last known path (it may simply not be under the scanned
 * roots), then reports 'none'.
 */
export function scanPenRoot(store: SettingsStore): PenRootScanResult {
  const { candidates, diagnostics } = scanForPenCandidates();
  session.setLastVolumeCandidates(candidates);

  if (candidates.length === 1) {
    return { ...selectAndTag(candidates[0].resolved, store), auto: true };
  }

  if (candidates.length > 1) {
    const lastPath = store.get().lastPenRootPath;
    const preferred = lastPath ? candidates.findIndex((c) => c.resolved.realPath === lastPath) : -1;
    if (preferred >= 0) {
      return { ...selectAndTag(candidates[preferred].resolved, store), auto: true };
    }
    return {
      status: 'choose',
      candidates: candidates.map((c, index) => ({ index, path: c.resolved.realPath, volumeLabel: c.volumeLabel })),
    };
  }

  // Nothing under the scanned volume roots — fall back to the last manually-confirmed path,
  // in case it's a non-standard mount point our scan doesn't cover.
  const lastPath = store.get().lastPenRootPath;
  if (lastPath) {
    const resolution = resolvePenRoot(lastPath);
    if (resolution.status === 'ok') return { ...selectAndTag(resolution, store), auto: true };
  }

  session.setPenRoot(null);
  return diagnostics.length > 0 ? { status: 'none', diagnostics } : { status: 'none' };
}

export function chooseCandidatePenRoot(store: SettingsStore, index: number): PenRootResult {
  const candidates = session.getLastVolumeCandidates();
  const candidate = candidates[index];
  if (!candidate) {
    return { status: 'error', message: 'That candidate list is stale — please rescan.' };
  }
  return selectAndTag(candidate.resolved, store);
}

export async function selectPenRoot(window: BrowserWindow, store: SettingsStore): Promise<PenRootResult> {
  const { canceled, filePaths } = await dialog.showOpenDialog(window, {
    title: "Select your pen's storage",
    properties: ['openDirectory'],
  });
  if (canceled || filePaths.length === 0) return { status: 'cancelled' };

  const resolution = resolvePenRootFromSelection(filePaths[0]);
  if (resolution.status === 'ok') return selectAndTag(resolution, store);
  return toUnresolvedResult(resolution);
}
