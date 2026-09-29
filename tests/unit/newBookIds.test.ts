import { describe, expect, it } from 'vitest';
import { computeNewIds, readSeenIds, writeSeenIds } from '../../src/renderer/screens/newBookIds';

/** A minimal in-memory stand-in for localStorage. */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    _map: map,
  };
}

describe('which books are new to this parent', () => {
  it('badges nothing the first time — 37 badges is noise, not news', () => {
    const { newIds, nextSeen } = computeNewIds(['a', 'b', 'c'], new Set());
    expect([...newIds]).toEqual([]);
    expect([...nextSeen].sort()).toEqual(['a', 'b', 'c']);
  });

  it('badges only what arrived since last time', () => {
    const { newIds } = computeNewIds(['a', 'b', 'c'], new Set(['a', 'b']));
    expect([...newIds]).toEqual(['c']);
  });

  it('clears after being seen — new exactly once', () => {
    const first = computeNewIds(['a', 'b'], new Set(['a']));
    expect([...first.newIds]).toEqual(['b']);

    const second = computeNewIds(['a', 'b'], first.nextSeen);
    expect([...second.newIds]).toEqual([]);
  });

  it('a book leaving and returning to the catalogue is not new again', () => {
    const seen = new Set(['a', 'b']);
    const afterRemoval = computeNewIds(['a'], seen); // b withdrawn
    const afterReturn = computeNewIds(['a', 'b'], afterRemoval.nextSeen);
    expect([...afterReturn.newIds]).toEqual([]);
  });

  it('round-trips through storage', () => {
    const storage = fakeStorage();
    writeSeenIds(['a', 'b'], storage);
    expect([...readSeenIds(storage)].sort()).toEqual(['a', 'b']);
  });

  it('survives storage that is missing, empty or corrupt', () => {
    expect([...readSeenIds(null)]).toEqual([]);
    expect([...readSeenIds(fakeStorage())]).toEqual([]);
    expect([...readSeenIds(fakeStorage({ 'ponyabc.book.seenCatalogIds.v1': 'not json' }))]).toEqual([]);
    expect([...readSeenIds(fakeStorage({ 'ponyabc.book.seenCatalogIds.v1': '{"a":1}' }))]).toEqual([]);
    expect(() => writeSeenIds(['a'], null)).not.toThrow();
  });

  it('ignores non-string entries rather than trusting whatever was stored', () => {
    const storage = fakeStorage({ 'ponyabc.book.seenCatalogIds.v1': '["a",1,null,"b"]' });
    expect([...readSeenIds(storage)].sort()).toEqual(['a', 'b']);
  });
});
