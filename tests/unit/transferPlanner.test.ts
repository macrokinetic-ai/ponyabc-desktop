import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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
  vi.restoreAllMocks();
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

  it('regression: a pen swap mid-batch (detected the moment "copying" fires for the first file) stops the write and never reports it replaced', async () => {
    // Exact reported repro: build a replace plan for a same-name file, then — at the instant
    // the first file's 'copying' progress fires — simulate the pen being unplugged and a
    // different one plugged back in (an explicit setPenRoot(null) followed by a new
    // setPenRoot). Previously this was not re-checked once execution started, so the write
    // went ahead and was reported as 'replaced' anyway.
    fs.writeFileSync(diyPath('0451.mp3'), 'ORIGINAL ON PEN');
    fs.writeFileSync(computerPath('0451.mp3'), 'NEW FROM COMPUTER');
    const capturedGeneration = session.getGeneration();

    const otherPen = mkTempDir('ponyabc-swap-pen-');
    fs.mkdirSync(path.join(otherPen, 'BOOK'));
    fs.mkdirSync(path.join(otherPen, 'DIY'));

    const events: string[] = [];
    const summary = await executeTransferToPen({
      fileNames: ['0451.mp3'],
      decisions: { '0451.mp3': 'replace' },
      penGeneration: capturedGeneration,
      backupRootDir,
      onProgress: (e) => {
        events.push(`${e.fileName}:${e.fileStatus}`);
        if (e.fileStatus === 'copying') {
          session.setPenRoot(null); // unplug
          selectPen(otherPen); // a different pen plugged in
        }
      },
    });

    expect(summary.replaced).toEqual([]); // must NOT report a replace that didn't actually (safely) happen
    expect(summary.added).toEqual([]);
    expect(summary.failed.length).toBe(1);
    expect(summary.failed[0].reason).toBe('device-changed');
    // The ORIGINAL pen's file must be exactly what it started as — untouched.
    expect(fs.readFileSync(diyPath('0451.mp3'), 'utf-8')).toBe('ORIGINAL ON PEN');
    // Nothing was written onto the newly-swapped-in pen either.
    expect(fs.existsSync(path.join(otherPen, 'DIY', '0451.mp3'))).toBe(false);
  });

  it('regression: a different pen remounted at the SAME path mid-batch is still detected (generation, not path/stat.dev, is authoritative)', async () => {
    // Same mount path throughout — only the session's own generation counter (bumped via the
    // explicit disconnect/reconnect calls) signals the change. A check based on "does this
    // path still exist" alone would wrongly treat this as an uninterrupted connection.
    fs.writeFileSync(diyPath('0451.mp3'), 'ORIGINAL ON PEN');
    fs.writeFileSync(computerPath('0451.mp3'), 'NEW FROM COMPUTER');
    const capturedGeneration = session.getGeneration();
    const samePath = penRoot;

    const summary = await executeTransferToPen({
      fileNames: ['0451.mp3'],
      decisions: { '0451.mp3': 'replace' },
      penGeneration: capturedGeneration,
      backupRootDir,
      onProgress: (e) => {
        if (e.fileStatus === 'copying') {
          session.setPenRoot(null); // simulate the physical disconnect that a remount implies
          selectPen(samePath); // a different card happens to remount at the identical path
        }
      },
    });

    expect(summary.replaced).toEqual([]);
    expect(summary.failed[0]?.reason).toBe('device-changed');
    expect(fs.readFileSync(diyPath('0451.mp3'), 'utf-8')).toBe('ORIGINAL ON PEN');
  });

  it('regression: once a mid-batch change is detected, the rest of the batch is aborted without being attempted', async () => {
    fs.writeFileSync(computerPath('a.mp3'), 'A');
    fs.writeFileSync(computerPath('b.mp3'), 'B');
    fs.writeFileSync(computerPath('c.mp3'), 'C');
    const capturedGeneration = session.getGeneration();

    const otherPen = mkTempDir('ponyabc-swap-pen-2-');
    fs.mkdirSync(path.join(otherPen, 'BOOK'));
    fs.mkdirSync(path.join(otherPen, 'DIY'));

    const summary = await executeTransferToPen({
      fileNames: ['a.mp3', 'b.mp3', 'c.mp3'],
      decisions: {},
      penGeneration: capturedGeneration,
      backupRootDir,
      onProgress: (e) => {
        if (e.fileName === 'a.mp3' && e.fileStatus === 'added') {
          session.setPenRoot(null);
          selectPen(otherPen);
        }
      },
    });

    expect(summary.added).toEqual(['a.mp3']); // first file completed before the swap
    expect(summary.failed.map((f) => f.file)).toEqual(['b.mp3', 'c.mp3']); // rest aborted, never attempted
    expect(summary.failed.every((f) => f.reason === 'device-changed')).toBe(true);
    expect(fs.existsSync(path.join(otherPen, 'DIY', 'b.mp3'))).toBe(false);
    expect(fs.existsSync(path.join(otherPen, 'DIY', 'c.mp3'))).toBe(false);
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

  it('regression: a pen swap during the write (right when "copying" fires) stops the replace instead of completing it', async () => {
    fs.writeFileSync(diyPath('0451.mp3'), 'ORIGINAL STICKER AUDIO');
    fs.writeFileSync(computerPath('take.mp3'), 'NEW TEACHER AUDIO');
    const plan = await planReplaceSticker({ penFileName: '0451.mp3', computerFileName: 'take.mp3' });
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;

    const otherPen = mkTempDir('ponyabc-replace-swap-pen-');
    fs.mkdirSync(path.join(otherPen, 'BOOK'));
    fs.mkdirSync(path.join(otherPen, 'DIY'));

    const summary = await executeReplaceSticker({
      penFileName: plan.penFileName,
      computerFileName: plan.computerFileName,
      penGeneration: plan.penGeneration,
      backupRootDir,
      onProgress: (e) => {
        if (e.fileStatus === 'copying') {
          session.setPenRoot(null);
          selectPen(otherPen);
        }
      },
    });

    expect(summary.status).not.toBe('completed');
    expect(fs.readFileSync(diyPath('0451.mp3'), 'utf-8')).toBe('ORIGINAL STICKER AUDIO');
    expect(fs.existsSync(path.join(otherPen, 'DIY', '0451.mp3'))).toBe(false);
  });

  it('regression: a failure summary always carries backupPath when a backup was made — not lost on the failure path', async () => {
    // The reported bug: executeReplaceSticker's early-return branches on failure omitted
    // backupPath entirely, even when safeWriteFile had already made one. Force a failure
    // AFTER the backup step by making the staging copy (source -> tmp) fail, while letting
    // the backup copy (final -> backupDir) succeed normally.
    fs.writeFileSync(diyPath('0451.mp3'), 'ORIGINAL STICKER AUDIO');
    fs.writeFileSync(computerPath('take.mp3'), 'NEW TEACHER AUDIO');
    const plan = await planReplaceSticker({ penFileName: '0451.mp3', computerFileName: 'take.mp3' });
    expect(plan.status).toBe('ok');
    if (plan.status !== 'ok') return;

    const realCopyFile = fs.promises.copyFile.bind(fs.promises);
    vi.spyOn(fs.promises, 'copyFile').mockImplementation(async (src, dest, ...rest) => {
      if (String(src).includes('take.mp3') && String(dest).includes('.ponyabc-tmp-')) {
        throw Object.assign(new Error('simulated staging failure'), { code: 'EIO' });
      }
      // @ts-expect-error - forwarding the flags arg through to the real implementation
      return realCopyFile(src, dest, ...rest);
    });

    const summary = await executeReplaceSticker({
      penFileName: plan.penFileName,
      computerFileName: plan.computerFileName,
      penGeneration: plan.penGeneration,
      backupRootDir,
    });

    expect(summary.status).not.toBe('completed');
    expect(summary.backupPath).toBeDefined();
    expect(fs.readFileSync(summary.backupPath!, 'utf-8')).toBe('ORIGINAL STICKER AUDIO');
    // The pen's original file is untouched — only a backup was made, the replace itself failed.
    expect(fs.readFileSync(diyPath('0451.mp3'), 'utf-8')).toBe('ORIGINAL STICKER AUDIO');
  });
});
