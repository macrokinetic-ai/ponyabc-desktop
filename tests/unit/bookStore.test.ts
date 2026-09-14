import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createJsonStore } from '../../src/main/services/bookStore';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-bookstore-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('createJsonStore', () => {
  it('returns the default value when the file does not exist yet', () => {
    const file = path.join(mkTempDir(), 'sub', 'x.json');
    const store = createJsonStore<{ n: number }>(file, () => ({ n: 0 }));
    expect(store.get()).toEqual({ n: 0 });
  });

  it('persists atomically (temp file + rename) and round-trips through a fresh store instance', () => {
    const file = path.join(mkTempDir(), 'x.json');
    const store = createJsonStore<{ n: number }>(file, () => ({ n: 0 }));
    store.set({ n: 42 });
    expect(fs.existsSync(`${file}.tmp`)).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual({ n: 42 });

    const reloaded = createJsonStore<{ n: number }>(file, () => ({ n: 0 }));
    expect(reloaded.get()).toEqual({ n: 42 });
  });

  it('recovers to the default value on a corrupt file rather than throwing', () => {
    const dir = mkTempDir();
    const file = path.join(dir, 'x.json');
    fs.writeFileSync(file, '{ not valid json');
    const store = createJsonStore<{ n: number }>(file, () => ({ n: -1 }));
    expect(store.get()).toEqual({ n: -1 });
  });

  it('update() reads-modifies-writes through the same in-memory cache', () => {
    const file = path.join(mkTempDir(), 'x.json');
    const store = createJsonStore<number[]>(file, () => []);
    store.update((cur) => [...cur, 1]);
    store.update((cur) => [...cur, 2]);
    expect(store.get()).toEqual([1, 2]);
    expect(JSON.parse(fs.readFileSync(file, 'utf-8'))).toEqual([1, 2]);
  });
});
