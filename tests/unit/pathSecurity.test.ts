import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  isEligibleAxbFileName,
  isEligibleMp3FileName,
  resolveDestination,
  resolveDiySourceFile,
  resolvePenRoot,
  resolvePenRootFromSelection,
} from '../../src/main/services/pathSecurity';

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-root-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function mkBookDiy(bookName = 'BOOK', diyName = 'DIY') {
  fs.mkdirSync(path.join(root, bookName));
  fs.mkdirSync(path.join(root, diyName));
}

describe('resolvePenRoot', () => {
  it('accepts exact-case BOOK/DIY', () => {
    mkBookDiy();
    const result = resolvePenRoot(root);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.bookDirName).toBe('BOOK');
      expect(result.diyDirName).toBe('DIY');
    }
  });

  it('accepts case-insensitive folder names and reports the actual on-disk casing', () => {
    mkBookDiy('book', 'Diy');
    const result = resolvePenRoot(root);
    expect(result.status).toBe('ok');
    if (result.status === 'ok') {
      expect(result.bookDirName).toBe('book');
      expect(result.diyDirName).toBe('Diy');
    }
  });

  it('reports DIY missing when only BOOK exists', () => {
    fs.mkdirSync(path.join(root, 'BOOK'));
    const result = resolvePenRoot(root);
    expect(result).toEqual({ status: 'invalid', path: fs.realpathSync(root), missing: ['DIY'] });
  });

  it('reports both missing when neither exists', () => {
    const result = resolvePenRoot(root);
    expect(result).toEqual({ status: 'invalid', path: fs.realpathSync(root), missing: ['BOOK', 'DIY'] });
  });

  it('reports not-found for a nonexistent root, without throwing', () => {
    const result = resolvePenRoot(path.join(root, 'does-not-exist'));
    expect(result.status).toBe('not-found');
  });

  it('rejects a DIY that is a symlink escaping outside the selected root', () => {
    fs.mkdirSync(path.join(root, 'BOOK'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-outside-'));
    fs.symlinkSync(outside, path.join(root, 'DIY'));

    const result = resolvePenRoot(root);
    expect(result.status).toBe('invalid');
    if (result.status === 'invalid') expect(result.missing).toContain('DIY');

    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe('resolveDestination', () => {
  it('rejects the pen root itself as a destination', () => {
    const penRootReal = fs.realpathSync(root);
    const result = resolveDestination(root, penRootReal);
    expect(result).toEqual({ status: 'on-pen', path: penRootReal });
  });

  it('rejects a subfolder of the pen root as a destination', () => {
    const sub = path.join(root, 'DIY');
    fs.mkdirSync(sub);
    const penRootReal = fs.realpathSync(root);
    const result = resolveDestination(sub, penRootReal);
    expect(result.status).toBe('on-pen');
  });

  it('accepts a directory outside the pen root', () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-dest-'));
    const result = resolveDestination(other, fs.realpathSync(root));
    expect(result).toEqual({ status: 'ok', realPath: fs.realpathSync(other) });
    fs.rmSync(other, { recursive: true, force: true });
  });

  it('reports not-found for a nonexistent path', () => {
    const result = resolveDestination(path.join(root, 'nope'), null);
    expect(result.status).toBe('not-found');
  });

  it('reports not-a-directory for a file path', () => {
    const filePath = path.join(root, 'file.txt');
    fs.writeFileSync(filePath, 'x');
    const result = resolveDestination(filePath, null);
    expect(result.status).toBe('not-a-directory');
  });
});

describe('resolveDiySourceFile', () => {
  it('resolves a plain file directly inside the DIY folder', () => {
    const diyDir = path.join(root, 'DIY');
    fs.mkdirSync(diyDir);
    fs.writeFileSync(path.join(diyDir, '0001.mp3'), 'x');
    const result = resolveDiySourceFile(fs.realpathSync(diyDir), '0001.mp3');
    expect(result).toEqual({ status: 'ok', realPath: fs.realpathSync(path.join(diyDir, '0001.mp3')) });
  });

  it('rejects a traversal attempt disguised as a filename', () => {
    const diyDir = path.join(root, 'DIY');
    fs.mkdirSync(diyDir);
    const result = resolveDiySourceFile(fs.realpathSync(diyDir), '../BOOK/secret.txt');
    expect(result.status).toBe('rejected');
  });

  it('rejects a symlinked file that escapes the DIY folder', () => {
    const diyDir = path.join(root, 'DIY');
    fs.mkdirSync(diyDir);
    const outsideFile = path.join(root, 'outside.mp3');
    fs.writeFileSync(outsideFile, 'secret');
    fs.symlinkSync(outsideFile, path.join(diyDir, 'looks-safe.mp3'));

    const result = resolveDiySourceFile(fs.realpathSync(diyDir), 'looks-safe.mp3');
    expect(result.status).toBe('rejected');
  });

  it('reports not-found for a nonexistent file', () => {
    const diyDir = path.join(root, 'DIY');
    fs.mkdirSync(diyDir);
    const result = resolveDiySourceFile(fs.realpathSync(diyDir), '9999.mp3');
    expect(result.status).toBe('not-found');
  });

  it('resolves an alphanumeric sticker-style filename unchanged', () => {
    const diyDir = path.join(root, 'DIY');
    fs.mkdirSync(diyDir);
    fs.writeFileSync(path.join(diyDir, 'ENG042abc.mp3'), 'x');
    const result = resolveDiySourceFile(fs.realpathSync(diyDir), 'ENG042abc.mp3');
    expect(result.status).toBe('ok');
  });
});

describe('resolvePenRootFromSelection', () => {
  it('resolves the root directly when that is what was selected', () => {
    mkBookDiy();
    const result = resolvePenRootFromSelection(root);
    expect(result.status).toBe('ok');
  });

  it('falls back to the parent when the user selected the DIY folder itself', () => {
    mkBookDiy();
    const result = resolvePenRootFromSelection(path.join(root, 'DIY'));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.realPath).toBe(fs.realpathSync(root));
  });

  it('falls back to the parent when the user selected the BOOK folder itself (case-insensitive)', () => {
    mkBookDiy('book', 'DIY');
    const result = resolvePenRootFromSelection(path.join(root, 'book'));
    expect(result.status).toBe('ok');
    if (result.status === 'ok') expect(result.realPath).toBe(fs.realpathSync(root));
  });

  it('still reports invalid when the parent of a selected DIY folder is not a real pen root', () => {
    fs.mkdirSync(path.join(root, 'DIY')); // no BOOK alongside it
    const result = resolvePenRootFromSelection(path.join(root, 'DIY'));
    expect(result.status).toBe('invalid');
  });
});

describe('isEligibleMp3FileName', () => {
  it('accepts plain .mp3 names, any case', () => {
    expect(isEligibleMp3FileName('0451.mp3')).toBe(true);
    expect(isEligibleMp3FileName('0451.MP3')).toBe(true);
    expect(isEligibleMp3FileName('EnglishStory42.Mp3')).toBe(true);
  });

  it('rejects macOS AppleDouble sidecar files even though they end in .mp3', () => {
    expect(isEligibleMp3FileName('._0451.mp3')).toBe(false);
  });

  it('rejects non-mp3 files', () => {
    expect(isEligibleMp3FileName('.DS_Store')).toBe(false);
    expect(isEligibleMp3FileName('readme.txt')).toBe(false);
    expect(isEligibleMp3FileName('0451.wav')).toBe(false);
  });
});

describe('isEligibleAxbFileName', () => {
  it('accepts plain .axb names, any case', () => {
    expect(isEligibleAxbFileName('0451.axb')).toBe(true);
    expect(isEligibleAxbFileName('0451.AXB')).toBe(true);
  });

  it('rejects macOS AppleDouble sidecar files even though they end in .axb', () => {
    expect(isEligibleAxbFileName('._0451.axb')).toBe(false);
  });

  it('rejects non-axb files', () => {
    expect(isEligibleAxbFileName('.DS_Store')).toBe(false);
    expect(isEligibleAxbFileName('0451.mp3')).toBe(false);
  });
});
