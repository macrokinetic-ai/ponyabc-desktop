import path from 'node:path';
import type { FirmwareDownloadProgressEvent, FirmwarePrepareResult, FirmwareReleaseInfo } from '@shared/types';
import { downloadFirmwarePackage } from './firmwareDownload';
import { extractFirmwarePackage } from './firmwareExtract';

/**
 * Orchestrates the official firmware download flow end to end: download → verify (done inside
 * downloadFirmwarePackage's shared downloadFile()) → extract → auto-detect the real package
 * root. Never calls startFirmwareUpgrade/runElevated itself — this only ever produces a
 * `packageDir` for the renderer to feed into the existing, unmodified confirm/upgrade flow,
 * exactly like the local-folder test/support path already does.
 */
export async function prepareOfficialFirmwarePackage(params: {
  release: FirmwareReleaseInfo;
  downloadsRootDir: string;
  signal: AbortSignal;
  onProgress?: (e: FirmwareDownloadProgressEvent) => void;
  fetchFn?: typeof fetch;
}): Promise<FirmwarePrepareResult> {
  const { release, downloadsRootDir, signal, onProgress, fetchFn } = params;
  const destDir = path.join(downloadsRootDir, release.hardwareRev, release.version);

  let downloadOutcome;
  try {
    downloadOutcome = await downloadFirmwarePackage({ release, destDir, signal, onProgress, fetchFn });
  } catch (err) {
    // An unexpected local I/O error (mkdir/rename/etc.) during the download step — distinct
    // from a clean network-level outcome, which downloadFile() itself already reports.
    return { status: 'download-failed', message: err instanceof Error ? err.message : String(err) };
  }

  if (downloadOutcome.status === 'cancelled') return { status: 'cancelled' };
  if (downloadOutcome.status === 'network-error') return { status: 'no-network', message: downloadOutcome.message };
  if (downloadOutcome.status === 'hash-mismatch') {
    return {
      status: 'verify-failed',
      message: `Downloaded file failed verification (expected ${release.sizeBytes} bytes${release.sha256 ? ` / sha256 ${release.sha256}` : ''}, got ${downloadOutcome.actualSizeBytes} bytes${downloadOutcome.actualSha256 ? ` / sha256 ${downloadOutcome.actualSha256}` : ''}).`,
    };
  }

  onProgress?.({ phase: 'extracting' });
  const extractDir = path.join(destDir, 'extracted');
  let extractOutcome;
  try {
    extractOutcome = await extractFirmwarePackage(downloadOutcome.zipPath, extractDir);
  } catch (err) {
    return { status: 'extract-failed', message: err instanceof Error ? err.message : String(err) };
  }
  if (!extractOutcome.ok) {
    return { status: 'extract-failed', message: extractOutcome.reason, missingFiles: extractOutcome.missingFiles };
  }

  onProgress?.({ phase: 'done' });
  return { status: 'ok', packageDir: extractOutcome.packageDir };
}
