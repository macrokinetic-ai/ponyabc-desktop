import fs from 'node:fs';
import path from 'node:path';
import type { FirmwarePackageInfo, FirmwareUpgradeOutcome } from '@shared/types';
import type { RunElevatedResult } from './elevatedRun';

/**
 * Every file the CONFIRMED working chain (tools\download.bat → ... →
 * soundbox\standard\download.bat → isd_download.exe/ufw_maker.exe) actually reads or writes,
 * relative to the package root — traced from the two real .bat files, not inferred. This is
 * NOT a claim that every listed file's content is safe or that the package is guaranteed
 * compatible — it only means the CONFIRMED chain's real inputs are all present, so it won't
 * silently substitute a missing file for something else or crash on a bare "not recognized"
 * without producing a distinguishable failure. See tasks/todo.md's 2026-09-15 verification round
 * and tasks/lessons.md for why a size/presence-only check like this one was previously
 * (wrongly) treated as proof of safety — it is one necessary precondition, not a confirmation
 * that the upgrade WILL succeed or that these bytes are the right firmware.
 *
 * Deliberately excluded, because they are genuinely never touched by this confirmed chain on a
 * machine lacking the dev toolchain (`C:\JL\pi32\bin\llvm-*.exe`), which is the case on every
 * real end-user PC: sdk.elf, the .bc intermediates, and the objcopy/objdump-only outputs
 * (aeco.bin/wavo.bin/etc., text.bin/data.bin/data_code.bin's PRE-BUILT copies are still
 * required below since they ARE the copy /b concatenation's real inputs). Also deliberately
 * excluded: `bank.bin` — it does not exist anywhere in the confirmed package and the chain runs
 * to completion without it (verified via a real Windows CI repro, see tasks/todo.md); requiring
 * it here would make `looksValid` permanently false for the one package known to work.
 */
const REQUIRED_RELATIVE_FILES = [
  // Entry points — the two-stage confirmed chain, unchanged from earlier rounds.
  'download.bat',
  path.join('soundbox', 'standard', 'download.bat'),

  // Tools the chain actually invokes. remove_tailing_zeros.exe matters here in a way the
  // earlier "no-op" framing missed: unlike objcopy/objdump, it ships INSIDE the package and its
  // own inputs (aeco.bin/wavo.bin/etc.) are also pre-shipped, so it plausibly DOES run for real
  // on an end-user PC — see the open "unverified" item in tasks/todo.md.
  'isd_download.exe',
  'ufw_maker.exe',
  'remove_tailing_zeros.exe',

  // Copied into soundbox\standard\ by download.bat itself, then consumed by isd_download.exe.
  'uboot.boot',
  'ota.bin',
  'script.ver',
  path.join('soundbox', 'standard', 'app.bin'),
  path.join('soundbox', 'standard', 'br25loader.bin'),

  // The root download.bat's `copy /b` concatenation sources for app.bin, in the order the real
  // command lists them (bank.bin intentionally omitted — see above).
  'text.bin',
  'data.bin',
  'data_code.bin',
  'aec.bin',
  'wav.bin',
  'ape.bin',
  'flac.bin',
  'm4a.bin',
  'amr.bin',
  'dts.bin',
  'fm.bin',
  'mp3.bin',
  'wma.bin',

  // Explicit CLI arguments of soundbox\standard\download.bat's isd_download.exe / ufw_maker.exe
  // invocations — a processing tool needs its named resource/key/firmware inputs to exist just
  // as much as it needs the tool itself.
  path.join('soundbox', 'standard', 'tone.cfg'),
  path.join('soundbox', 'standard', 'cfg_tool.bin'),
  // The exact `-key` argument in the confirmed chain. A second .key file also ships in the
  // package but is only ever referenced in a comment — never actually passed to isd_download.exe.
  path.join('soundbox', 'standard', '026AC690X-5309.key'),
  // ufw_maker.exe's `-fw_to_ufw` input.
  path.join('soundbox', 'standard', 'jl_isd.fw'),

  // Declares the target chip/board (CHIP_NAME/PID/SDK_TYPE). Not an explicit CLI argument in
  // either .bat — its exact consumption path (implicit cwd read by isd_download.exe vs.
  // IDE-project-only) has not been traced — but it is present in every confirmed-working
  // package layout seen so far, so its absence is still worth surfacing before a real burn.
  path.join('soundbox', 'standard', 'isd_config.ini'),
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
 *
 * `processTerminationConfirmed` is a SEPARATE fact from `status` — see the field's own doc in
 * shared/types.ts. It answers "is it safe to let a new pen operation start", not "did the
 * upgrade work". Only 'timeout' and 'unparseable' leave it false: 'timeout' means we gave up
 * waiting on the wrapper, so the elevated process's real state is genuinely unknown; 'unparseable'
 * means the outer (unelevated) wrapper's own stdout didn't match any known shape, so even
 * whether it ever reached `Start-Process -Verb RunAs` is unclear. Every other status has
 * positive evidence one way or the other: 'declined'/'launch-error'/'unsupported-platform' mean
 * the elevated process never launched at all, and `elevation.status === 'completed'` means
 * PowerShell's `-Wait` genuinely returned with a real exit code — the process is confirmed gone,
 * whether or not the log shows the success string.
 */
export function determineOutcome(params: { logText: string; elevation: RunElevatedResult }): FirmwareUpgradeOutcome {
  const { logText, elevation } = params;
  const logExcerpt = logText.slice(-MAX_LOG_EXCERPT_CHARS);

  if (elevation.status === 'declined') {
    return { status: 'failed', reason: 'declined', exitCode: null, logExcerpt, processTerminationConfirmed: true };
  }
  if (elevation.status === 'launch-error') {
    return { status: 'failed', reason: 'launch-error', exitCode: null, logExcerpt, processTerminationConfirmed: true };
  }
  if (elevation.status === 'timeout') {
    return { status: 'unclear', reason: 'timeout', exitCode: null, logExcerpt, processTerminationConfirmed: false };
  }
  if (elevation.status === 'unsupported-platform') {
    return { status: 'failed', reason: 'unsupported-platform', exitCode: null, logExcerpt, processTerminationConfirmed: true };
  }
  if (elevation.status === 'unparseable') {
    return { status: 'unclear', reason: 'unparseable-wrapper-output', exitCode: null, logExcerpt, processTerminationConfirmed: false };
  }
  // elevation.status === 'completed' — Start-Process -Wait genuinely returned; the elevated
  // process is confirmed gone either way.
  if (/download success/i.test(logText)) {
    return {
      status: 'success',
      reason: 'log-contains-download-success',
      exitCode: elevation.exitCode,
      logExcerpt,
      processTerminationConfirmed: true,
    };
  }
  return {
    status: 'unclear',
    reason: 'no-recognized-signal',
    exitCode: elevation.exitCode,
    logExcerpt,
    processTerminationConfirmed: true,
  };
}
