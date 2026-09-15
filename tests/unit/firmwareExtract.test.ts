import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import archiver from 'archiver';
import { afterEach, describe, expect, it } from 'vitest';
import { extractFirmwarePackage } from '../../src/main/services/firmwareExtract';
import { inspectFirmwarePackage } from '../../src/main/services/firmwareUpgrade';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-fwextract-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

/** Mirrors firmwareUpgrade.ts's REQUIRED_RELATIVE_FILES — inspectFirmwarePackage's own tests
 *  catch drift between the two lists (same convention as firmwareIpc.test.ts). */
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

/** Builds a real zip at `zipPath` with each of `entries` (a map of zip-internal path -> file
 *  content) as a real archive member — via `archiver`, not a hand-rolled byte layout. */
async function buildZip(zipPath: string, entries: Record<string, string>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const output = fs.createWriteStream(zipPath);
    const archive = archiver('zip');
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    for (const [entryName, content] of Object.entries(entries)) {
      archive.append(Buffer.from(content), { name: entryName });
    }
    void archive.finalize();
  });
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buf) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Builds a minimal, spec-compliant single-entry ZIP (stored/no compression) BY HAND, writing
 * `entryName` into the file-name field completely unsanitized. Deliberately not using
 * `archiver` for this: `archiver`'s underlying `zip-stream` calls a path-sanitizing helper on
 * every entry name before writing it, which silently strips a `../` traversal attempt — i.e. it
 * cannot actually produce the malicious fixture this test needs. This hand-rolled writer is the
 * only way to get a real zip-slip entry onto disk to prove extractFirmwarePackage() rejects it.
 */
function buildRawZipWithTraversalEntry(zipPath: string, entryName: string, content: string): void {
  const nameBuf = Buffer.from(entryName, 'utf-8');
  const dataBuf = Buffer.from(content, 'utf-8');
  const crc = crc32(dataBuf);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4); // version needed
  localHeader.writeUInt16LE(0, 6); // flags
  localHeader.writeUInt16LE(0, 8); // method: stored
  localHeader.writeUInt16LE(0, 10); // mod time
  localHeader.writeUInt16LE(0, 12); // mod date
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(dataBuf.length, 18); // compressed size
  localHeader.writeUInt32LE(dataBuf.length, 22); // uncompressed size
  localHeader.writeUInt16LE(nameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28); // extra field length

  const localEntry = Buffer.concat([localHeader, nameBuf, dataBuf]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4); // version made by
  centralHeader.writeUInt16LE(20, 6); // version needed
  centralHeader.writeUInt16LE(0, 8); // flags
  centralHeader.writeUInt16LE(0, 10); // method
  centralHeader.writeUInt16LE(0, 12); // mod time
  centralHeader.writeUInt16LE(0, 14); // mod date
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(dataBuf.length, 20);
  centralHeader.writeUInt32LE(dataBuf.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30); // extra length
  centralHeader.writeUInt16LE(0, 32); // comment length
  centralHeader.writeUInt16LE(0, 34); // disk number start
  centralHeader.writeUInt16LE(0, 36); // internal attrs
  centralHeader.writeUInt32LE(0, 38); // external attrs
  centralHeader.writeUInt32LE(0, 42); // relative offset of local header

  const centralEntry = Buffer.concat([centralHeader, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk number
  eocd.writeUInt16LE(0, 6); // disk with central dir
  eocd.writeUInt16LE(1, 8); // entries on this disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(centralEntry.length, 12); // size of central directory
  eocd.writeUInt32LE(localEntry.length, 16); // offset of start of central directory
  eocd.writeUInt16LE(0, 20); // comment length

  fs.writeFileSync(zipPath, Buffer.concat([localEntry, centralEntry, eocd]));
}

describe('extractFirmwarePackage', () => {
  it('extracts a package nested one level under a top-level folder (like tools.zip) and auto-detects packageDir', async () => {
    const workDir = mkTempDir();
    const zipPath = path.join(workDir, 'package.zip');
    const entries: Record<string, string> = {};
    for (const rel of REQUIRED_FILES) {
      entries[path.join('tools', rel).split(path.sep).join('/')] = `fixture:${rel}`;
    }
    await buildZip(zipPath, entries);

    const destDir = path.join(workDir, 'extracted');
    const outcome = await extractFirmwarePackage(zipPath, destDir);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.packageDir).toBe(path.join(destDir, 'tools'));
    expect(inspectFirmwarePackage(outcome.packageDir).looksValid).toBe(true);
  });

  it('extracts a package with the required files directly at the archive root (no nesting)', async () => {
    const workDir = mkTempDir();
    const zipPath = path.join(workDir, 'package.zip');
    const entries: Record<string, string> = {};
    for (const rel of REQUIRED_FILES) {
      entries[rel.split(path.sep).join('/')] = `fixture:${rel}`;
    }
    await buildZip(zipPath, entries);

    const destDir = path.join(workDir, 'extracted');
    const outcome = await extractFirmwarePackage(zipPath, destDir);
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.packageDir).toBe(destDir);
    expect(inspectFirmwarePackage(outcome.packageDir).looksValid).toBe(true);
  });

  it('rejects a zip-slip entry (path escaping the destination directory) and writes nothing outside destDir', async () => {
    const workDir = mkTempDir();
    const zipPath = path.join(workDir, 'evil.zip');
    buildRawZipWithTraversalEntry(zipPath, '../../evil.txt', 'pwned');

    const destDir = path.join(workDir, 'extracted');
    const outcome = await extractFirmwarePackage(zipPath, destDir);
    expect(outcome.ok).toBe(false);

    // Nothing escaped: the sibling location a naive '../../evil.txt' would have targeted must
    // not exist anywhere under workDir's parent.
    const escapedPath = path.join(path.dirname(path.dirname(destDir)), 'evil.txt');
    expect(fs.existsSync(escapedPath)).toBe(false);
  });

  it('returns invalid-package-layout when extraction succeeds but no plausible packageDir is found', async () => {
    const workDir = mkTempDir();
    const zipPath = path.join(workDir, 'incomplete.zip');
    await buildZip(zipPath, { 'download.bat': 'not enough files here' });

    const destDir = path.join(workDir, 'extracted');
    const outcome = await extractFirmwarePackage(zipPath, destDir);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.reason).toBe('invalid-package-layout');
      // missingFiles is surfaced to the UI so the user sees exactly what's absent — assert it's
      // populated (not asserting the exact list, to avoid coupling this test to
      // REQUIRED_RELATIVE_FILES's exact contents) and correctly excludes the one file that
      // actually exists in this fixture.
      expect(outcome.missingFiles).toBeDefined();
      expect(outcome.missingFiles!.length).toBeGreaterThan(0);
      expect(outcome.missingFiles).not.toContain('download.bat');
    }
  });
});
