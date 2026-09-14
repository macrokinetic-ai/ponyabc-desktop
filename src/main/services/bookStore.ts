import fs from 'node:fs';
import path from 'node:path';

/**
 * Generic JSON-manifest persistence: temp-file write + atomic rename, cached in memory.
 * Same pattern as settingsStore.ts, factored out so the BOOK feature's three manifests
 * (catalog snapshot, download-cache index, backup index) share one implementation instead
 * of a new dependency (no sqlite needed for a dataset of a few hundred small records).
 */
export function createJsonStore<T>(filePath: string, defaultValue: () => T) {
  let cache: T | null = null;
  let loaded = false;

  function load(): T {
    if (loaded) return cache as T;
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      cache = JSON.parse(raw) as T;
    } catch {
      cache = defaultValue();
    }
    loaded = true;
    return cache as T;
  }

  function persist(value: T): void {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const tmpPath = `${filePath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(value, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  }

  function get(): T {
    return load();
  }

  function set(value: T): T {
    cache = value;
    loaded = true;
    persist(value);
    return value;
  }

  function update(fn: (current: T) => T): T {
    return set(fn(load()));
  }

  return { get, set, update };
}

export type JsonStore<T> = ReturnType<typeof createJsonStore<T>>;
