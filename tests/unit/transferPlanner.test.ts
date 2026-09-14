import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolvePenRoot } from '../../src/main/services/pathSecurity';
import * as session from '../../src/main/services/session';
import {
  executeReplaceSticker,
  executeTransferToPen,
  planReplaceSticker,
  planTransferToPen,
} from '../../src/main/services/transferPlanner';

let penRoot: string;
let computerFolder: string;
let backupRootDir: string;
const tempDirs: string[] = [];

function mkTempDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function selectPen(root: string) {
  const resolved = resolvePenRoot(root);
  if (resolved.status !== 'ok') throw new Error('fixture pen root is not valid');
  session.setPenRoot(resolved);
  return resolved;
}

beforeEach(() => {
  session.setPenRoot(null);
  session.setComputerFolder(null);

  penRoot = mkTempDir('ponyabc-pen-');
  fs.mkdirSync(path.join(penRoot, 'BOOK'));
  fs.mkdirSync(path.join(penRoot, 'DIY'));
  selectPen(penRoot);

  // Mirror production (computerFolder.ts always stores a realpath-resolved path) — on macOS
  // os.tmpdir() lives under a symlink (/var -> /private/var), so this matters for the
  // exact-directory containment check in resolveContainedFile.
  computerFolder = fs.realpathSync(mkTempDir('ponyabc-computer-'));
  session.setComputerFolder(computerFolder);

  backupRootDir = mkTempDir('ponyabc-backuproot-');
});

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function diyPath(...segments: string[]): string {
  return path.join(penRoot, 'DIY', ...segments);
}
function computerPath(...segments: string[]): string {
  return path.join(computerFolder, ...segments);
}

describe('planTransferToPen', () => {
  it('categorizes new filenames as toAdd and same-name files as conflicts', async () => {
    fs.writeFileSync(computerPath('new-one.mp3'), 'aaaa');
    fs.writeFileSync(computerPath('0451.mp3'), 'new content');
    fs.writeFileSync(diyPath('0451.mp3'), 'existing content on pen');

    const plan = await planTransferToPen(['new-one.mp3', '0451.mp3']);
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.toAdd.map((i) => i.fileName)).toEqual(['new-one.mp3']);
    expect(plan.conflicts.map((c) => c.fileName)).toEqual(['0451.mp3']);
    expect(plan.requiredBytes).toBe('aaaa'.length + 'new content'.length);
  });

  it('rejects AppleDouble sidecar files and non-mp3 files, and reports missing sources', async () => {
    fs.writeFileSync(computerPath('._0451.mp3'), 'metadata junk');
    fs.writeFileSync(computerPath('notes.txt'), 'text');

    const plan = await planTransferToPen(['._0451.mp3', 'notes.txt', 'never-existed.mp3']);
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.toAdd).toEqual([]);
    expect(plan.conflicts).toEqual([]);
    const reasons = Object.fromEntries(plan.rejected.map((r) => [r.fileName, r.reason]));
    expect(reasons['._0451.mp3']).toBe('not-mp3');
    expect(reasons['notes.txt']).toBe('not-mp3');
    expect(reasons['never-existed.mp3']).toBe('not-found');
  });

  it('reports hasEnoughSpace false when an injected free-space function returns too little', async () => {
    fs.writeFileSync(computerPath('big.mp3'), 'x'.repeat(1000));
    const plan = await planTransferToPen(['big.mp3'], { getFreeBytesFn: async () => 10 });
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;
    expect(plan.hasEnoughSpace).toBe(false);
    expect(plan.freeBytes).toBe(10);
  });
});

describe('executeTransferToPen', () => {
  it('adds a new file, preserving the exact alphanumeric sticker-style filename', async () => {
    fs.writeFileSync(computerPath('EnglishStory_42.mp3'), 'content');

    const summary = await executeTransferToPen({
      fileNames: ['EnglishStory_42.mp3'],
      decisions: {},
      penGeneration: session.getGeneration(),
      backupRootDir,
    });

    expect(summary.status).toBe('completed');
    expect(summary.added).toEqual(['EnglishStory_42.mp3']);
    expect(fs.readFileSync(diyPath('EnglishStory_42.mp3'), 'utf-8')).toBe('content');
  });

  it('replaces a conflicting file only when the decision is "replace", backing up the original', async () => {
    fs.writeFileSync(diyPath('0451.mp3'), 'OLD');
    fs.writeFileSync(computerPath('0451.mp3'), 'NEW');

    const summary = await executeTransferToPen({
      fileNames: ['0451.mp3'],
      decisions: { '0451.mp3': 'replace' },
      penGeneration: session.getGeneration(),
      backupRootDir,
    });

    expect(summary.status).toBe('completed');
    expect(summary.replaced).toHaveLength(1);
    expect(summary.replaced[0].fileName).toBe('0451.mp3');
    expect(fs.readFileSync(summary.replaced[0].backupPath, 'utf-8')).toBe('OLD');
    expect(fs.readFileSync(diyPath('0451.mp3'), 'utf-8')).toBe('NEW');
  });

  it('skips a conflicting file when the decision is "skip", leaving the pen file untouched', async () => {
    fs.writeFileSync(diyPath('0451.mp3'), 'OLD');
    fs.writeFileSync(computerPath('0451.mp3'), 'NEW');

    const summary = await executeTransferToPen({
      fileNames: ['0451.mp3'],
      decisions: { '0451.mp3': 'skip' },
      penGeneration: session.getGeneration(),
      backupRootDir,
    });

    expect(summary.skipped).toEqual(['0451.mp3']);
    expect(summary.replaced).toEqual([]);
    expect(fs.readFileSync(diyPath('0451.mp3'), 'utf-8')).toBe('OLD');
  });

  it('never silently overwrites a conflict that has no recorded decision — treats it as skipped', async () => {
    fs.writeFileSync(diyPath('0451.mp3'), 'OLD');
    fs.writeFileSync(computerPath('0451.mp3'), 'NEW');

    const summary = await executeTransferToPen({
      fileNames: ['0451.mp3'],
      decisions: {}, // no decision recorded for this conflict
      penGeneration: session.getGeneration(),
      backupRootDir,
    });

    expect(summary.skipped).toEqual(['0451.mp3']);
    expect(fs.readFileSync(diyPath('0451.mp3'), 'utf-8')).toBe('OLD');
  });

  it('rejects with stale-plan when the pen changed since the plan was made', async () => {
    fs.writeFileSync(computerPath('a.mp3'), 'x');
    const originalGeneration = session.getGeneration();

    // Simulate unplugging and plugging in a different pen.
    const otherPen = mkTempDir('ponyabc-other-pen-');
    fs.mkdirSync(path.join(otherPen, 'BOOK'));
    fs.mkdirSync(path.join(otherPen, 'DIY'));
    selectPen(otherPen);
    expect(session.getGeneration()).not.toBe(originalGeneration);

    const summary = await executeTransferToPen({
      fileNames: ['a.mp3'],
      decisions: {},
      penGeneration: originalGeneration,
      backupRootDir,
    });

    expect(summary.status).toBe('stale-plan');
    expect(fs.existsSync(path.join(otherPen, 'DIY', 'a.mp3'))).toBe(false);
  });

  it('reports device-disconnected and writes nothing when the pen is gone at execute time', async () => {
    fs.writeFileSync(computerPath('a.mp3'), 'x');
    const generation = session.getGeneration();
    fs.rmSync(penRoot, { recursive: true, force: true });

    const summary = await executeTransferToPen({ fileNames: ['a.mp3'], decisions: {}, penGeneration: generation, backupRootDir });
    expect(summary.status).toBe('device-disconnected');
  });

  it('reports no-space and writes nothing when free space is insufficient', async () => {
    fs.writeFileSync(computerPath('a.mp3'), 'x'.repeat(1000));
    const summary = await executeTransferToPen({
      fileNames: ['a.mp3'],
      decisions: {},
      penGeneration: session.getGeneration(),
      backupRootDir,
      getFreeBytesFn: async () => 10,
    });
    expect(summary.status).toBe('no-space');
    expect(fs.existsSync(diyPath('a.mp3'))).toBe(false);
  });
});

describe('planReplaceSticker / executeReplaceSticker', () => {
  it('replaces the PEN filename with the COMPUTER file content, leaving the computer file untouched', async () => {
    fs.writeFileSync(diyPath('0451.mp3'), 'ORIGINAL STICKER AUDIO');
    fs.writeFileSync(computerPath('teacher-take-3.mp3'), 'NEW TEACHER AUDIO');

    const plan = await planReplaceSticker({ penFileName: '0451.mp3', computerFileName: 'teacher-take-3.mp3' });
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;

    const summary = await executeReplaceSticker({
      penFileName: plan.penFileName,
      computerFileName: plan.computerFileName,
      penGeneration: plan.penGeneration,
      backupRootDir,
    });

    expect(summary.status).toBe('completed');
    expect(fs.readFileSync(diyPath('0451.mp3'), 'utf-8')).toBe('NEW TEACHER AUDIO');
    expect(fs.readFileSync(summary.backupPath!, 'utf-8')).toBe('ORIGINAL STICKER AUDIO');
    // The computer source itself is never renamed or modified.
    expect(fs.readFileSync(computerPath('teacher-take-3.mp3'), 'utf-8')).toBe('NEW TEACHER AUDIO');
    expect(fs.existsSync(computerPath('0451.mp3'))).toBe(false);
  });

  it('rejects with stale-plan if the pen changed between plan and execute', async () => {
    fs.writeFileSync(diyPath('0451.mp3'), 'ORIGINAL');
    fs.writeFileSync(computerPath('take.mp3'), 'NEW');
    const plan = await planReplaceSticker({ penFileName: '0451.mp3', computerFileName: 'take.mp3' });
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;

    const otherPen = mkTempDir('ponyabc-other-pen-');
    fs.mkdirSync(path.join(otherPen, 'BOOK'));
    fs.mkdirSync(path.join(otherPen, 'DIY'));
    selectPen(otherPen);

    const summary = await executeReplaceSticker({
      penFileName: plan.penFileName,
      computerFileName: plan.computerFileName,
      penGeneration: plan.penGeneration,
      backupRootDir,
    });
    expect(summary.status).toBe('stale-plan');
  });

  it('reports not-found for a pen file that no longer exists', async () => {
    fs.writeFileSync(computerPath('take.mp3'), 'NEW');
    const plan = await planReplaceSticker({ penFileName: 'missing.mp3', computerFileName: 'take.mp3' });
    expect(plan).toEqual({ status: 'not-found', which: 'pen-file' });
  });

  it('reports not-found for a computer file that no longer exists', async () => {
    fs.writeFileSync(diyPath('0451.mp3'), 'ORIGINAL');
    const plan = await planReplaceSticker({ penFileName: '0451.mp3', computerFileName: 'missing.mp3' });
    expect(plan).toEqual({ status: 'not-found', which: 'computer-file' });
  });

  it('reports no-space and leaves the pen file untouched when free space is insufficient', async () => {
    fs.writeFileSync(diyPath('0451.mp3'), 'ORIGINAL');
    fs.writeFileSync(computerPath('take.mp3'), 'x'.repeat(1000));
    const plan = await planReplaceSticker({ penFileName: '0451.mp3', computerFileName: 'take.mp3' });
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;

    const summary = await executeReplaceSticker({
      penFileName: plan.penFileName,
      computerFileName: plan.computerFileName,
      penGeneration: plan.penGeneration,
      backupRootDir,
      getFreeBytesFn: async () => 10,
    });
    expect(summary.status).toBe('no-space');
    expect(fs.readFileSync(diyPath('0451.mp3'), 'utf-8')).toBe('ORIGINAL');
  });
});
