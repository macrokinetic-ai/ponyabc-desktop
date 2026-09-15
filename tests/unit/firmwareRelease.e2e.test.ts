import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';
import archiver from 'archiver';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareOfficialFirmwarePackage } from '../../src/main/services/firmwareRelease';
import { inspectFirmwarePackage } from '../../src/main/services/firmwareUpgrade';
import type { FirmwareReleaseInfo } from '../../src/shared/types';

// The real first-draft firmware package (JieLi/AC696x "BR25" vendor kit) uploaded per the plan's
// §8 — lives in the sibling ponyabc-web repo's working tree, never committed into this repo.
// Not present in every environment this test suite might run in, so tests using it skip (not
// fail) when the fixture is unavailable, rather than making the whole suite depend on a sibling
// repo's untracked file.
const REAL_ZIP_PATH = path.resolve(__dirname, '../../../ponyabc-web/tools.zip');

function sha256File(p: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(p);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function baseRelease(overrides: Partial<FirmwareReleaseInfo>): FirmwareReleaseInfo {
  return {
    id: 'e2e-1',
    version: 'AC6966-V1.18',
    hardwareRev: 'PENDING-HWREV',
    notes: 'End-to-end simulation fixture — never a real published release.',
    sizeBytes: 0,
    sha256: null,
    minAppVersion: null,
    releasedAt: '2026-09-15T00:00:00.000Z',
    packageLabel: 'AC6966-V1.18 20260316',
    packageDate: '2026-03-16',
    recommended: false,
    downloadUrl: '/api/public/firmware/download?id=e2e-1',
    ...overrides,
  };
}

/** Simulates the real HTTP round trip (fetchFn is the only thing mocked — the real
 *  downloadFile()/extractFirmwarePackage() code runs completely unmodified) by handing back a
 *  fresh read stream of a real local file on every call. */
function fetchFnForFile(filePath: string): typeof fetch {
  return (async () => {
    const webStream = Readable.toWeb(fs.createReadStream(filePath)) as unknown as ReadableStream<Uint8Array>;
    return new Response(webStream, { status: 200 });
  }) as unknown as typeof fetch;
}

// Mirrors firmwareUpgrade.ts's REQUIRED_RELATIVE_FILES (see firmwareExtract.test.ts and
// firmwareIpc.test.ts for the same convention) — a fully complete package, guaranteed to pass
// inspectFirmwarePackage().looksValid, used to prove the orchestrator's success path end to end.
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

async function buildCompletePackageZip(zipPath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip');
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    for (const rel of REQUIRED_FILES) {
      // Nested one level under "tools/" — the exact layout tools.zip itself uses — so this also
      // exercises extractFirmwarePackage's single-subdirectory auto-detection, not just the
      // no-nesting case.
      archive.append(Buffer.from(`fixture:${rel}`), { name: path.join('tools', rel).split(path.sep).join('/') });
    }
    void archive.finalize();
  });
}

describe('prepareOfficialFirmwarePackage — end-to-end simulation, never touches startFirmwareUpgrade/runElevated/download.bat', () => {
  it('a complete package (synthetic, tools.zip-shaped): download -> verify -> extract -> a packageDir that passes inspectFirmwarePackage()', async () => {
    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-fw-e2e-synthetic-'));
    tempDirs.push(workDir);
    const zipPath = path.join(workDir, 'source.zip');
    await buildCompletePackageZip(zipPath);

    const sizeBytes = fs.statSync(zipPath).size;
    const sha256 = await sha256File(zipPath);
    const release = baseRelease({ sizeBytes, sha256 });

    const downloadsRootDir = path.join(workDir, 'downloads');
    const progressPhases: string[] = [];
    const result = await prepareOfficialFirmwarePackage({
      release,
      downloadsRootDir,
      signal: new AbortController().signal,
      onProgress: (e) => progressPhases.push(e.phase),
      fetchFn: fetchFnForFile(zipPath),
    });

    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;

    const inspected = inspectFirmwarePackage(result.packageDir);
    expect(inspected.looksValid).toBe(true);
    expect(inspected.missingFiles).toEqual([]);
    expect(progressPhases).toContain('downloading');
    expect(progressPhases).toContain('extracting');
    expect(progressPhases).toContain('done');

    // Stop here. Never call startFirmwareUpgrade/runElevated or invoke download.bat/any vendor
    // exe in this or any other test — that would touch a real elevated process.
  });

  it(
    'the real tools.zip bytes (JieLi/AC696x "BR25" vendor kit) run through the same real pipeline — documents the fixture\'s current, honest state rather than assuming it',
    async () => {
      if (!fs.existsSync(REAL_ZIP_PATH)) {
        // eslint-disable-next-line no-console
        console.warn(`[firmwareRelease.e2e.test] skipping — fixture not found at ${REAL_ZIP_PATH}`);
        return;
      }

      const sizeBytes = fs.statSync(REAL_ZIP_PATH).size;
      const sha256 = await sha256File(REAL_ZIP_PATH);
      const release = baseRelease({ sizeBytes, sha256 });

      const downloadsRootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-fw-e2e-real-'));
      tempDirs.push(downloadsRootDir);

      const progressPhases: string[] = [];
      const result = await prepareOfficialFirmwarePackage({
        release,
        downloadsRootDir,
        signal: new AbortController().signal,
        onProgress: (e) => progressPhases.push(e.phase),
        fetchFn: fetchFnForFile(REAL_ZIP_PATH),
      });

      // Download + verify (real streaming, real SHA-256 over the full ~49MB file) succeed —
      // proven by reaching the extract phase at all instead of 'no-network'/'verify-failed'.
      expect(progressPhases).toContain('downloading');
      expect(progressPhases).toContain('extracting');

      // 2026-09-15: firmwareUpgrade.ts's REQUIRED_RELATIVE_FILES was corrected (with real
      // Windows CI evidence, not assumption — see its doc comment and
      // .github/workflows/firmware-scriptver-copy-smoke.yml) to require script.ver at its real
      // consumption point, soundbox/standard/script.ver, instead of the copy step's absent
      // root-level source. The real tools.zip snapshot HAS the file there, so this now
      // genuinely passes — not a re-upload of the zip, a corrected understanding of where the
      // confirmed chain actually needs it. Fail loudly (not silently branch-and-accept) if this
      // ever regresses, since 'ok' is now the expected, evidenced outcome.
      expect(result.status).toBe('ok');
      if (result.status !== 'ok') return;
      const inspected = inspectFirmwarePackage(result.packageDir);
      expect(inspected.looksValid).toBe(true);
      expect(inspected.missingFiles).toEqual([]);
    },
    120_000,
  );
});
