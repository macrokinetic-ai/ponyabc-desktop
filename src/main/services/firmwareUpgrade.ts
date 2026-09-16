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
  // script.ver is the one exception to "require the copy's root-level source": the confirmed
  // real tools.zip snapshot has NO root-level script.ver, only soundbox\standard\script.ver
  // (pre-shipped there directly, not merely a leftover). That would make `copy ..\..\script.ver
  // .` fail every time — verified for real, not assumed, via a harmless synthetic-file Windows
  // CI run (.github/workflows/firmware-scriptver-copy-smoke.yml, run
  // https://github.com/macrokinetic-ai/ponyabc-desktop/actions/runs/35014413934, 2026-09-15):
  // reproducing the exact `cd %~dp0` + `copy ..\..\script.ver .` lines against a synthetic
  // root-absent/nested-present skeleton produced the real cmd.exe error "The system cannot find
  // the file specified.", errorlevel 1, a byte-for-byte-unchanged nested script.ver (SHA-256
  // identical before/after), and execution continuing to the next line — i.e. this specific
  // package's pre-shipped nested copy is definitely NOT overwritten or removed by the expected
  // copy failure, and the batch doesn't abort. So the requirement here targets the file's real
  // point of consumption instead of the copy's (absent) source. This is NOT a claim that
  // isd_download.exe/ufw_maker.exe/remove_tailing_zeros.exe actually succeed, or that any real
  // pen flash works — only that THIS specific copy step's failure mode is harmless.
  path.join('soundbox', 'standard', 'script.ver'),
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
 * Recognized completion signals, in the tool's own real output. The original English string
 * (from the vendor's P5点读笔升级方法.pdf) is one confirmed vendor build's marker; a real,
 * user-supplied successful run (2026-09-16, hardware_rev=v1) showed the SAME tool instead
 * printing the Chinese phrase "下载完成" ("download complete") after the write-sector/write-block
 * countdown reached 0 — a different build or locale of the same vendor tool, not a different
 * signal in spirit. Both are treated as success. The Chinese match is ONLY trusted when
 * `encodingKnown` is true (see decodeLogBytes) — matching against mis-decoded/`?`-substituted
 * text would be coincidental, not a real signal, and must never loosen the success rule.
 */
const DOWNLOAD_SUCCESS_EN_RE = /download success/i;
const DOWNLOAD_COMPLETE_ZH_RE = /下[载載]完成/;

/** Diagnostic-only signals extracted from the log — NONE of these determine `status` on their
 *  own; they exist so the caller (and the UI's "technical details") can show what was actually
 *  observed without silently discarding it.
 *  - `otaTableHadFailures`: the "OTA UPDATE INFO" capability/size table lists FAIL for some
 *    delivery methods (e.g. Bluetooth OTA, BLE RCSP) alongside PASS for others (e.g. USB, SD
 *    card, UART) — this table only reports which delivery METHODS fit in the available VM space,
 *    not whether THIS run (over USB) succeeded. A FAIL here is normal and must never be treated
 *    as an overall failure signal.
 *  - `sawUfwGenerated`: "生成UFW文件 ... 成功" appears AFTER the actual flash step, packaging the
 *    result into a .ufw container — this is a post-processing step, not proof the pen itself was
 *    successfully flashed. Never sufficient for 'success' on its own.
 *  - `sawNoLicenseWarning`: the literal (ASCII, encoding-independent) string "no license"
 *    appeared. Its actual meaning/severity in this vendor tool is NOT confirmed — this is
 *    surfaced as a standing diagnostic, never silently dropped, and never treated as fatal
 *    either, purely because its real semantics are unknown.
 */
export interface LogDiagnostics {
  otaTableHadFailures: boolean;
  sawUfwGenerated: boolean;
  sawNoLicenseWarning: boolean;
}

export function extractLogDiagnostics(logText: string, encodingKnown: boolean): LogDiagnostics {
  return {
    otaTableHadFailures: /OTA UPDATE INFO/i.test(logText) && /FAIL/i.test(logText),
    sawUfwGenerated: encodingKnown && /生成.{0,10}UFW.{0,20}成功/.test(logText),
    // Plain ASCII — matches correctly regardless of whether the surrounding Chinese text
    // decoded correctly, so this is NOT gated on encodingKnown.
    sawNoLicenseWarning: /no license/i.test(logText),
  };
}

/**
 * Pure — no filesystem/process access. `status: 'success'` requires one of the two recognized
 * completion signals above (DOWNLOAD_SUCCESS_EN_RE or, when encodingKnown, DOWNLOAD_COMPLETE_ZH_RE)
 * — never a bare exit code, never "OTA UPDATE INFO" table PASS entries, never `sawUfwGenerated`,
 * and never a lenient/fuzzy match against `?`-substituted text. A real exit code of 0 is carried
 * through for diagnostics but is NEVER by itself sufficient: the confirmed chain's own batch
 * scripts never check `errorlevel` after the actual flash step, so a "clean" exit code mostly
 * just reflects trailing housekeeping (a dismissed `pause`, a `del`) succeeding — not that
 * isd_download.exe itself did. Anything that completed without a confirmed signal is 'unclear',
 * never guessed either way.
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
 * whether or not the log shows a success string.
 */
export function determineOutcome(params: {
  logText: string;
  elevation: RunElevatedResult;
  encodingKnown: boolean;
}): FirmwareUpgradeOutcome {
  const { logText, elevation, encodingKnown } = params;
  const logExcerpt = logText.slice(-MAX_LOG_EXCERPT_CHARS);
  const diagnostics = extractLogDiagnostics(logText, encodingKnown);

  if (elevation.status === 'declined') {
    return { status: 'failed', reason: 'declined', exitCode: null, logExcerpt, processTerminationConfirmed: true, encodingKnown, ...diagnostics };
  }
  if (elevation.status === 'launch-error') {
    return { status: 'failed', reason: 'launch-error', exitCode: null, logExcerpt, processTerminationConfirmed: true, encodingKnown, ...diagnostics };
  }
  if (elevation.status === 'timeout') {
    return { status: 'unclear', reason: 'timeout', exitCode: null, logExcerpt, processTerminationConfirmed: false, encodingKnown, ...diagnostics };
  }
  if (elevation.status === 'unsupported-platform') {
    return { status: 'failed', reason: 'unsupported-platform', exitCode: null, logExcerpt, processTerminationConfirmed: true, encodingKnown, ...diagnostics };
  }
  if (elevation.status === 'unparseable') {
    return { status: 'unclear', reason: 'unparseable-wrapper-output', exitCode: null, logExcerpt, processTerminationConfirmed: false, encodingKnown, ...diagnostics };
  }
  // elevation.status === 'completed' — Start-Process -Wait genuinely returned; the elevated
  // process is confirmed gone either way.
  if (DOWNLOAD_SUCCESS_EN_RE.test(logText)) {
    return {
      status: 'success',
      reason: 'log-contains-download-success',
      exitCode: elevation.exitCode,
      logExcerpt,
      processTerminationConfirmed: true,
      encodingKnown,
      ...diagnostics,
    };
  }
  if (encodingKnown && DOWNLOAD_COMPLETE_ZH_RE.test(logText)) {
    return {
      status: 'success',
      reason: 'log-contains-download-complete-zh',
      exitCode: elevation.exitCode,
      logExcerpt,
      processTerminationConfirmed: true,
      encodingKnown,
      ...diagnostics,
    };
  }
  return {
    status: 'unclear',
    reason: 'no-recognized-signal',
    exitCode: elevation.exitCode,
    logExcerpt,
    processTerminationConfirmed: true,
    encodingKnown,
    ...diagnostics,
  };
}
