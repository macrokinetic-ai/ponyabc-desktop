import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  MANIFEST_FILENAME,
  createSnapshot,
  listSnapshots,
  makeSnapshotId,
  readManifest,
} from '../../src/main/services/recordingSnapshot';

/**
 * The bug being designed out: saving to the computer used to rename `0451.mp3` to
 * `0451 (1).mp3`, and since the pen identifies a recording by its filename alone, the renamed
 * file could never be restored. A snapshot folder has no collisions to resolve, so no rename.
 *
 * Real directories, not a mocked fs: hard links, dedupe and "does the file actually exist"
 * are filesystem behaviours, and a mock would only agree with whatever the code assumed.
 */

let tmp: string;
let diy: string;
let backups: string;

const write = (p: string, body: string) => fs.writeFileSync(p, body);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapshot-'));
  diy = path.join(tmp, 'PEN', 'DIY');
  backups = path.join(tmp, 'RecordingBackups');
  fs.mkdirSync(diy, { recursive: true });
  fs.mkdirSync(backups, { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('recording snapshots — original filenames', () => {
  it('keeps every filename exactly as it is on the pen, twice in a row', async () => {
    write(path.join(diy, '0451.mp3'), 'grandma');
    write(path.join(diy, '0452.mp3'), 'dad');

    const first = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: 'PONYABC' });
    // Same pen, same recordings, a second backup — the case that used to produce "(1)".
    const second = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: 'PONYABC' });

    for (const dir of [first.snapshotDir, second.snapshotDir]) {
      expect(fs.readdirSync(dir).sort()).toEqual([MANIFEST_FILENAME, '0451.mp3', '0452.mp3'].sort());
    }
    expect(first.snapshotDir).not.toBe(second.snapshotDir);
    // The thing that made the old backups useless must not appear anywhere.
    expect(fs.readdirSync(backups).flatMap((d) => fs.readdirSync(path.join(backups, d))).join(' ')).not.toMatch(/\(\d+\)/);
  });

  it('ignores anything that is not a recording, including macOS sidecars', async () => {
    write(path.join(diy, '0451.mp3'), 'real');
    write(path.join(diy, '._0451.mp3'), 'apple double sidecar');
    write(path.join(diy, 'notes.txt'), 'not audio');

    const r = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });

    expect(r.manifest.entries.map((e) => e.fileName)).toEqual(['0451.mp3']);
  });
});

describe('recording snapshots — the manifest lists everything', () => {
  it('names every recording in every snapshot, even when the bytes are shared', async () => {
    write(path.join(diy, '0451.mp3'), 'unchanged');
    const first = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });
    const second = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });

    // This is the amendment that matters: omitting an unchanged file would mean deleting the
    // first snapshot silently breaks the second.
    expect(second.manifest.entries.map((e) => e.fileName)).toEqual(['0451.mp3']);
    expect(fs.existsSync(path.join(second.snapshotDir, '0451.mp3'))).toBe(true);
    expect(second.dedupedCount).toBe(1);
    expect(second.manifest.entries[0].bytesFrom).toBe(first.snapshotId);
  });

  it('a snapshot survives its predecessor being deleted', async () => {
    write(path.join(diy, '0451.mp3'), 'precious recording');
    const first = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });
    const second = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });

    fs.rmSync(first.snapshotDir, { recursive: true, force: true });

    // A hard link keeps the bytes alive; a copy never depended on the other folder anyway.
    expect(fs.readFileSync(path.join(second.snapshotDir, '0451.mp3'), 'utf8')).toBe('precious recording');
    expect(listSnapshots(backups).map((s) => s.snapshotId)).toEqual([second.snapshotId]);
  });

  it('records size, modified time, hash and label for each recording', async () => {
    write(path.join(diy, '0451.mp3'), 'abc');

    const r = await createSnapshot({
      diyDirReal: diy,
      backupRootDir: backups,
      penVolumeLabel: 'PONYABC',
      labels: { '0451.mp3': 'Grandma, page 12' },
    });

    const entry = r.manifest.entries[0];
    expect(entry.sizeBytes).toBe(3);
    expect(entry.mtimeMs).toBeGreaterThan(0);
    // sha256("abc")
    expect(entry.sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(entry.label).toBe('Grandma, page 12');
    expect(r.manifest.penVolumeLabel).toBe('PONYABC');
  });

  it('writes a manifest that reads back', async () => {
    write(path.join(diy, '0451.mp3'), 'x');
    const r = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });
    expect(readManifest(r.snapshotDir)).toEqual(r.manifest);
  });

  it('treats a folder without a readable manifest as not a snapshot', async () => {
    fs.mkdirSync(path.join(backups, 'random-folder'));
    write(path.join(backups, 'random-folder', '0451.mp3'), 'loose file');
    expect(listSnapshots(backups)).toEqual([]);
    expect(readManifest(path.join(backups, 'random-folder'))).toBeNull();
  });
});

describe('recording snapshots — deduplication', () => {
  it('hard-links identical bytes instead of storing them twice', async () => {
    write(path.join(diy, '0451.mp3'), 'same bytes');
    const first = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });
    const second = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });

    expect(second.manifest.entries[0].storage).toBe('hardlink');
    expect(fs.statSync(path.join(first.snapshotDir, '0451.mp3')).ino).toBe(fs.statSync(path.join(second.snapshotDir, '0451.mp3')).ino);
  });

  it('stores changed bytes properly rather than linking to the old ones', async () => {
    write(path.join(diy, '0451.mp3'), 'take one');
    const first = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });
    write(path.join(diy, '0451.mp3'), 'take two — re-recorded');
    const second = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });

    expect(second.manifest.entries[0].storage).toBe('copy');
    expect(fs.readFileSync(path.join(first.snapshotDir, '0451.mp3'), 'utf8')).toBe('take one');
    expect(fs.readFileSync(path.join(second.snapshotDir, '0451.mp3'), 'utf8')).toBe('take two — re-recorded');
  });

  it('falls back to a real copy when the destination cannot hard-link, and never omits the file', async () => {
    write(path.join(diy, '0451.mp3'), 'same bytes');
    await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });
    // exFAT/FAT32 external drives: link() fails. Correctness must not depend on it.
    vi.spyOn(fs, 'linkSync').mockImplementation(() => {
      throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
    });

    const second = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });

    expect(second.manifest.entries[0].storage).toBe('copy');
    expect(second.linkFallbackCount).toBe(1);
    expect(fs.readFileSync(path.join(second.snapshotDir, '0451.mp3'), 'utf8')).toBe('same bytes');
  });

  it('deduplicates two identical recordings within one snapshot', async () => {
    write(path.join(diy, '0451.mp3'), 'identical');
    write(path.join(diy, '0452.mp3'), 'identical');

    const r = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });

    expect(r.manifest.entries).toHaveLength(2);
    expect(fs.existsSync(path.join(r.snapshotDir, '0452.mp3'))).toBe(true);
    expect(r.dedupedCount).toBe(1);
  });
});

describe('recording snapshots — edge cases', () => {
  it('reports a file it could not read instead of pretending it was backed up', async () => {
    write(path.join(diy, '0451.mp3'), 'ok');
    write(path.join(diy, '0452.mp3'), 'unreadable');
    const real = fs.statSync;
    vi.spyOn(fs, 'statSync').mockImplementation((p, ...rest) => {
      if (String(p).endsWith('0452.mp3')) throw new Error('EIO');
      return real(p as string, ...(rest as []));
    });

    const r = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });

    expect(r.manifest.entries.map((e) => e.fileName)).toEqual(['0451.mp3']);
    expect(r.failed).toEqual([{ fileName: '0452.mp3', error: 'EIO' }]);
  });

  it('an empty pen produces a valid, empty snapshot rather than nothing at all', async () => {
    const r = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null });
    expect(r.manifest.entries).toEqual([]);
    expect(readManifest(r.snapshotDir)?.entries).toEqual([]);
  });

  it('a missing DIY folder does not throw', async () => {
    const r = await createSnapshot({ diyDirReal: path.join(tmp, 'nope'), backupRootDir: backups, penVolumeLabel: null });
    expect(r.manifest.entries).toEqual([]);
  });

  it('ids are sortable and unique within the same minute', () => {
    const at = new Date(2026, 8, 30, 14, 12);
    const a = makeSnapshotId(at);
    const b = makeSnapshotId(at);
    expect(a.startsWith('2026-09-30-1412-')).toBe(true);
    expect(a).not.toBe(b);
    expect(makeSnapshotId(new Date(2026, 8, 30, 14, 13)) > a).toBe(true);
  });

  it('lists snapshots newest first', async () => {
    write(path.join(diy, '0451.mp3'), 'x');
    const older = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null, now: new Date(2026, 8, 29, 9, 0) });
    const newer = await createSnapshot({ diyDirReal: diy, backupRootDir: backups, penVolumeLabel: null, now: new Date(2026, 8, 30, 9, 0) });
    expect(listSnapshots(backups).map((s) => s.snapshotId)).toEqual([newer.snapshotId, older.snapshotId]);
  });
});
