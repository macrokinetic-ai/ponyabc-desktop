import fs from 'node:fs';
import path from 'node:path';
import type { FirmwareDownloadProgressEvent, FirmwareReleaseInfo } from '@shared/types';
import { downloadFile } from './transferService';
import { FIRMWARE_API_BASE_URL } from './firmwareCatalog/httpClient';

export type FirmwareDownloadOutcome =
  | { status: 'ok'; zipPath: string }
  | { status: 'cancelled' }
  | { status: 'hash-mismatch'; actualSizeBytes: number; actualSha256: string | null }
  | { status: 'network-error'; message: string };

/**
 * Downloads `release.downloadUrl` (relative or absolute — resolved against the same host the
 * catalog fetch used) into `<destDir>/package.zip.part`, verifying size (and SHA-256, when the
 * release declares one) before an atomic rename to `<destDir>/package.zip`. `destDir` is
 * expected to already be the per-hardwareRev/version directory — see
 * `<userData>/firmwareDownloads/<hardwareRev>/<version>` in main/ipc/firmware.ts.
 */
export async function downloadFirmwarePackage(params: {
  release: FirmwareReleaseInfo;
  destDir: string;
  signal: AbortSignal;
  onProgress?: (e: FirmwareDownloadProgressEvent) => void;
  fetchFn?: typeof fetch;
}): Promise<FirmwareDownloadOutcome> {
  const { release, destDir, signal, onProgress, fetchFn } = params;

  fs.mkdirSync(destDir, { recursive: true });
  const tmpPath = path.join(destDir, 'package.zip.part');
  const finalPath = path.join(destDir, 'package.zip');
  const fullUrl = new URL(release.downloadUrl, FIRMWARE_API_BASE_URL).toString();

  const outcome = await downloadFile({
    url: fullUrl,
    destTmpPath: tmpPath,
    expectedSize: release.sizeBytes,
    // sha256 may be null (no trustworthy hash declared) — downloadFile() then verifies size
    // only, same as the BOOK download path's handling of an entry with a null sha256.
    expectedSha256: release.sha256,
    signal,
    fetchFn,
    onProgress: (e) => onProgress?.({ phase: e.phase === 'cancelled' ? 'failed' : e.phase, bytesReceived: e.bytesReceived, totalBytes: e.totalBytes }),
  });

  if (outcome.status === 'cancelled') return { status: 'cancelled' };
  if (outcome.status !== 'ok') return outcome;

  await fs.promises.rename(tmpPath, finalPath);
  return { status: 'ok', zipPath: finalPath };
}
