import fs from 'node:fs';
import type { AudioPreviewResult, AudioSource } from '@shared/types';
import { isEligibleMp3FileName, resolveContainedFile, resolvePenRoot } from '../services/pathSecurity';
import { resolveFolder } from './computerFolder';
import * as session from '../services/session';

// A one-shot, in-memory read (not a live file handle held open for the duration of
// playback) — the main process reads the whole file, base64-encodes it, and hands it to the
// renderer, which decodes it into a Blob once. Nothing on disk stays open once this resolves,
// so there is no Windows file-locking concern for a later write to the same file.
const MAX_PREVIEW_BYTES = 50 * 1024 * 1024;

function mimeTypeFor(fileName: string): string {
  return /\.mp3$/i.test(fileName) ? 'audio/mpeg' : 'application/octet-stream';
}

/**
 * Reads one audio file for local-only preview playback. Re-resolves the pen root / computer
 * folder fresh (never trusts a stale session value) and resolves `fileName` through the same
 * resolveContainedFile boundary as every other file operation — the renderer can only ever
 * name a file by its plain basename inside the currently-authorized DIY or computer folder,
 * never an arbitrary path.
 */
export function readAudioPreview(params: { source: AudioSource; fileName: string }, maxBytes: number = MAX_PREVIEW_BYTES): AudioPreviewResult {
  const { source, fileName } = params;

  if (!isEligibleMp3FileName(fileName)) return { status: 'rejected' };

  let dirReal: string;
  if (source === 'pen') {
    const penRoot = session.getPenRoot();
    if (!penRoot) return { status: 'no-pen-selected' };
    const fresh = resolvePenRoot(penRoot.realPath);
    if (fresh.status === 'not-found') {
      session.setPenRoot(null);
      return { status: 'device-disconnected' };
    }
    if (fresh.status === 'invalid') return { status: 'invalid', missing: fresh.missing };
    session.setPenRoot(fresh);
    dirReal = fresh.diyDirReal;
  } else {
    const computerFolder = session.getComputerFolder();
    if (!computerFolder) return { status: 'no-computer-folder-selected' };
    const resolved = resolveFolder(computerFolder);
    if (resolved.status !== 'ok') return { status: 'device-disconnected' };
    dirReal = resolved.realPath;
  }

  const resolution = resolveContainedFile(dirReal, fileName);
  if (resolution.status === 'not-found') return { status: 'not-found' };
  if (resolution.status !== 'ok') return { status: 'rejected' };

  let stat: fs.Stats;
  try {
    stat = fs.statSync(resolution.realPath);
  } catch {
    return { status: 'not-found' };
  }
  if (!stat.isFile()) return { status: 'not-found' };
  if (stat.size > maxBytes) return { status: 'too-large' };

  try {
    const bytes = fs.readFileSync(resolution.realPath);
    return { status: 'ok', base64: bytes.toString('base64'), mimeType: mimeTypeFor(fileName), sizeBytes: stat.size };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}
