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
  it('finds zero candidates and zero diagnostics on an empty volumes root', () => {
    expect(scanForPenCandidates()).toEqual({ candidates: [], diagnostics: [] });
  });

  it('finds exactly one candidate for a single valid pen volume', () => {
    mkVolume('PONYABC_SD', true);
    const { candidates } = scanForPenCandidates();
    expect(candidates).toHaveLength(1);
    expect(candidates[0].volumeLabel).toBe('PONYABC_SD'); // real OS-reported name, never a hardcoded placeholder
  });

  it('finds multiple candidates when several volumes qualify', () => {
    mkVolume('PenOne', true);
    mkVolume('PenTwo', true);
    const { candidates } = scanForPenCandidates();
    expect(candidates.map((c) => c.volumeLabel).sort()).toEqual(['PenOne', 'PenTwo']);
  });

  it('does not recurse — a nested BOOK/DIY two levels deep is not picked up', () => {
    const decoy = mkVolume('NotAPenAtTopLevel', false);
    fs.mkdirSync(path.join(decoy, 'NestedFolder', 'BOOK'), { recursive: true });
    fs.mkdirSync(path.join(decoy, 'NestedFolder', 'DIY'), { recursive: true });
    const { candidates } = scanForPenCandidates();
    expect(candidates).toEqual([]);
  });

  it('surfaces an unlabeled FAT volume name exactly as the OS reports it (e.g. "NO NAME"), never substituting a hardcoded value', () => {
    mkVolume('NO NAME', true);
    const { candidates } = scanForPenCandidates();
    expect(candidates[0].volumeLabel).toBe('NO NAME');
  });

  it('reports a mounted volume with no BOOK/DIY at all as a missing-both diagnostic, not silently dropped', () => {
    mkVolume('SomeOtherUSBDrive', false);
    const { candidates, diagnostics } = scanForPenCandidates();
    expect(candidates).toEqual([]);
    expect(diagnostics).toEqual([{ volumeLabel: 'SomeOtherUSBDrive', path: path.join(volumesRoot, 'SomeOtherUSBDrive'), reason: 'missing-both' }]);
  });

  it('reports a volume with only BOOK as a missing-diy diagnostic', () => {
    const volPath = path.join(volumesRoot, 'HalfPen');
    fs.mkdirSync(volPath);
    fs.mkdirSync(path.join(volPath, 'BOOK'));
    const { diagnostics } = scanForPenCandidates();
    expect(diagnostics).toEqual([{ volumeLabel: 'HalfPen', path: volPath, reason: 'missing-diy' }]);
  });

  it('reports a volume with only DIY as a missing-book diagnostic', () => {
    const volPath = path.join(volumesRoot, 'HalfPen2');
    fs.mkdirSync(volPath);
    fs.mkdirSync(path.join(volPath, 'DIY'));
    const { diagnostics } = scanForPenCandidates();
    expect(diagnostics).toEqual([{ volumeLabel: 'HalfPen2', path: volPath, reason: 'missing-book' }]);
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
