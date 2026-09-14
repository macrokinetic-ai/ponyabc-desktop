import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { safeWriteFile } from '../../src/main/services/transferService';

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
