import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VERIFY_EDGE_BYTES, safeWriteFile, sha256FileWithProgress, sha256Range, verifyRanges } from '../../src/main/services/transferService';

let sourceDir: string;
let targetDir: string;
let backupDir: string;

beforeEach(() => {
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-source-'));
  targetDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-target-'));
  backupDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-backup-'));
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of [sourceDir, targetDir, backupDir]) fs.rmSync(dir, { recursive: true, force: true });
});

const available = () => true;

/** Returns true for the first `n` calls, then false forever — used to simulate the pen
 *  disconnecting/switching at a specific checkpoint inside safeWriteFile. */
function trueForFirst(n: number) {
  let calls = 0;
  return () => calls++ < n;
}

/** Non-mp3-matching stray files (temp/held) left in a directory, for assertions. */
function strayFiles(dir: string, exclude: string[]) {
  return fs.readdirSync(dir).filter((f) => !exclude.includes(f));
}

describe('safeWriteFile — new file (no existing target)', () => {
  it('writes the content under the exact target filename, with no backup', async () => {
    const source = path.join(sourceDir, 'teacher-recording.mp3');
    fs.writeFileSync(source, 'hello world');

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: '0451.mp3', // preserves the sticker filename, not the source's own name
      backupDir,
      verifyStillSameTarget: available,
    });

    expect(result.ok).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(fs.readFileSync(path.join(targetDir, '0451.mp3'), 'utf-8')).toBe('hello world');
    expect(fs.readdirSync(targetDir)).toEqual(['0451.mp3']); // no leftover temp files
  });
});

describe('safeWriteFile — replacing an existing file', () => {
  it('backs up the original (original filename, original bytes) before writing the new content', async () => {
    fs.writeFileSync(path.join(targetDir, '0451.mp3'), 'OLD AUDIO');
    const source = path.join(sourceDir, 'new-recording.mp3');
    fs.writeFileSync(source, 'NEW AUDIO');

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: '0451.mp3',
      backupDir,
      verifyStillSameTarget: available,
    });

    expect(result.ok).toBe(true);
    expect(result.backupPath).toBe(path.join(backupDir, '0451.mp3'));
    expect(fs.readFileSync(result.backupPath!, 'utf-8')).toBe('OLD AUDIO');
    expect(fs.readFileSync(path.join(targetDir, '0451.mp3'), 'utf-8')).toBe('NEW AUDIO');
  });

  it('fails with reason backup-failed and leaves the original untouched if the backup copy cannot be made', async () => {
    fs.writeFileSync(path.join(targetDir, '0451.mp3'), 'OLD AUDIO');
    const source = path.join(sourceDir, 'new-recording.mp3');
    fs.writeFileSync(source, 'NEW AUDIO');
    // Pre-create the backup destination so the internal COPYFILE_EXCL backup copy fails.
    fs.writeFileSync(path.join(backupDir, '0451.mp3'), 'already here');

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: '0451.mp3',
      backupDir,
      verifyStillSameTarget: available,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('backup-failed');
    expect(fs.readFileSync(path.join(targetDir, '0451.mp3'), 'utf-8')).toBe('OLD AUDIO');
    expect(fs.readdirSync(targetDir)).toEqual(['0451.mp3']); // no stray temp file
  });
});

describe('safeWriteFile — device changed / disconnected, checked at every checkpoint', () => {
  it('checkpoint 1 (before starting): aborts before touching anything, no backup made', async () => {
    fs.writeFileSync(path.join(targetDir, '0451.mp3'), 'OLD AUDIO');
    const source = path.join(sourceDir, 'new.mp3');
    fs.writeFileSync(source, 'NEW AUDIO');

    const result = await safeWriteFile({ sourcePath: source, targetDir, targetFileName: '0451.mp3', backupDir, verifyStillSameTarget: () => false });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('device-changed');
    expect(result.backupPath).toBeUndefined();
    expect(fs.readFileSync(path.join(targetDir, '0451.mp3'), 'utf-8')).toBe('OLD AUDIO');
    expect(fs.readdirSync(backupDir)).toEqual([]);
  });

  it('checkpoint 2 (right after backup, before staging): backup exists but the pen file is never touched', async () => {
    fs.writeFileSync(path.join(targetDir, '0451.mp3'), 'OLD AUDIO');
    const source = path.join(sourceDir, 'new.mp3');
    fs.writeFileSync(source, 'NEW AUDIO');

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: '0451.mp3',
      backupDir,
      verifyStillSameTarget: trueForFirst(1), // true at checkpoint 1, false from checkpoint 2 on
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('device-changed');
    expect(result.backupPath).toBe(path.join(backupDir, '0451.mp3'));
    expect(fs.readFileSync(result.backupPath!, 'utf-8')).toBe('OLD AUDIO'); // backup captured correctly
    expect(fs.readFileSync(path.join(targetDir, '0451.mp3'), 'utf-8')).toBe('OLD AUDIO'); // pen untouched
    expect(strayFiles(targetDir, ['0451.mp3'])).toEqual([]); // nothing staged on the pen
  });

  it('checkpoint 3 (after staging+verifying, before the final swap): original untouched, verified tmp left in place (not deleted)', async () => {
    fs.writeFileSync(path.join(targetDir, '0451.mp3'), 'OLD AUDIO');
    const source = path.join(sourceDir, 'new.mp3');
    fs.writeFileSync(source, 'NEW AUDIO');

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: '0451.mp3',
      backupDir,
      verifyStillSameTarget: trueForFirst(2), // true through backup+staging, false at the pre-swap check
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('device-changed');
    expect(fs.readFileSync(path.join(targetDir, '0451.mp3'), 'utf-8')).toBe('OLD AUDIO'); // original never replaced
    // The verified staged file is deliberately left in place rather than cleaned up on a
    // disk we no longer trust — it never matches the .mp3 filter, so it's harmless.
    const strays = strayFiles(targetDir, ['0451.mp3']);
    expect(strays.length).toBe(1);
    expect(strays[0].endsWith('.mp3')).toBe(false);
  });

  it('a new-file add (no existing target) also aborts cleanly at checkpoint 1 with no reason to treat path/dev alone as proof of identity', async () => {
    const source = path.join(sourceDir, 'new.mp3');
    fs.writeFileSync(source, 'brand new content');

    const result = await safeWriteFile({ sourcePath: source, targetDir, targetFileName: 'new.mp3', backupDir, verifyStillSameTarget: () => false });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('device-changed');
    expect(fs.existsSync(path.join(targetDir, 'new.mp3'))).toBe(false);
  });

  it('fails with reason not-found if the source no longer exists (device unchanged)', async () => {
    const result = await safeWriteFile({
      sourcePath: path.join(sourceDir, 'gone.mp3'),
      targetDir,
      targetFileName: 'gone.mp3',
      backupDir,
      verifyStillSameTarget: available,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-found');
  });
});

describe('safeWriteFile — a failed rename never moves or deletes the original (single attempt, no fallback)', () => {
  it('on a rename failure with the device still confirmed the same, the original is untouched and the temp file is cleaned up', async () => {
    fs.writeFileSync(path.join(targetDir, '0451.mp3'), 'OLD AUDIO');
    const source = path.join(sourceDir, 'new.mp3');
    fs.writeFileSync(source, 'NEW AUDIO');

    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('simulated EIO'), { code: 'EIO' }));

    const result = await safeWriteFile({ sourcePath: source, targetDir, targetFileName: '0451.mp3', backupDir, verifyStillSameTarget: available });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('io-error');
    expect(result.message).toContain('original file was not modified');
    // The original at finalPath is exactly as it was — never moved, renamed, or deleted.
    expect(fs.readFileSync(path.join(targetDir, '0451.mp3'), 'utf-8')).toBe('OLD AUDIO');
    // A proper backup was still made on the computer.
    expect(fs.readFileSync(result.backupPath!, 'utf-8')).toBe('OLD AUDIO');
    // No move-aside/held file of any kind, and our own temp file was cleaned up since the
    // device is still confirmed the same one.
    expect(strayFiles(targetDir, ['0451.mp3'])).toEqual([]);
  });

  it('never creates a move-aside ".ponyabc-original-*" file under any circumstance (the removed fallback is gone for good)', async () => {
    fs.writeFileSync(path.join(targetDir, '0451.mp3'), 'OLD AUDIO');
    const source = path.join(sourceDir, 'new.mp3');
    fs.writeFileSync(source, 'NEW AUDIO');

    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('simulated EIO'), { code: 'EIO' }));

    await safeWriteFile({ sourcePath: source, targetDir, targetFileName: '0451.mp3', backupDir, verifyStillSameTarget: available });

    expect(fs.readdirSync(targetDir).some((f) => f.includes('.ponyabc-original-'))).toBe(false);
  });

  it('when the device becomes untrusted at the exact moment the rename fails, does not touch the temp file and does not claim to know the original is intact', async () => {
    fs.writeFileSync(path.join(targetDir, '0451.mp3'), 'OLD AUDIO');
    const source = path.join(sourceDir, 'new.mp3');
    fs.writeFileSync(source, 'NEW AUDIO');

    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('EIO'), { code: 'EIO' }));

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: '0451.mp3',
      backupDir,
      // Same device through backup+staging+the pre-rename check (3 calls), but no longer
      // trusted by the time we re-check right after the rename itself fails (4th call).
      verifyStillSameTarget: trueForFirst(3),
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('device-changed');
    // Deliberately hedged wording — we must not assert the original is confirmed intact
    // once the device is no longer trusted, even though nothing in this function touched it.
    expect(result.message).toMatch(/could not be confirmed/);
    // The temp file is left exactly where it is — no cleanup attempted on an unconfirmed disk.
    const strays = strayFiles(targetDir, ['0451.mp3']);
    expect(strays.length).toBe(1);
    expect(strays[0]).toContain('.ponyabc-tmp-');
  });

  it('a new-file add (no original at risk) also reports the failure without any recovery attempt', async () => {
    const source = path.join(sourceDir, 'new.mp3');
    fs.writeFileSync(source, 'brand new content');

    vi.spyOn(fs.promises, 'rename').mockRejectedValue(Object.assign(new Error('simulated EIO'), { code: 'EIO' }));

    const result = await safeWriteFile({ sourcePath: source, targetDir, targetFileName: 'new.mp3', backupDir, verifyStillSameTarget: available });

    expect(result.ok).toBe(false);
    expect(result.backupPath).toBeUndefined();
    expect(fs.existsSync(path.join(targetDir, 'new.mp3'))).toBe(false);
    expect(strayFiles(targetDir, [])).toEqual([]); // temp file cleaned up, same-device confirmed
  });
});

describe('sha256FileWithProgress', () => {
  it('computes the same digest as a plain hash, and reports real cumulative bytes-read progress', async () => {
    const crypto = await import('node:crypto');
    const content = 'x'.repeat(500_000); // large enough to span multiple stream chunks
    const filePath = path.join(sourceDir, 'big.axb');
    fs.writeFileSync(filePath, content);
    const expected = crypto.createHash('sha256').update(content).digest('hex');

    const progressCalls: number[] = [];
    const digest = await sha256FileWithProgress(filePath, { onProgress: (n) => progressCalls.push(n) });

    expect(digest).toBe(expected);
    expect(progressCalls.length).toBeGreaterThan(0);
    // Monotonically increasing, and the final call reports the whole file read.
    for (let i = 1; i < progressCalls.length; i++) expect(progressCalls[i]).toBeGreaterThanOrEqual(progressCalls[i - 1]);
    expect(progressCalls[progressCalls.length - 1]).toBe(content.length);
  });

  it('rejects on a nonexistent file rather than hanging', async () => {
    await expect(sha256FileWithProgress(path.join(sourceDir, 'does-not-exist.axb'))).rejects.toThrow();
  });

  it('cancellation via AbortSignal rejects promptly and releases the read (no lingering handle blocking a delete)', async () => {
    const filePath = path.join(sourceDir, 'cancel-me.axb');
    fs.writeFileSync(filePath, 'x'.repeat(2_000_000));
    const controller = new AbortController();
    const promise = sha256FileWithProgress(filePath, {
      signal: controller.signal,
      onProgress: () => controller.abort(),
    });
    await expect(promise).rejects.toThrow();
    // The file itself can still be deleted immediately after — proves the read stream's
    // handle was actually released, not just the promise abandoned. On Windows this is the
    // difference between rejecting after destroy() (handle may still be open -> EPERM) and
    // rejecting on 'close'; it failed there before the promise was made to wait for 'close'.
    expect(() => fs.unlinkSync(filePath)).not.toThrow();
  });

  it('an already-aborted signal rejects immediately without reading anything', async () => {
    const filePath = path.join(sourceDir, 'pre-aborted.axb');
    fs.writeFileSync(filePath, 'hello');
    const controller = new AbortController();
    controller.abort();
    await expect(sha256FileWithProgress(filePath, { signal: controller.signal })).rejects.toThrow();
  });
});


/**
 * Verification after a write to the pen.
 *
 * Reading a whole book back costs as long again as writing it — 978 kB/s measured, so ~19
 * minutes for a 1.1 GB book. Instead the size is checked (free, from a `stat`) and the first and
 * last 8 MB are read back and compared with the same ranges of the source: about sixteen seconds,
 * and it still catches what actually goes wrong on removable media. These tests pin both halves
 * of that claim — that it catches those faults, and that it does not read the whole file.
 */

/**
 * A write stream that damages the data on its way to disk, at an absolute byte offset, so a
 * corrupted write can be simulated without a real failing card.
 */
function corruptAt(offset: number | 'truncate-after', bytes = 0) {
  const realCreateWriteStream = fs.createWriteStream.bind(fs);
  return vi.spyOn(fs, 'createWriteStream').mockImplementation(((target: Parameters<typeof fs.createWriteStream>[0], options?: unknown) => {
    const stream = realCreateWriteStream(target, options as never);
    if (!String(target).includes('.ponyabc-tmp-')) return stream;

    let seen = 0;
    const originalWrite = stream.write.bind(stream);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (stream as any).write = (chunk: Buffer, ...rest: unknown[]) => {
      if (Buffer.isBuffer(chunk)) {
        if (offset === 'truncate-after') {
          const room = Math.max(bytes - seen, 0);
          const kept = chunk.subarray(0, Math.min(room, chunk.length));
          seen += chunk.length;
          if (kept.length === 0) return true; // silently drop the rest — a truncated write
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return originalWrite(kept, ...(rest as [any]));
        }
        if (offset >= seen && offset < seen + chunk.length) {
          const copy = Buffer.from(chunk);
          copy[offset - seen] ^= 0xff;
          seen += chunk.length;
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          return originalWrite(copy, ...(rest as [any]));
        }
      }
      seen += Buffer.isBuffer(chunk) ? chunk.length : 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalWrite(chunk, ...(rest as [any]));
    };
    return stream;
  }) as typeof fs.createWriteStream);
}

/** A file big enough that the two 8 MB ends do not overlap. */
function writeLargeSource(name: string, sizeBytes: number): string {
  const p = path.join(sourceDir, name);
  const chunk = Buffer.alloc(1024 * 1024, 0xab);
  const fd = fs.openSync(p, 'w');
  let written = 0;
  while (written < sizeBytes) {
    const n = Math.min(chunk.length, sizeBytes - written);
    fs.writeSync(fd, chunk, 0, n);
    written += n;
  }
  fs.closeSync(fd);
  return p;
}

describe('which byte ranges get verified', () => {
  it('checks both ends of a large file, and nothing in between', () => {
    const size = 1_100_000_000;
    expect(verifyRanges(size)).toEqual([
      { start: 0, length: VERIFY_EDGE_BYTES },
      { start: size - VERIFY_EDGE_BYTES, length: VERIFY_EDGE_BYTES },
    ]);
    // The point of the whole change: 16 MB read back instead of 1.1 GB.
    const read = verifyRanges(size).reduce((sum, r) => sum + r.length, 0);
    expect(read).toBe(2 * VERIFY_EDGE_BYTES);
    expect(read).toBeLessThan(size / 60);
  });

  it('collapses to the whole file when the ends would overlap', () => {
    for (const size of [0, 1, 1024, VERIFY_EDGE_BYTES, VERIFY_EDGE_BYTES * 2]) {
      expect(verifyRanges(size), String(size)).toEqual([{ start: 0, length: size }]);
    }
  });

  it('hashes exactly the range asked for', async () => {
    const p = path.join(sourceDir, 'ranged.bin');
    fs.writeFileSync(p, 'abcdefghij');
    const whole = await sha256Range(p, 0, 10);
    const head = await sha256Range(p, 0, 3);
    const tail = await sha256Range(p, 7, 3);
    expect(head).not.toBe(whole);
    expect(head).not.toBe(tail);
    // 'abc' and 'hij' hashed independently of the file they came from.
    expect(head).toBe(await sha256Range(p, 0, 3));
  });
});

describe('safeWriteFile — verification catches a bad write', () => {
  it('catches a truncated write from the size alone, and replaces nothing', async () => {
    const source = writeLargeSource('big.axb', 20 * 1024 * 1024);
    fs.writeFileSync(path.join(targetDir, 'big.axb'), 'THE ORIGINAL');
    corruptAt('truncate-after', 4 * 1024 * 1024);

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: 'big.axb',
      backupDir,
      verifyStillSameTarget: available,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('hash-mismatch');
    expect(fs.readFileSync(path.join(targetDir, 'big.axb'), 'utf-8')).toBe('THE ORIGINAL');
    expect(fs.readdirSync(targetDir).filter((f) => f.includes('.ponyabc-tmp-'))).toEqual([]);
  });

  it('catches corruption in the FIRST 8 MB', async () => {
    const source = writeLargeSource('big.axb', 20 * 1024 * 1024);
    fs.writeFileSync(path.join(targetDir, 'big.axb'), 'THE ORIGINAL');
    corruptAt(1024); // well inside the head range

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: 'big.axb',
      backupDir,
      verifyStillSameTarget: available,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('hash-mismatch');
    expect(fs.readFileSync(path.join(targetDir, 'big.axb'), 'utf-8')).toBe('THE ORIGINAL');
  });

  it('catches corruption in the LAST 8 MB', async () => {
    const size = 20 * 1024 * 1024;
    const source = writeLargeSource('big.axb', size);
    corruptAt(size - 1024); // well inside the tail range

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: 'big.axb',
      backupDir,
      verifyStillSameTarget: available,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('hash-mismatch');
    expect(fs.existsSync(path.join(targetDir, 'big.axb'))).toBe(false);
  });

  it('reports the source hash it computed while copying, for a later sync to record', async () => {
    const source = path.join(sourceDir, 'small.axb');
    fs.writeFileSync(source, 'abc');

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: 'small.axb',
      backupDir,
      verifyStillSameTarget: available,
    });

    expect(result.ok).toBe(true);
    // sha256("abc") — computed from the bytes that were actually read and written.
    expect(result.sourceSha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('does not read the middle of a large file back from the pen', async () => {
    const size = 20 * 1024 * 1024;
    const source = writeLargeSource('big.axb', size);

    const readOffsets: Array<{ start?: number; end?: number }> = [];
    const realCreateReadStream = fs.createReadStream.bind(fs);
    vi.spyOn(fs, 'createReadStream').mockImplementation(((target: Parameters<typeof fs.createReadStream>[0], options?: never) => {
      if (String(target).includes('.ponyabc-tmp-')) readOffsets.push({ start: (options as { start?: number })?.start, end: (options as { end?: number })?.end });
      return realCreateReadStream(target, options);
    }) as typeof fs.createReadStream);

    await safeWriteFile({ sourcePath: source, targetDir, targetFileName: 'big.axb', backupDir, verifyStillSameTarget: available });

    // Two ranged reads of the staged file, and no whole-file read. At 978 kB/s this is the
    // difference between 16 seconds and 20 minutes.
    expect(readOffsets).toHaveLength(2);
    expect(readOffsets[0]).toEqual({ start: 0, end: VERIFY_EDGE_BYTES - 1 });
    expect(readOffsets[1]).toEqual({ start: size - VERIFY_EDGE_BYTES, end: size - 1 });
  });
});
