import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createSnapshot, listSnapshots } from '../../src/main/services/recordingSnapshot';
import { executeRestore, planRestore } from '../../src/main/services/recordingRestore';

/**
 * The rule under test: a recording goes back onto the pen under its own name, or not at all.
 * The pen finds a recording by filename — the filename IS the sticker number — so a "(1)" name
 * on the pen is not a slightly-wrong restore, it is a file the pen can never play.
 */

let tmp: string;
let diy: string;
let backups: string;
const write = (p: string, body: string) => fs.writeFileSync(p, body);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'restore-'));
  diy = path.join(tmp, 'PEN', 'DIY');
  backups = path.join(tmp, 'RecordingBackups');
  fs.mkdirSync(diy, { recursive: true });
  fs.mkdirSync(backups, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

async function snapshotOf(files: Record<string, string>, labels: Record<string, string> = {}) {
  for (const [name, body] of Object.entries(files)) write(path.join(diy, name), body);
  const snap = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: 'PONYABC', labels });
  for (const name of Object.keys(files)) fs.rmSync(path.join(diy, name));
  return snap;
}

describe('restore — the ordinary case', () => {
  it('puts a recording back under its original name', async () => {
    const snap = await snapshotOf({ '0451.mp3': 'grandma' });

    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy });
    expect(plan.items.map((i) => [i.fileName, i.state])).toEqual([['0451.mp3', 'new']]);

    const r = await executeRestore({
      snapshotDir: snap.snapshotDir,
      plan,
      diyDirReal: diy,
      decisions: {},
      backupRootDir: backups,
      penVolumeLabel: 'PONYABC',
    });

    expect(r.restored).toEqual(['0451.mp3']);
    expect(fs.readdirSync(diy)).toEqual(['0451.mp3']);
    expect(fs.readFileSync(path.join(diy, '0451.mp3'), 'utf8')).toBe('grandma');
  });

  it('copies rather than moves — the backup is still there afterwards', async () => {
    const snap = await snapshotOf({ '0451.mp3': 'keep me' });
    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy });
    await executeRestore({ snapshotDir: snap.snapshotDir, plan, diyDirReal: diy, decisions: {}, backupRootDir: backups, penVolumeLabel: null });

    expect(fs.readFileSync(path.join(snap.snapshotDir, '0451.mp3'), 'utf8')).toBe('keep me');
  });

  it('restores only the recordings asked for', async () => {
    const snap = await snapshotOf({ '0451.mp3': 'a', '0452.mp3': 'b' });
    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy, fileNames: ['0452.mp3'] });
    const r = await executeRestore({ snapshotDir: snap.snapshotDir, plan, diyDirReal: diy, decisions: {}, backupRootDir: backups, penVolumeLabel: null });

    expect(r.restored).toEqual(['0452.mp3']);
    expect(fs.readdirSync(diy)).toEqual(['0452.mp3']);
  });
});

describe('restore — clashes', () => {
  it('an identical copy is not a question and not work', async () => {
    const snap = await snapshotOf({ '0451.mp3': 'same' });
    write(path.join(diy, '0451.mp3'), 'same');

    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy });
    expect(plan.items[0].state).toBe('identical');

    const r = await executeRestore({ snapshotDir: snap.snapshotDir, plan, diyDirReal: diy, decisions: {}, backupRootDir: backups, penVolumeLabel: null });

    expect(r.unchanged).toEqual(['0451.mp3']);
    expect(r.penBackupSnapshotId).toBeNull(); // nothing was overwritten, so nothing was backed up
  });

  it('different content of the same name is a clash, with both sides described', async () => {
    const snap = await snapshotOf({ '0451.mp3': 'the backup take' });
    write(path.join(diy, '0451.mp3'), 'a different, longer take on the pen');

    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy });

    const item = plan.items[0];
    expect(item.state).toBe('clash');
    // Enough for the dialog to show "from backup / on the pen" without reading either file again.
    expect(item.backupSizeBytes).toBe('the backup take'.length);
    expect(item.penSizeBytes).toBe('a different, longer take on the pen'.length);
    expect(item.penMtimeMs).toBeGreaterThan(0);
  });

  it('Replace overwrites, and backs up the pen\'s copy first', async () => {
    const snap = await snapshotOf({ '0451.mp3': 'from backup' });
    write(path.join(diy, '0451.mp3'), 'the only copy of this take');

    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy });
    const r = await executeRestore({
      snapshotDir: snap.snapshotDir,
      plan,
      diyDirReal: diy,
      decisions: { '0451.mp3': 'replace' },
      backupRootDir: backups,
      penVolumeLabel: null,
    });

    expect(r.replaced).toEqual(['0451.mp3']);
    expect(fs.readFileSync(path.join(diy, '0451.mp3'), 'utf8')).toBe('from backup');
    // The overwritten take must still exist somewhere — it may have been the only copy.
    expect(r.penBackupSnapshotId).not.toBeNull();
    const penBackup = listSnapshots(backups).find((s) => s.snapshotId === r.penBackupSnapshotId);
    expect(fs.readFileSync(path.join(penBackup!.snapshotDir, '0451.mp3'), 'utf8')).toBe('the only copy of this take');
  });

  it("Keep pen's leaves the pen untouched", async () => {
    const snap = await snapshotOf({ '0451.mp3': 'from backup' });
    write(path.join(diy, '0451.mp3'), 'the pen wins');

    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy });
    const r = await executeRestore({
      snapshotDir: snap.snapshotDir,
      plan,
      diyDirReal: diy,
      decisions: { '0451.mp3': 'keep-pen' },
      backupRootDir: backups,
      penVolumeLabel: null,
    });

    expect(r.skipped).toEqual(['0451.mp3']);
    expect(fs.readFileSync(path.join(diy, '0451.mp3'), 'utf8')).toBe('the pen wins');
    expect(r.penBackupSnapshotId).toBeNull();
  });

  it('an undecided clash is skipped, never guessed', async () => {
    const snap = await snapshotOf({ '0451.mp3': 'from backup' });
    write(path.join(diy, '0451.mp3'), 'on the pen');

    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy });
    const r = await executeRestore({ snapshotDir: snap.snapshotDir, plan, diyDirReal: diy, decisions: {}, backupRootDir: backups, penVolumeLabel: null });

    // Both possible guesses destroy something, so the only safe default is to do nothing.
    expect(r.skipped).toEqual(['0451.mp3']);
    expect(fs.readFileSync(path.join(diy, '0451.mp3'), 'utf8')).toBe('on the pen');
  });

  it('NEVER writes a "(1)" name onto the pen', async () => {
    const snap = await snapshotOf({ '0451.mp3': 'from backup' });
    write(path.join(diy, '0451.mp3'), 'on the pen');

    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy });
    for (const decision of ['replace', 'keep-pen'] as const) {
      await executeRestore({
        snapshotDir: snap.snapshotDir,
        plan,
        diyDirReal: diy,
        decisions: { '0451.mp3': decision },
        backupRootDir: backups,
        penVolumeLabel: null,
      });
      expect(fs.readdirSync(diy)).toEqual(['0451.mp3']);
    }
  });
});

describe('restore — things that can go wrong', () => {
  it('reports bytes missing from the backup up front, not part-way through', async () => {
    const snap = await snapshotOf({ '0451.mp3': 'a', '0452.mp3': 'b' });
    fs.rmSync(path.join(snap.snapshotDir, '0452.mp3'));

    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy });

    expect(plan.missingFromBackup).toEqual(['0452.mp3']);
    expect(plan.items.map((i) => i.fileName)).toEqual(['0451.mp3']);
  });

  it('a file that cannot be written is reported, and the rest still restore', async () => {
    const snap = await snapshotOf({ '0451.mp3': 'a', '0452.mp3': 'b' });
    fs.rmSync(path.join(snap.snapshotDir, '0451.mp3'));
    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy });
    // Force the first item back into the plan with its bytes gone.
    plan.items.unshift({ fileName: '0451.mp3', state: 'new', label: null, backupSizeBytes: 1, backupMtimeMs: 1, penSizeBytes: null, penMtimeMs: null });

    const r = await executeRestore({ snapshotDir: snap.snapshotDir, plan, diyDirReal: diy, decisions: {}, backupRootDir: backups, penVolumeLabel: null });

    expect(r.failed.map((f) => f.fileName)).toEqual(['0451.mp3']);
    expect(r.restored).toEqual(['0452.mp3']);
  });

  it('carries the label from the backup so the dialog can show a name, not just a number', async () => {
    const snap = await snapshotOf({ '0451.mp3': 'x' }, { '0451.mp3': 'Grandma, page 12' });
    const plan = await planRestore({ snapshotDir: snap.snapshotDir, manifest: snap.manifest, diyDirReal: diy });
    expect(plan.items[0].label).toBe('Grandma, page 12');
  });
});
