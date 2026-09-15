import fs from 'node:fs';
import path from 'node:path';
import type { FirmwarePackageInfo, FirmwareUpgradeOutcome } from '@shared/types';
import type { RunElevatedResult } from './elevatedRun';

/** Every file the CONFIRMED working chain (tools\download.bat → ... →
 *  soundbox\standard\download.bat → isd_download.exe) actually depends on, relative to the
 *  package root — never the developer-toolchain-only inputs (sdk.elf, the .bc intermediates,
 *  etc.), since those are provably a no-op when absent (see tasks/todo.md's dependency trace):
 *  their outputs already sit pre-built in the package, and download.bat's own copy commands
 *  just copy those pre-built files over themselves when the toolchain-dependent steps fail. */
const REQUIRED_RELATIVE_FILES = [
  'download.bat',
  'isd_download.exe',
  'ufw_maker.exe',
  'uboot.boot',
  'ota.bin',
  'script.ver',
  path.join('soundbox', 'standard', 'download.bat'),
  path.join('soundbox', 'standard', 'app.bin'),
  path.join('soundbox', 'standard', 'br25loader.bin'),
];

/** Real filesystem check — never inferred from the folder's name or any file's mtime. */
export function inspectFirmwarePackage(rootDir: string): FirmwarePackageInfo {
  const missing = REQUIRED_RELATIVE_FILES.filter((rel) => !fs.existsSync(path.join(rootDir, rel)));
  return {
    rootDir,
    entryBatPath: path.join(rootDir, 'download.bat'),
    looksValid: missing.length === 0,
    missingFiles: missing,
  };
}

const MAX_LOG_EXCERPT_CHARS = 4000;

/**
 * Pure — no filesystem/process access. The ONLY thing that can ever produce 'success' is the
 * literal, case-insensitive string "download success" appearing in the tool's own real output
 * — the signal the vendor's own documentation (P5点读笔升级方法.pdf) describes as the actual
 * completion marker. A real exit code of 0 is carried through for diagnostics but is NEVER by
 * itself sufficient for 'success': the confirmed chain's own batch scripts never check
 * `errorlevel` after the actual flash step, so a "clean" exit code mostly just reflects the
 * trailing housekeeping commands (a dismissed `pause`, a `del`) succeeding — not that
 * isd_download.exe itself did. Anything that completed without the confirmed signal is
 * 'unclear', never guessed either way — including a real exit code of 0.
 */
export function determineOutcome(params: { logText: string; elevation: RunElevatedResult }): FirmwareUpgradeOutcome {
  const { logText, elevation } = params;
  const logExcerpt = logText.slice(-MAX_LOG_EXCERPT_CHARS);

  if (elevation.status === 'declined') {
    return { status: 'failed', reason: 'declined', exitCode: null, logExcerpt };
  }
  if (elevation.status === 'launch-error') {
    return { status: 'failed', reason: 'launch-error', exitCode: null, logExcerpt };
  }
  if (elevation.status === 'timeout') {
    return { status: 'unclear', reason: 'timeout', exitCode: null, logExcerpt };
  }
  if (elevation.status === 'unsupported-platform') {
    return { status: 'failed', reason: 'unsupported-platform', exitCode: null, logExcerpt };
  }
  if (elevation.status === 'unparseable') {
    return { status: 'unclear', reason: 'unparseable-wrapper-output', exitCode: null, logExcerpt };
  }
  // elevation.status === 'completed'
  if (/download success/i.test(logText)) {
    return { status: 'success', reason: 'log-contains-download-success', exitCode: elevation.exitCode, logExcerpt };
  }
  return { status: 'unclear', reason: 'no-recognized-signal', exitCode: elevation.exitCode, logExcerpt };
}
