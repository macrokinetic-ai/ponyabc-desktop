// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { initI18n } from '../../src/renderer/i18n';
import { SettingsScreen } from '../../src/renderer/screens/SettingsScreen';
import type { PonyAbcApi } from '../../src/shared/types';

function mockPonyAbc(overrides: Partial<PonyAbcApi> = {}): PonyAbcApi {
  return {
    platform: 'darwin',
    openRegistrationPage: vi.fn(async () => ({ ok: true })),
    scanForPenRoot: vi.fn(async () => ({ status: 'none' })),
    chooseCandidatePenRoot: vi.fn(async () => ({ status: 'none' })),
    selectPenRoot: vi.fn(async () => ({ status: 'cancelled' })),
    listDiyRecordings: vi.fn(async () => ({ status: 'no-pen-selected' })),
    onPenVolumesChanged: vi.fn(() => () => {}),
    selectComputerFolder: vi.fn(async () => ({ status: 'cancelled' })),
    restoreComputerFolder: vi.fn(async () => ({ status: 'none' })),
    listComputerFolder: vi.fn(async () => ({ status: 'no-folder-selected' })),
    copyRecordingsToComputer: vi.fn(async () => ({ status: 'completed', succeeded: [], renamed: [], failed: [] })),
    planTransferToPen: vi.fn(async () => ({ status: 'no-pen-selected' })),
    executeTransferToPen: vi.fn(async () => ({ status: 'no-pen-selected', added: [], replaced: [], skipped: [], failed: [] })),
    planReplaceSticker: vi.fn(async () => ({ status: 'no-pen-selected' })),
    executeReplaceSticker: vi.fn(async () => ({ status: 'error' })),
    onTransferProgress: vi.fn(() => () => {}),
    getSettings: vi.fn(async () => ({ version: 1, locale: 'en', lastPenRootPath: null, lastComputerFolderPath: null })),
    setSettings: vi.fn(async () => ({ version: 1, locale: 'en', lastPenRootPath: null, lastComputerFolderPath: null })),
    getAppInfo: vi.fn(async () => ({ version: '0.2.2', platform: 'darwin', arch: 'arm64' })),
    checkForUpdates: vi.fn(async () => ({ status: 'up-to-date', currentVersion: '0.2.2' })),
    openLatestReleasePage: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  // @ts-expect-error — test-only global shim for the preload bridge
  window.ponyabc = mockPonyAbc();
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(async () => {}) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
});

describe('SettingsScreen — About this App', () => {
  it('shows the actual app version, translated variant label, and raw identifier', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('0.2.2')).toBeTruthy());
    expect(screen.getByText('Mac · Apple Silicon')).toBeTruthy();
    expect(screen.getByText('mac-arm64')).toBeTruthy();
  });

  it('shows Mac · Intel / mac-x64 for an x64 build — even when this reflects Rosetta, not host hardware', async () => {
    window.ponyabc.getAppInfo = vi.fn(async () => ({ version: '0.2.2', platform: 'darwin', arch: 'x64' }));
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('Mac · Intel')).toBeTruthy());
    expect(screen.getByText('mac-x64')).toBeTruthy();
  });

  it('shows Windows · x64 / win-x64 for a win32/x64 build', async () => {
    window.ponyabc.getAppInfo = vi.fn(async () => ({ version: '0.2.2', platform: 'win32', arch: 'x64' }));
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('Windows · x64')).toBeTruthy());
    expect(screen.getByText('win-x64')).toBeTruthy();
  });

  it('copies version info to the clipboard and shows a confirmation', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('0.2.2')).toBeTruthy());

    fireEvent.click(screen.getByText('Copy version info'));

    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalled());
    const copiedText = (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(copiedText).toContain('0.2.2');
    expect(copiedText).toContain('Mac · Apple Silicon');
    expect(copiedText).toContain('mac-arm64');
    await waitFor(() => expect(screen.getByText('Copied!')).toBeTruthy());
  });
});

describe('SettingsScreen — check for updates', () => {
  it('checks automatically on load and shows "up to date" when there is no newer release', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(window.ponyabc.checkForUpdates).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText("You're on the latest version.")).toBeTruthy());
  });

  it('shows the new version and a working download button when an update is available', async () => {
    window.ponyabc.checkForUpdates = vi.fn(async () => ({ status: 'update-available', currentVersion: '0.2.2', latestVersion: 'v0.3.0' }));
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('A new version is available: v0.3.0')).toBeTruthy());

    fireEvent.click(screen.getByText('Go to download page'));
    await waitFor(() => expect(window.ponyabc.openLatestReleasePage).toHaveBeenCalled());
  });

  it('shows a quiet failure message instead of crashing when the check fails (e.g. offline)', async () => {
    window.ponyabc.checkForUpdates = vi.fn(async () => ({ status: 'error', message: 'network error' }));
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText(/Couldn't check for updates/)).toBeTruthy());
  });

  it('re-checks on demand via the "Check for updates" button', async () => {
    const checkForUpdates = vi.fn(async () => ({ status: 'up-to-date' as const, currentVersion: '0.2.2' }));
    window.ponyabc.checkForUpdates = checkForUpdates;
    render(<SettingsScreen />);
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(1)); // the automatic on-load check

    fireEvent.click(screen.getByText('Check for updates'));
    await waitFor(() => expect(checkForUpdates).toHaveBeenCalledTimes(2));
  });
});
