import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listSnapshots } from '../../src/main/services/recordingSnapshot';
import {
  checkReassign,
  deleteFromPen,
  deleteFromSnapshot,
  getLabels,
  parseStickerNumber,
  reassignStickerNumber,
  renameLabelKey,
  setLabel,
  stickerFileName,
  type RecordingLabels,
} from '../../src/main/services/recordingManage';
import { createSnapshot, readManifest } from '../../src/main/services/recordingSnapshot';

let tmp: string;
let diy: string;
let backups: string;
const write = (p: string, body: string) => fs.writeFileSync(p, body);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'manage-'));
  diy = path.join(tmp, 'PEN', 'DIY');
  backups = path.join(tmp, 'RecordingBackups');
  fs.mkdirSync(diy, { recursive: true });
  fs.mkdirSync(backups, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('sticker numbers', () => {
  it('reads a four- or five-digit recording name', () => {
    expect(parseStickerNumber('0451.mp3')).toEqual({ digits: '0451', length: 4 });
    expect(parseStickerNumber('00451.MP3')).toEqual({ digits: '00451', length: 5 });
    expect(parseStickerNumber('teacher-take-3.mp3')).toBeNull();
    expect(parseStickerNumber('451.mp3')).toBeNull();
  });

  it('NEVER converts between four and five digits', () => {
    // 0451 and 00451 may be two different stickers. Padding "451" up to "0451" on the user's
    // behalf could send a recording to a sticker they did not mean, silently.
    expect(checkReassign({ input: '451', currentFileName: '0452.mp3', existingFileNames: [] }).status).toBe('invalid-length');
    expect(checkReassign({ input: '000451', currentFileName: '0452.mp3', existingFileNames: [] }).status).toBe('invalid-length');

    const four = checkReassign({ input: '0451', currentFileName: '0452.mp3', existingFileNames: [] });
    const five = checkReassign({ input: '00451', currentFileName: '0452.mp3', existingFileNames: [] });
    expect(four.status === 'ok' && four.fileName).toBe('0451.mp3');
    expect(five.status === 'ok' && five.fileName).toBe('00451.mp3');
  });

  it('rejects anything that is not digits', () => {
    expect(checkReassign({ input: '04a1', currentFileName: '0452.mp3', existingFileNames: [] }).status).toBe('not-digits');
    expect(checkReassign({ input: '../04', currentFileName: '0452.mp3', existingFileNames: [] }).status).toBe('not-digits');
    expect(checkReassign({ input: '', currentFileName: '0452.mp3', existingFileNames: [] }).status).toBe('not-digits');
  });

  it('warns, and does not block, for a number we cannot confirm', () => {
    // We do not hold the list of valid sticker numbers. A guessed upper bound would block a
    // real sticker and look, to the user, exactly like a broken app.
    const r = checkReassign({ input: '9999', currentFileName: '0452.mp3', existingFileNames: [] });
    expect(r.status).toBe('ok');
    expect(r.warnings).toContain('not-currently-on-pen');

    const fiveDigit = checkReassign({ input: '00451', currentFileName: '0452.mp3', existingFileNames: [] });
    expect(fiveDigit.status).toBe('ok');
    expect(fiveDigit.warnings).toContain('length-not-yet-printed');
  });

  it('recognises an occupied number and an unchanged one', () => {
    expect(checkReassign({ input: '0451', currentFileName: '0452.mp3', existingFileNames: ['0451.mp3'] }).status).toBe('occupied');
    expect(checkReassign({ input: '0452', currentFileName: '0452.mp3', existingFileNames: ['0452.mp3'] }).status).toBe('unchanged');
    // FAT is case-insensitive, so a differently-cased name is the same file.
    expect(checkReassign({ input: '0451', currentFileName: '0452.mp3', existingFileNames: ['0451.MP3'] }).status).toBe('occupied');
  });

  it('renames on the pen and backs it up first', async () => {
    write(path.join(diy, '0451.mp3'), 'grandma');

    const r = await reassignStickerNumber({
      diyDirReal: diy,
      currentFileName: '0451.mp3',
      input: '0462',
      backupRootDir: backups,
      penVolumeLabel: 'PONYABC',
    });

    expect(r.status).toBe('ok');
    expect(fs.readdirSync(diy)).toEqual(['0462.mp3']);
    expect(fs.readFileSync(path.join(diy, '0462.mp3'), 'utf8')).toBe('grandma');
    const snap = listSnapshots(backups)[0];
    expect(fs.readFileSync(path.join(snap.snapshotDir, '0451.mp3'), 'utf8')).toBe('grandma');
  });

  it('refuses to move onto a number that is taken, without touching anything', async () => {
    write(path.join(diy, '0451.mp3'), 'a');
    write(path.join(diy, '0452.mp3'), 'b');

    const r = await reassignStickerNumber({ diyDirReal: diy, currentFileName: '0451.mp3', input: '0452', backupRootDir: backups, penVolumeLabel: null });

    expect(r).toEqual({ status: 'rejected', reason: 'occupied' });
    expect(fs.readFileSync(path.join(diy, '0452.mp3'), 'utf8')).toBe('b');
    expect(listSnapshots(backups)).toEqual([]);
  });

  it('builds a filename from digits without reformatting them', () => {
    expect(stickerFileName('0451')).toBe('0451.mp3');
    expect(stickerFileName('00451')).toBe('00451.mp3');
  });
});

describe('deleting from the pen', () => {
  it('backs the pen up before removing anything', async () => {
    write(path.join(diy, '0451.mp3'), 'the only copy');
    write(path.join(diy, '0452.mp3'), 'keep me');

    const r = await deleteFromPen({ diyDirReal: diy, fileNames: ['0451.mp3'], backupRootDir: backups, penVolumeLabel: null });

    expect('deleted' in r && r.deleted).toEqual(['0451.mp3']);
    expect(fs.readdirSync(diy)).toEqual(['0452.mp3']);
    const snap = listSnapshots(backups)[0];
    // A DIY recording is often the only copy of a grandparent reading to a child.
    expect(fs.readFileSync(path.join(snap.snapshotDir, '0451.mp3'), 'utf8')).toBe('the only copy');
  });

  it('deletes nothing when the backup cannot be taken', async () => {
    write(path.join(diy, '0451.mp3'), 'precious');
    // A file where the backup root must be a directory.
    const blocked = path.join(tmp, 'blocked');
    write(blocked, 'not a directory');

    const r = await deleteFromPen({ diyDirReal: diy, fileNames: ['0451.mp3'], backupRootDir: blocked, penVolumeLabel: null });

    expect(r).toMatchObject({ status: 'backup-failed' });
    expect(fs.readFileSync(path.join(diy, '0451.mp3'), 'utf8')).toBe('precious');
  });

  it('reports a file it could not delete and carries on', async () => {
    write(path.join(diy, '0451.mp3'), 'a');
    const r = await deleteFromPen({ diyDirReal: diy, fileNames: ['0451.mp3', 'gone.mp3'], backupRootDir: backups, penVolumeLabel: null });
    expect('deleted' in r && r.deleted).toEqual(['0451.mp3']);
    expect('failed' in r && r.failed.map((f) => f.fileName)).toEqual(['gone.mp3']);
  });

  it('does nothing at all for an empty selection — no stray backup', async () => {
    write(path.join(diy, '0451.mp3'), 'a');
    const r = await deleteFromPen({ diyDirReal: diy, fileNames: [], backupRootDir: backups, penVolumeLabel: null });
    expect('deleted' in r && r.deleted).toEqual([]);
    expect(listSnapshots(backups)).toEqual([]);
  });
});

describe('deleting from the computer', () => {
  it('removes the file and takes it out of the manifest', async () => {
    write(path.join(diy, '0451.mp3'), 'a');
    write(path.join(diy, '0452.mp3'), 'b');
    const snap = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });

    const r = deleteFromSnapshot({ snapshotDir: snap.snapshotDir, fileNames: ['0451.mp3'] });

    expect(r.deleted).toEqual(['0451.mp3']);
    expect(readManifest(snap.snapshotDir)?.entries.map((e) => e.fileName)).toEqual(['0452.mp3']);
  });

  it('never touches the pen', async () => {
    write(path.join(diy, '0451.mp3'), 'still on the pen');
    const snap = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });

    deleteFromSnapshot({ snapshotDir: snap.snapshotDir, fileNames: ['0451.mp3'] });

    // The two sides are deleted separately, always. There is no action that does both.
    expect(fs.readFileSync(path.join(diy, '0451.mp3'), 'utf8')).toBe('still on the pen');
  });
});

describe('friendly labels', () => {
  it('stores a label per pen, never in a filename', () => {
    let labels: RecordingLabels = {};
    labels = setLabel(labels, 'PEN-A', '0451.mp3', 'Grandma, page 12');
    labels = setLabel(labels, 'PEN-B', '0451.mp3', 'Dad and the dog');

    expect(getLabels(labels, 'PEN-A')['0451.mp3']).toBe('Grandma, page 12');
    expect(getLabels(labels, 'PEN-B')['0451.mp3']).toBe('Dad and the dog');
  });

  it('clearing the text removes the label rather than storing an empty one', () => {
    let labels = setLabel({}, 'PEN-A', '0451.mp3', 'Something');
    labels = setLabel(labels, 'PEN-A', '0451.mp3', '   ');
    expect(getLabels(labels, 'PEN-A')).toEqual({});
  });

  it('accepts any text, because it never reaches the filesystem', () => {
    const labels = setLabel({}, 'PEN-A', '0451.mp3', '嫲嫲讀第 12 頁 🎈 / *?:<>|');
    expect(getLabels(labels, 'PEN-A')['0451.mp3']).toBe('嫲嫲讀第 12 頁 🎈 / *?:<>|');
  });

  it('follows a recording to its new sticker number', () => {
    let labels = setLabel({}, 'PEN-A', '0451.mp3', 'Grandma, page 12');
    labels = renameLabelKey(labels, 'PEN-A', '0451.mp3', '0462.mp3');
    expect(getLabels(labels, 'PEN-A')).toEqual({ '0462.mp3': 'Grandma, page 12' });
  });

  it('an unlabelled pen still gets its own bucket', () => {
    const labels = setLabel({}, null, '0451.mp3', 'x');
    expect(getLabels(labels, null)['0451.mp3']).toBe('x');
    expect(getLabels(labels, 'PEN-A')).toEqual({});
  });
});
