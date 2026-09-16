import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { determineOutcome, inspectFirmwarePackage } from '../../src/main/services/firmwareUpgrade';
import type { RunElevatedResult } from '../../src/main/services/elevatedRun';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-fw-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

// Every file firmwareUpgrade.ts's REQUIRED_RELATIVE_FILES currently lists — kept in sync by
// hand; a drift here would show up as the "looksValid=true" test below failing.
const REQUIRED_FILES = [
  'download.bat',
  path.join('soundbox', 'standard', 'download.bat'),
  'isd_download.exe',
  'ufw_maker.exe',
  'remove_tailing_zeros.exe',
  'uboot.boot',
  'ota.bin',
  path.join('soundbox', 'standard', 'script.ver'),
  path.join('soundbox', 'standard', 'app.bin'),
  path.join('soundbox', 'standard', 'br25loader.bin'),
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
  path.join('soundbox', 'standard', 'tone.cfg'),
  path.join('soundbox', 'standard', 'cfg_tool.bin'),
  path.join('soundbox', 'standard', '026AC690X-5309.key'),
  path.join('soundbox', 'standard', 'jl_isd.fw'),
  path.join('soundbox', 'standard', 'isd_config.ini'),
];

function writeFullPackage(dir: string): void {
  for (const rel of REQUIRED_FILES) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, '');
  }
}

describe('inspectFirmwarePackage — real filesystem, never inferred from folder name or mtime', () => {
  it('looksValid=true only once every real dependency of the confirmed chain is present', () => {
    const dir = mkTempDir();
    writeFullPackage(dir);
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(true);
    expect(info.missingFiles).toEqual([]);
    expect(info.entryBatPath).toBe(path.join(dir, 'download.bat'));
  });

  it('reports exactly which files are missing, never a bare pass/fail', () => {
    const dir = mkTempDir();
    writeFullPackage(dir);
    fs.rmSync(path.join(dir, 'isd_download.exe'));
    fs.rmSync(path.join(dir, 'soundbox', 'standard', 'app.bin'));
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(false);
    expect(info.missingFiles).toContain('isd_download.exe');
    expect(info.missingFiles).toContain(path.join('soundbox', 'standard', 'app.bin'));
  });

  it('an empty/unrelated folder is never valid, regardless of its name', () => {
    const dir = mkTempDir();
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(false);
    expect(info.missingFiles.length).toBeGreaterThan(0);
  });

  // 2026-09-15: the required-file list was corrected to actually trace the root download.bat →
  // soundbox\standard\download.bat call chain (concatenation sources, the processing tool that
  // is NOT toolchain-gated, the config, and the exact -key argument) instead of a smaller list
  // that happened to be enough for looksValid but missed real inputs. One targeted test per
  // category the user asked to be covered.
  it('a missing copy /b concatenation source (e.g. aec.bin) is flagged, not silently ignored', () => {
    const dir = mkTempDir();
    writeFullPackage(dir);
    fs.rmSync(path.join(dir, 'aec.bin'));
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(false);
    expect(info.missingFiles).toContain('aec.bin');
  });

  it('a missing processing tool (remove_tailing_zeros.exe — NOT toolchain-gated, unlike objcopy) is flagged', () => {
    const dir = mkTempDir();
    writeFullPackage(dir);
    fs.rmSync(path.join(dir, 'remove_tailing_zeros.exe'));
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(false);
    expect(info.missingFiles).toContain('remove_tailing_zeros.exe');
  });

  it('a missing chip/board config (isd_config.ini) is flagged', () => {
    const dir = mkTempDir();
    writeFullPackage(dir);
    fs.rmSync(path.join(dir, 'soundbox', 'standard', 'isd_config.ini'));
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(false);
    expect(info.missingFiles).toContain(path.join('soundbox', 'standard', 'isd_config.ini'));
  });

  it('a missing key file (the exact -key argument the confirmed chain passes) is flagged', () => {
    const dir = mkTempDir();
    writeFullPackage(dir);
    fs.rmSync(path.join(dir, 'soundbox', 'standard', '026AC690X-5309.key'));
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(false);
    expect(info.missingFiles).toContain(path.join('soundbox', 'standard', '026AC690X-5309.key'));
  });

  it('bank.bin is deliberately NOT required — it does not exist in the confirmed package and the chain runs without it', () => {
    const dir = mkTempDir();
    writeFullPackage(dir);
    const info = inspectFirmwarePackage(dir);
    expect(info.missingFiles).not.toContain('bank.bin');
  });

  // 2026-09-15: corrected from requiring root-level script.ver to requiring
  // soundbox/standard/script.ver (the real point of consumption), backed by a real Windows CI
  // run (.github/workflows/firmware-scriptver-copy-smoke.yml) proving the nested copy survives
  // the expected `copy ..\..\script.ver .` failure byte-for-byte and the batch continues past
  // it — not by assuming a same-location file is an equivalent substitute. See the doc comment
  // on REQUIRED_RELATIVE_FILES for the full evidence. This does NOT verify the actual flashing
  // tools or a real device — only that this specific package layout (root script.ver absent,
  // nested copy present) is not incorrectly flagged invalid.
  it('root-level script.ver absent, nested soundbox/standard/script.ver present — still looksValid (verified real-CI substitute)', () => {
    const dir = mkTempDir();
    writeFullPackage(dir); // writeFullPackage only ever writes the nested path — root never existed
    expect(fs.existsSync(path.join(dir, 'script.ver'))).toBe(false);
    expect(fs.existsSync(path.join(dir, 'soundbox', 'standard', 'script.ver'))).toBe(true);
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(true);
    expect(info.missingFiles).toEqual([]);
  });

  it('script.ver missing from BOTH root and its real consumption point is still flagged, at the real path', () => {
    const dir = mkTempDir();
    writeFullPackage(dir);
    fs.rmSync(path.join(dir, 'soundbox', 'standard', 'script.ver'));
    const info = inspectFirmwarePackage(dir);
    expect(info.looksValid).toBe(false);
    expect(info.missingFiles).toContain(path.join('soundbox', 'standard', 'script.ver'));
    expect(info.missingFiles).not.toContain('script.ver');
  });
});

describe('determineOutcome — pure, no I/O', () => {
  it('"success" ONLY when the log literally contains the confirmed vendor signal, case-insensitively', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    expect(determineOutcome({ logText: 'blah\nDownload Success\nblah', elevation, encodingKnown: true })).toMatchObject({
      status: 'success',
      reason: 'log-contains-download-success',
      exitCode: 0,
      processTerminationConfirmed: true,
    });
    expect(determineOutcome({ logText: 'DOWNLOAD SUCCESS', elevation, encodingKnown: true })).toMatchObject({ status: 'success' });
  });

  it('a completed run with exit code 0 but WITHOUT the confirmed signal is "unclear", never guessed as success — the confirmed batch chain never checks errorlevel after the real flash step, so a clean exit code alone proves nothing. Termination IS confirmed here: Start-Process -Wait genuinely returned.', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    const result = determineOutcome({ logText: 'some unrelated output, no signal here', elevation });
    expect(result.status).toBe('unclear');
    expect(result.reason).toBe('no-recognized-signal');
    expect(result.exitCode).toBe(0);
    expect(result.processTerminationConfirmed).toBe(true);
  });

  it('a completed run with a non-zero exit code but no recognized signal is still "unclear", not "failed" — no vendor-confirmed failure signal exists yet', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 1 };
    const result = determineOutcome({ logText: 'no signal', elevation, encodingKnown: true });
    expect(result.status).toBe('unclear');
    expect(result.exitCode).toBe(1);
    expect(result.processTerminationConfirmed).toBe(true);
  });

  it('a declined UAC prompt is "failed", distinctly reasoned, never silently retried or hidden — nothing ever launched, so termination is confirmed', () => {
    const elevation: RunElevatedResult = { status: 'declined' };
    expect(determineOutcome({ logText: '', elevation, encodingKnown: true })).toMatchObject({
      status: 'failed',
      reason: 'declined',
      exitCode: null,
      processTerminationConfirmed: true,
    });
  });

  it('a launch error (before the tool ever ran) is "failed", termination confirmed', () => {
    const elevation: RunElevatedResult = { status: 'launch-error', message: 'nope' };
    expect(determineOutcome({ logText: '', elevation, encodingKnown: true })).toMatchObject({
      status: 'failed',
      reason: 'launch-error',
      processTerminationConfirmed: true,
    });
  });

  it('a timeout is "unclear", never "failed" — the real process may still be running unobserved, so termination is NOT confirmed', () => {
    const elevation: RunElevatedResult = { status: 'timeout' };
    expect(determineOutcome({ logText: 'partial output so far', elevation, encodingKnown: true })).toMatchObject({
      status: 'unclear',
      reason: 'timeout',
      processTerminationConfirmed: false,
    });
  });

  it('unparseable wrapper output is "unclear", termination NOT confirmed — even whether the elevated launch was ever attempted is unclear', () => {
    const elevation: RunElevatedResult = { status: 'unparseable', raw: 'garbage' };
    expect(determineOutcome({ logText: '', elevation, encodingKnown: true })).toMatchObject({
      status: 'unclear',
      reason: 'unparseable-wrapper-output',
      processTerminationConfirmed: false,
    });
  });

  it('the log excerpt is capped to a tail, never the entire (potentially huge) log', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    const bigLog = 'x'.repeat(10_000) + 'download success';
    const result = determineOutcome({ logText: bigLog, elevation, encodingKnown: true });
    expect(result.logExcerpt.length).toBeLessThan(bigLog.length);
    expect(result.logExcerpt).toContain('download success');
  });

  // 2026-09-16: a real user-supplied successful P5 update (hardware_rev=v1, tested working
  // afterward) showed this exact tool NOT printing the English "download success" string at
  // all — it printed the Chinese "下载完成。" ("download complete") instead, after a write-
  // sector/write-block countdown to 0. The app previously only recognized the English string,
  // so this real run showed "no-recognized-signal" despite having actually completed —
  // NOT evidence of failure, just an incomplete signal list. See tasks/lessons.md.
  it('recognizes the Chinese "下载完成"/"下載完成" completion signal (both simplified and traditional) — ONLY when encodingKnown is true', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    expect(determineOutcome({ logText: 'Write block:0 .\nno license\n下载完成。\n生成UFW文件 jl_isd.ufw 成功', elevation, encodingKnown: true })).toMatchObject({
      status: 'success',
      reason: 'log-contains-download-complete-zh',
    });
    expect(determineOutcome({ logText: '下載完成。', elevation, encodingKnown: true })).toMatchObject({ status: 'success' });
  });

  it('does NOT match the Chinese completion signal when encodingKnown is false, even if the (mis-decoded/latin1-fallback) text happens to contain it — never trust a signal match against text we can\'t confirm is correctly decoded', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    // Same real characters, but encodingKnown: false (as if the codepage could not be
    // determined) — must NOT be treated as a real signal.
    const result = determineOutcome({ logText: '下载完成。', elevation, encodingKnown: false });
    expect(result.status).toBe('unclear');
    expect(result.reason).toBe('no-recognized-signal');
  });

  it('never matches a "?"-substituted garbled rendering of the completion phrase as a fuzzy/loosened success signal, even with encodingKnown true — the exact real characters are required, not a lenient pattern', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    // This is what a console-codepage-mismatched DISPLAY of "下载完成。" can look like — literal
    // question marks, not the real characters. Must never be treated as a success signal.
    const result = determineOutcome({ logText: '下?完?。', elevation, encodingKnown: true });
    expect(result.status).toBe('unclear');
  });

  it('an "OTA UPDATE INFO" table listing FAIL for some delivery methods (Bluetooth/BLE) alongside PASS for others (USB/SD/UART) does NOT cause an overall failure — it is purely informational about which delivery methods fit, not whether this run succeeded', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    const logWithOtaFailures = [
      '--------------------------- OTA UPDATE INFO ---------------------------',
      '| !!!!!! FAIL:  BT upgrade needs more space',
      '|        PASS:    serial upgrade',
      '| !!!!!! FAIL:   BLE upgrade needs more space',
      '|        PASS:      SD card upgrade',
      '|        PASS:      USB upgrade',
      '-----------------------------------------------------------------------',
      '下载完成。',
    ].join('\n');
    const result = determineOutcome({ logText: logWithOtaFailures, elevation, encodingKnown: true });
    expect(result.status).toBe('success'); // the FAIL entries above must not block this
    expect(result.otaTableHadFailures).toBe(true); // but still surfaced as a diagnostic, not silently dropped
  });

  it('"生成UFW文件...成功" (UFW file generated) alone, without any completion signal, does NOT count as success — it is a post-flash packaging step, not proof the pen was flashed', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    const result = determineOutcome({
      logText: 'Write block:0 .\nno license\n生成UFW文件 jl_isd.ufw 成功',
      elevation,
      encodingKnown: true,
    });
    expect(result.status).toBe('unclear');
    expect(result.reason).toBe('no-recognized-signal');
    expect(result.sawUfwGenerated).toBe(true); // observed and surfaced, just not authoritative
  });

  it('"Write block:0" (write progress reaching 0) alone, with no completion signal, does NOT count as success', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    const result = determineOutcome({ logText: 'Write sector:2 .1 .0 .\nWrite block:0 .', elevation, encodingKnown: true });
    expect(result.status).toBe('unclear');
  });

  it('surfaces "no license" as a standing diagnostic (encoding-independent — plain ASCII) without ever treating it as fatal or as a success/failure signal by itself', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    const successWithLicenseMsg = determineOutcome({ logText: 'no license\n下载完成。', elevation, encodingKnown: true });
    expect(successWithLicenseMsg.status).toBe('success');
    expect(successWithLicenseMsg.sawNoLicenseWarning).toBe(true);

    const unclearWithLicenseMsg = determineOutcome({ logText: 'no license\nWrite block:0 .', elevation, encodingKnown: true });
    expect(unclearWithLicenseMsg.status).toBe('unclear'); // presence of "no license" does not itself imply failure
    expect(unclearWithLicenseMsg.sawNoLicenseWarning).toBe(true); // but is never silently dropped either
  });

  it('missing completion signal entirely (process confirmed terminated, nothing recognized) is "unclear", never "failed" — matches the honest "tool finished, please confirm by restarting the pen and testing playback" state, not a claim of failure', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    const result = determineOutcome({ logText: 'ISDdownload\nWrite block:0 .\nno license', elevation, encodingKnown: true });
    expect(result.status).toBe('unclear');
    expect(result.reason).toBe('no-recognized-signal');
    expect(result.processTerminationConfirmed).toBe(true); // the process really did finish — just no confirmed outcome signal
  });

  // A real user-supplied log, redacted of personal file paths / device-specific identifiers
  // (original username, folder path, flash chip UUID) per the user's explicit instruction — the
  // vendor tool's own console output structure and text are preserved verbatim. Confirms the
  // full, real end-to-end shape (OTA table with FAILs, FLASH INFO block, ISDdownload write
  // countdown, "no license", the Chinese completion signal, then UFW generation) produces
  // 'success' via the Chinese signal, with both diagnostics correctly surfaced.
  const REAL_USER_LOG_REDACTED = [
    'SPI nor flash online.',
    'Online flash id: [REDACTED]',
    'Online flash size: 512K',
    'Online flash uuid: [REDACTED]',
    'Erase Falsh Size is 4096',
    'ota.bin: [REDACTED_PATH]/soundbox/standard/ota.bin',
    '--------------------------- OTA UPDATE INFO ---------------------------',
    '| VM大小 = 0x8000',
    '| !!!!!! FAIL:  蓝牙耳机升级（大小=0x8084）需要最小空间 0x9000',
    '|        PASS:    蓝牙串口升级（大小=0x3e34）需要最小空间 0x0',
    '| !!!!!! FAIL:   蓝牙BLE升级（大小=0x9aa9）需要最小空间 0xa000',
    '|        PASS:      SD卡升级（大小=0x4a96）需要最小空间 0x5000',
    '|        PASS:      USB升级（大小=0x4b00）需要最小空间 0x5000',
    '| !!!!!! FAIL: BLE RCSP升级（大小=0xdab9）需要最小空间 0xe000',
    '|        PASS:   用户UART升级（大小=0x3989）需要最小空间 0x4000',
    '| 此VM空间支持升级方式有：',
    '| * 蓝牙串口升级',
    '| * SD卡升级',
    '| * USB升级',
    '| * 用户UART升级',
    '-----------------------------------------------------------------------',
    '--------------------FLASH INFO--------------------',
    '|  PID : AC696x_TWS                              |',
    '|  VID : 0.01                                    |',
    '--------------------------------------------------',
    'ISDdownload',
    '开始下载……',
    'Write block:0 .',
    'no license',
    '下载完成。',
    '生成UFW文件 jl_isd.ufw 成功',
    '複製了         1 個檔案。',
    '請按任意鍵繼續 . . .',
  ].join('\n');

  it('the real (redacted) user log: OTA-table FAILs and UFW generation do not block success; the Chinese completion signal and "no license" are both correctly recognized', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    const result = determineOutcome({ logText: REAL_USER_LOG_REDACTED, elevation, encodingKnown: true });
    expect(result.status).toBe('success');
    expect(result.reason).toBe('log-contains-download-complete-zh');
    expect(result.otaTableHadFailures).toBe(true);
    expect(result.sawUfwGenerated).toBe(true);
    expect(result.sawNoLicenseWarning).toBe(true);
  });

  it('the same real (redacted) user log with encodingKnown false (codepage never determined) does NOT claim success — the raw/fallback text must not be trusted for the Chinese signal', () => {
    const elevation: RunElevatedResult = { status: 'completed', exitCode: 0 };
    const result = determineOutcome({ logText: REAL_USER_LOG_REDACTED, elevation, encodingKnown: false });
    expect(result.status).toBe('unclear');
    expect(result.sawUfwGenerated).toBe(false); // gated on encodingKnown, unlike sawNoLicenseWarning
    expect(result.sawNoLicenseWarning).toBe(true); // plain ASCII — still correctly detected regardless
  });
});
