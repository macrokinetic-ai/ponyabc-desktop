import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readManifest } from '../../src/main/services/recordingSnapshot';
import { migrateLegacyBackups, parseLegacyName, scanLegacyBackups } from '../../src/main/services/recordingMigration';

/**
 * These folders are the wreckage of the old behaviour: `0451.mp3` next to `0451 (1).mp3`,
 * where the second is unusable because the pen only answers to the first name.
 *
 * The one thing migration must never do is choose for the user when the two genuinely differ —
 * a silent automatic choice is precisely what created the problem.
 */

let tmp: string;
let legacy: string;
let backups: string;
const write = (p: string, body: string) => fs.writeFileSync(p, body);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-'));
  legacy = path.join(tmp, 'Old backups');
  backups = path.join(tmp, 'RecordingBackups');
  fs.mkdirSync(legacy, { recursive: true });
  fs.mkdirSync(backups, { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('reading old backup folders', () => {
  it('recognises a "(N)" name and recovers the real one', () => {
    expect(parseLegacyName('0451 (1).mp3')).toEqual({ baseFileName: '0451.mp3', suffix: 1 });
    expect(parseLegacyName('0451 (12).mp3')).toEqual({ baseFileName: '0451.mp3', suffix: 12 });
    expect(parseLegacyName('0451.mp3')).toEqual({ baseFileName: '0451.mp3', suffix: null });
    // A name a person chose that happens to end in brackets is not our rename.
    expect(parseLegacyName('story (final).mp3')).toEqual({ baseFileName: 'story (final).mp3', suffix: null });
  });

  it('groups a recording with its renamed copies and counts what was unusable', async () => {
    write(path.join(legacy, '0451.mp3'), 'take one');
    write(path.join(legacy, '0451 (1).mp3'), 'take one');
    write(path.join(legacy, '0452.mp3'), 'only one of these');

    const scan = await scanLegacyBackups(legacy);

    expect(scan.groups).toHaveLength(1);
    expect(scan.groups[0].fileName).toBe('0451.mp3');
    expect(scan.single.map((s) => s.fileName)).toEqual(['0452.mp3']);
    expect(scan.renamedCount).toBe(1);
  });

  it('calls byte-identical copies a duplicate — nothing to decide', async () => {
    write(path.join(legacy, '0451.mp3'), 'same bytes');
    write(path.join(legacy, '0451 (1).mp3'), 'same bytes');
    write(path.join(legacy, '0451 (2).mp3'), 'same bytes');

    const scan = await scanLegacyBackups(legacy);
    expect(scan.groups[0].resolution).toBe('duplicate');
  });

  it('calls genuinely different takes a choice for the user', async () => {
    write(path.join(legacy, '0451.mp3'), 'take one');
    write(path.join(legacy, '0451 (1).mp3'), 'a completely different take');

    const scan = await scanLegacyBackups(legacy);
    expect(scan.groups[0].resolution).toBe('differs');
    // Everything the dialog needs to let a person tell them apart.
    expect(scan.groups[0].candidates.map((c) => c.fileName)).toEqual(['0451.mp3', '0451 (1).mp3']);
    expect(scan.groups[0].candidates.every((c) => c.sizeBytes > 0 && c.mtimeMs > 0)).toBe(true);
  });

  it('ignores non-recordings and macOS sidecars', async () => {
    write(path.join(legacy, '0451.mp3'), 'a');
    write(path.join(legacy, '._0451.mp3'), 'sidecar');
    write(path.join(legacy, 'notes.txt'), 'text');
    const scan = await scanLegacyBackups(legacy);
    expect(scan.single.map((s) => s.fileName)).toEqual(['0451.mp3']);
  });

  it('a folder that does not exist is simply empty', async () => {
    expect(await scanLegacyBackups(path.join(tmp, 'nope'))).toEqual({ groups: [], single: [], renamedCount: 0 });
  });
});

describe('migrating', () => {
  it('resolves duplicates by itself and writes a real snapshot', async () => {
    write(path.join(legacy, '0451.mp3'), 'same');
    write(path.join(legacy, '0451 (1).mp3'), 'same');
    write(path.join(legacy, '0452.mp3'), 'other');

    const scan = await scanLegacyBackups(legacy);
    const r = await migrateLegacyBackups({ scan, choices: {}, backupRootDir: backups, penVolumeLabel: 'PONYABC' });

    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(fs.readdirSync(r.snapshotDir).sort()).toEqual(['0451.mp3', '0452.mp3', 'manifest.json']);
    expect(readManifest(r.snapshotDir)?.entries.map((e) => e.fileName)).toEqual(['0451.mp3', '0452.mp3']);
    // The "(1)" name is gone from the result entirely — that was the whole point.
    expect(fs.readdirSync(r.snapshotDir).join(' ')).not.toMatch(/\(\d+\)/);
  });

  it('refuses to guess when two takes genuinely differ', async () => {
    write(path.join(legacy, '0451.mp3'), 'take one');
    write(path.join(legacy, '0451 (1).mp3'), 'take two');

    const scan = await scanLegacyBackups(legacy);
    const r = await migrateLegacyBackups({ scan, choices: {}, backupRootDir: backups, penVolumeLabel: null });

    expect(r).toEqual({ status: 'needs-choices', undecided: ['0451.mp3'] });
  });

  it('honours the user\'s choice of which take to keep', async () => {
    write(path.join(legacy, '0451.mp3'), 'take one');
    write(path.join(legacy, '0451 (1).mp3'), 'take two — the good one');

    const scan = await scanLegacyBackups(legacy);
    const r = await migrateLegacyBackups({
      scan,
      choices: { '0451.mp3': '0451 (1).mp3' },
      backupRootDir: backups,
      penVolumeLabel: null,
    });

    expect(r.status).toBe('ok');
    if (r.status !== 'ok') return;
    expect(fs.readFileSync(path.join(r.snapshotDir, '0451.mp3'), 'utf8')).toBe('take two — the good one');
  });

  it('NEVER deletes or alters the original folder', async () => {
    write(path.join(legacy, '0451.mp3'), 'take one');
    write(path.join(legacy, '0451 (1).mp3'), 'take one');

    const before = fs.readdirSync(legacy).sort();
    const scan = await scanLegacyBackups(legacy);
    await migrateLegacyBackups({ scan, choices: {}, backupRootDir: backups, penVolumeLabel: null });

    expect(fs.readdirSync(legacy).sort()).toEqual(before);
    expect(fs.readFileSync(path.join(legacy, '0451 (1).mp3'), 'utf8')).toBe('take one');
  });

  it('keeps both takes available until the user says otherwise', async () => {
    // Choosing one take does not destroy the other — it stays in the old folder, which is why
    // migration is additive and the user clears up themselves.
    write(path.join(legacy, '0451.mp3'), 'take one');
    write(path.join(legacy, '0451 (1).mp3'), 'take two');

    const scan = await scanLegacyBackups(legacy);
    await migrateLegacyBackups({ scan, choices: { '0451.mp3': '0451.mp3' }, backupRootDir: backups, penVolumeLabel: null });

    expect(fs.readFileSync(path.join(legacy, '0451 (1).mp3'), 'utf8')).toBe('take two');
  });
});
