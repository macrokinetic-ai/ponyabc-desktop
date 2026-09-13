import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { copyFiles, resolveCollisionFreeName, type CopyFileTask } from '../../src/main/services/copyService';

let srcDir: string;
let destDir: string;

beforeEach(() => {
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-src-'));
  destDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-dest-'));
});

afterEach(() => {
  fs.rmSync(srcDir, { recursive: true, force: true });
  fs.rmSync(destDir, { recursive: true, force: true });
});

function writeSrcFile(name: string, content: string): string {
  const p = path.join(srcDir, name);
  fs.writeFileSync(p, content);
  return p;
}

describe('copyFiles — normal copy', () => {
  it('copies multiple files and leaves originals untouched', async () => {
    const p1 = writeSrcFile('0001.mp3', 'aaa');
    const p2 = writeSrcFile('0002.mp3', 'bbb');
    const tasks: CopyFileTask[] = [
      { sourcePath: p1, fileName: '0001.mp3' },
      { sourcePath: p2, fileName: '0002.mp3' },
    ];

    const result = await copyFiles(tasks, destDir);

    expect(result.succeeded).toEqual(['0001.mp3', '0002.mp3']);
    expect(result.renamed).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(fs.readFileSync(path.join(destDir, '0001.mp3'), 'utf-8')).toBe('aaa');
    expect(fs.readFileSync(path.join(destDir, '0002.mp3'), 'utf-8')).toBe('bbb');
    // Originals preserved, byte-for-byte, on the source.
    expect(fs.readFileSync(p1, 'utf-8')).toBe('aaa');
    expect(fs.readFileSync(p2, 'utf-8')).toBe('bbb');
  });
});

describe('copyFiles — collision handling', () => {
  it('renames on collision instead of overwriting, and preserves the pre-existing destination file', async () => {
    fs.writeFileSync(path.join(destDir, '0454.mp3'), 'ORIGINAL-DEST');
    const src = writeSrcFile('0454.mp3', 'NEW-FROM-PEN');

    const result = await copyFiles([{ sourcePath: src, fileName: '0454.mp3' }], destDir);

    expect(result.succeeded).toEqual([]);
    expect(result.renamed).toEqual([{ original: '0454.mp3', savedAs: '0454 (1).mp3' }]);
    expect(fs.readFileSync(path.join(destDir, '0454.mp3'), 'utf-8')).toBe('ORIGINAL-DEST');
    expect(fs.readFileSync(path.join(destDir, '0454 (1).mp3'), 'utf-8')).toBe('NEW-FROM-PEN');
  });

  it('increments the suffix past existing renamed copies', () => {
    fs.writeFileSync(path.join(destDir, '0454.mp3'), 'a');
    fs.writeFileSync(path.join(destDir, '0454 (1).mp3'), 'b');
    expect(resolveCollisionFreeName(destDir, '0454.mp3')).toBe('0454 (2).mp3');
  });
});

describe('copyFiles — disconnected pen mid-batch', () => {
  it('stops the batch and reports remaining files as disconnected, keeping earlier successes', async () => {
    const p1 = writeSrcFile('0001.mp3', 'a');
    const p2 = writeSrcFile('0002.mp3', 'b');
    const p3 = writeSrcFile('0003.mp3', 'c');
    const tasks: CopyFileTask[] = [
      { sourcePath: p1, fileName: '0001.mp3' },
      { sourcePath: p2, fileName: '0002.mp3' },
      { sourcePath: p3, fileName: '0003.mp3' },
    ];

    let available = true;
    const result = await copyFiles(tasks, destDir, {
      isSourceRootAvailable: () => available,
      onProgress: (event) => {
        if (event.fileName === '0001.mp3' && event.fileStatus === 'done') available = false;
      },
    });

    expect(result.succeeded).toEqual(['0001.mp3']);
    expect(result.aborted).toBe(true);
    expect(result.failed.map((f) => f.file)).toEqual(['0002.mp3', '0003.mp3']);
    expect(result.failed.every((f) => f.reason === 'disconnected')).toBe(true);
    expect(fs.existsSync(path.join(destDir, '0002.mp3'))).toBe(false);
  });

  it('reports a per-file not-found error (without aborting the batch) when only one source file vanishes', async () => {
    const p1 = writeSrcFile('0001.mp3', 'a');
    const missingPath = path.join(srcDir, '0002.mp3'); // never created
    const p3 = writeSrcFile('0003.mp3', 'c');

    const result = await copyFiles(
      [
        { sourcePath: p1, fileName: '0001.mp3' },
        { sourcePath: missingPath, fileName: '0002.mp3' },
        { sourcePath: p3, fileName: '0003.mp3' },
      ],
      destDir,
    );

    expect(result.succeeded).toEqual(['0001.mp3', '0003.mp3']);
    expect(result.aborted).toBe(false);
    expect(result.failed).toEqual([{ file: '0002.mp3', message: expect.stringContaining('no longer exists'), reason: 'not-found' }]);
  });
});

describe('copyFiles — progress callback', () => {
  it('fires copying then a terminal status per file, in order', async () => {
    const p1 = writeSrcFile('0001.mp3', 'a');
    const p2 = writeSrcFile('0002.mp3', 'b');
    const events: string[] = [];

    await copyFiles(
      [
        { sourcePath: p1, fileName: '0001.mp3' },
        { sourcePath: p2, fileName: '0002.mp3' },
      ],
      destDir,
      { onProgress: (e) => events.push(`${e.fileIndex}:${e.fileName}:${e.fileStatus}`) },
    );

    expect(events).toEqual(['0:0001.mp3:copying', '0:0001.mp3:done', '1:0002.mp3:copying', '1:0002.mp3:done']);
  });
});
