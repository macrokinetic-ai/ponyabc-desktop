import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  openExternal: vi.fn(async () => {}),
  getVersion: vi.fn(() => '1.0.0'),
}));
vi.mock('electron', () => ({
  app: { getVersion: h.getVersion },
  shell: { openExternal: h.openExternal },
}));

import { checkForUpdates, openLatestReleasePage } from '../../src/main/ipc/updates';

const originalFetch = global.fetch;

beforeEach(() => {
  h.openExternal.mockClear();
  h.openExternal.mockResolvedValue(undefined);
  h.getVersion.mockReturnValue('1.0.0');
  delete (process as { windowsStore?: boolean }).windowsStore;
});

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = originalFetch;
  delete (process as { windowsStore?: boolean }).windowsStore;
});

describe('checkForUpdates', () => {
  it('returns store-managed immediately, without ever calling fetch, when process.windowsStore is true', async () => {
    (process as { windowsStore?: boolean }).windowsStore = true;
    const fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await checkForUpdates();

    expect(result).toEqual({ status: 'store-managed' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('still checks GitHub Releases normally when process.windowsStore is not set (the NSIS/mac builds)', async () => {
    const fetchSpy = vi.fn(async () => ({
      ok: true,
      json: async () => ({ tag_name: 'v1.0.0' }),
    }));
    global.fetch = fetchSpy as unknown as typeof fetch;

    const result = await checkForUpdates();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: 'up-to-date', currentVersion: '1.0.0' });
  });
});

describe('openLatestReleasePage', () => {
  it('still opens the GitHub releases page — unaffected by process.windowsStore (only checkForUpdates short-circuits)', async () => {
    (process as { windowsStore?: boolean }).windowsStore = true;
    const result = await openLatestReleasePage();
    expect(result).toEqual({ ok: true });
    expect(h.openExternal).toHaveBeenCalledWith('https://github.com/macrokinetic-ai/ponyabc-desktop/releases/latest');
  });
});
