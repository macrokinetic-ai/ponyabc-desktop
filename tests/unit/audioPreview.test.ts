import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePenRoot } from '../../src/main/services/pathSecurity';
import * as session from '../../src/main/services/session';
import { readAudioPreview } from '../../src/main/ipc/audioPreview';

let penRoot: string;
let computerFolder: string;
const tempDirs: string[] = [];

function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  session.setPenRoot(null);
  session.setComputerFolder(null);

  penRoot = mkTempDir('ponyabc-audio-pen-');
  fs.mkdirSync(path.join(penRoot, 'BOOK'));
  fs.mkdirSync(path.join(penRoot, 'DIY'));
  fs.writeFileSync(path.join(penRoot, 'DIY', '0001.mp3'), 'pen-audio-bytes');
  const resolved = resolvePenRoot(penRoot);
  if (resolved.status !== 'ok') throw new Error('fixture pen root is not valid');
  session.setPenRoot(resolved);

  computerFolder = fs.realpathSync(mkTempDir('ponyabc-audio-computer-'));
  fs.writeFileSync(path.join(computerFolder, 'story.mp3'), 'computer-audio-bytes');
  session.setComputerFolder(computerFolder);
});

afterEach(() => {
  session.setPenRoot(null);
  session.setComputerFolder(null);
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('readAudioPreview', () => {
  it('reads a valid pen DIY file and returns its exact bytes as base64', () => {
    const result = readAudioPreview({ source: 'pen', fileName: '0001.mp3' });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(Buffer.from(result.base64, 'base64').toString()).toBe('pen-audio-bytes');
    expect(result.mimeType).toBe('audio/mpeg');
  });

  it('reads a valid computer folder file', () => {
    const result = readAudioPreview({ source: 'computer', fileName: 'story.mp3' });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(Buffer.from(result.base64, 'base64').toString()).toBe('computer-audio-bytes');
  });

  it('rejects a non-mp3 file name', () => {
    fs.writeFileSync(path.join(penRoot, 'DIY', 'notes.txt'), 'x');
    expect(readAudioPreview({ source: 'pen', fileName: 'notes.txt' })).toEqual({ status: 'rejected' });
  });

  it('rejects a macOS AppleDouble sidecar file', () => {
    fs.writeFileSync(path.join(penRoot, 'DIY', '._0001.mp3'), 'x');
    expect(readAudioPreview({ source: 'pen', fileName: '._0001.mp3' })).toEqual({ status: 'rejected' });
  });

  it('rejects a traversal attempt instead of touching anything outside the authorized folder', () => {
    expect(readAudioPreview({ source: 'pen', fileName: '../../../etc/passwd.mp3' })).toEqual({ status: 'rejected' });
    expect(readAudioPreview({ source: 'computer', fileName: '../outside.mp3' })).toEqual({ status: 'rejected' });
  });

  it('reports not-found for a file that no longer exists', () => {
    expect(readAudioPreview({ source: 'pen', fileName: 'gone.mp3' })).toEqual({ status: 'not-found' });
  });

  it('reports no-pen-selected / no-computer-folder-selected when nothing is selected', () => {
    session.setPenRoot(null);
    session.setComputerFolder(null);
    expect(readAudioPreview({ source: 'pen', fileName: '0001.mp3' })).toEqual({ status: 'no-pen-selected' });
    expect(readAudioPreview({ source: 'computer', fileName: 'story.mp3' })).toEqual({ status: 'no-computer-folder-selected' });
  });

  it('reports device-disconnected when the pen root has vanished from disk', () => {
    fs.rmSync(penRoot, { recursive: true, force: true });
    expect(readAudioPreview({ source: 'pen', fileName: '0001.mp3' })).toEqual({ status: 'device-disconnected' });
  });

  it('reports too-large for a file over the (injectable, for testing) size cap', () => {
    const result = readAudioPreview({ source: 'pen', fileName: '0001.mp3' }, 4 /* bytes */);
    expect(result).toEqual({ status: 'too-large' });
  });
});
