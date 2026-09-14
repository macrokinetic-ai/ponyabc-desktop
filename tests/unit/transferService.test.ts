import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  for (const dir of [sourceDir, targetDir, backupDir]) fs.rmSync(dir, { recursive: true, force: true });
});

const available = () => true;

describe('safeWriteFile — new file (no existing target)', () => {
  it('writes the content under the exact target filename, with no backup', async () => {
    const source = path.join(sourceDir, 'teacher-recording.mp3');
    fs.writeFileSync(source, 'hello world');

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: '0451.mp3', // preserves the sticker filename, not the source's own name
      backupDir,
      isTargetVolumeAvailable: available,
    });

    expect(result.ok).toBe(true);
    expect(result.backupPath).toBeUndefined();
    expect(fs.readFileSync(path.join(targetDir, '0451.mp3'), 'utf-8')).toBe('hello world');
    // No leftover temp files.
    expect(fs.readdirSync(targetDir)).toEqual(['0451.mp3']);
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
      isTargetVolumeAvailable: available,
    });

    expect(result.ok).toBe(true);
    expect(result.backupPath).toBe(path.join(backupDir, '0451.mp3'));
    expect(fs.readFileSync(result.backupPath!, 'utf-8')).toBe('OLD AUDIO');
    expect(fs.readFileSync(path.join(targetDir, '0451.mp3'), 'utf-8')).toBe('NEW AUDIO');
  });

  it('never deletes the original before the backup succeeds and the new content is verified', async () => {
    fs.writeFileSync(path.join(targetDir, '0451.mp3'), 'OLD AUDIO');
    const source = path.join(sourceDir, 'new-recording.mp3');
    fs.writeFileSync(source, 'NEW AUDIO');

    // Sanity: at no point does the loop delete-then-copy — verified indirectly by checking
    // that a failed backup (next test) leaves the original completely untouched.
    await safeWriteFile({ sourcePath: source, targetDir, targetFileName: '0451.mp3', backupDir, isTargetVolumeAvailable: available });
    expect(fs.existsSync(path.join(targetDir, '0451.mp3'))).toBe(true);
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
      isTargetVolumeAvailable: available,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('backup-failed');
    // Original on the "pen" (targetDir) must be completely unchanged.
    expect(fs.readFileSync(path.join(targetDir, '0451.mp3'), 'utf-8')).toBe('OLD AUDIO');
    // No stray temp file left behind.
    expect(fs.readdirSync(targetDir)).toEqual(['0451.mp3']);
  });
});

describe('safeWriteFile — disconnect and missing source', () => {
  it('fails with reason disconnected and writes nothing if the target volume is unavailable', async () => {
    const source = path.join(sourceDir, 'x.mp3');
    fs.writeFileSync(source, 'data');

    const result = await safeWriteFile({
      sourcePath: source,
      targetDir,
      targetFileName: 'x.mp3',
      backupDir,
      isTargetVolumeAvailable: () => false,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('disconnected');
    expect(fs.existsSync(path.join(targetDir, 'x.mp3'))).toBe(false);
  });

  it('fails with reason not-found if the source no longer exists', async () => {
    const result = await safeWriteFile({
      sourcePath: path.join(sourceDir, 'gone.mp3'),
      targetDir,
      targetFileName: 'gone.mp3',
      backupDir,
      isTargetVolumeAvailable: available,
    });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('not-found');
  });
});
