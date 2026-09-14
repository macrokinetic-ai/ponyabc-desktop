import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { currentMountFingerprint, scanForPenCandidates } from '../../src/main/services/volumeDiscovery';

let volumesRoot: string;

beforeEach(() => {
  volumesRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-volumes-'));
  process.env.PONYABC_TEST_VOLUMES_ROOT = volumesRoot;
});

afterEach(() => {
  delete process.env.PONYABC_TEST_VOLUMES_ROOT;
  fs.rmSync(volumesRoot, { recursive: true, force: true });
});

function mkVolume(name: string, withBookDiy: boolean) {
  const volPath = path.join(volumesRoot, name);
  fs.mkdirSync(volPath);
  if (withBookDiy) {
    fs.mkdirSync(path.join(volPath, 'BOOK'));
    fs.mkdirSync(path.join(volPath, 'DIY'));
  }
  return volPath;
}

describe('scanForPenCandidates', () => {
  it('finds zero candidates on an empty volumes root', () => {
    expect(scanForPenCandidates()).toEqual([]);
  });

  it('finds exactly one candidate for a single valid pen volume', () => {
    mkVolume('PONYABC_SD', true);
    const candidates = scanForPenCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].volumeLabel).toBe('PONYABC_SD'); // real OS-reported name, never a hardcoded placeholder
  });

  it('finds multiple candidates when several volumes qualify', () => {
    mkVolume('PenOne', true);
    mkVolume('PenTwo', true);
    const candidates = scanForPenCandidates();
    expect(candidates.map((c) => c.volumeLabel).sort()).toEqual(['PenOne', 'PenTwo']);
  });

  it('ignores a mounted volume that has no BOOK/DIY structure', () => {
    mkVolume('SomeOtherUSBDrive', false);
    expect(scanForPenCandidates()).toEqual([]);
  });

  it('does not recurse — a nested BOOK/DIY two levels deep is not picked up', () => {
    const decoy = mkVolume('NotAPenAtTopLevel', false);
    fs.mkdirSync(path.join(decoy, 'NestedFolder', 'BOOK'), { recursive: true });
    fs.mkdirSync(path.join(decoy, 'NestedFolder', 'DIY'), { recursive: true });
    expect(scanForPenCandidates()).toEqual([]);
  });

  it('surfaces an unlabeled FAT volume name exactly as the OS reports it (e.g. "NO NAME"), never substituting a hardcoded value', () => {
    mkVolume('NO NAME', true);
    const candidates = scanForPenCandidates();
    expect(candidates[0].volumeLabel).toBe('NO NAME');
  });
});

describe('currentMountFingerprint', () => {
  it('changes when a volume is added', () => {
    const before = currentMountFingerprint();
    mkVolume('NewlyPlugged', true);
    const after = currentMountFingerprint();
    expect(after).not.toBe(before);
  });

  it('is stable when nothing changes', () => {
    mkVolume('Stable', true);
    expect(currentMountFingerprint()).toBe(currentMountFingerprint());
  });
});
