// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { initI18n } from '../../src/renderer/i18n';
import i18n from '../../src/renderer/i18n';
import { SettingsScreen } from '../../src/renderer/screens/SettingsScreen';
import type { PonyAbcApi } from '../../src/shared/types';

function mockPonyAbc(overrides: Partial<PonyAbcApi> = {}): PonyAbcApi {
  return {
    platform: 'darwin',
    openRegistrationPage: vi.fn(async () => ({ ok: true })),
    openPrivacyPolicyPage: vi.fn(async () => ({ ok: true })),
    openSupportEmail: vi.fn(async () => ({ ok: true })),
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
  void i18n.changeLanguage('en');
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

describe('SettingsScreen — Privacy, Legal & Support', () => {
  it('is visible to an ordinary user with no passcode gate at all', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('Privacy, Legal & Support')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Privacy' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Legal & Copyright' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Contact Support' })).toBeTruthy();
  });

  it('describes real app behavior — network requests, local-only DIY/BOOK storage, and diagnostics — never claims "no data is collected"', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText(/register\.ponyabc\.uk/)).toBeTruthy());
    expect(screen.getByText(/github\.com/)).toBeTruthy();
    expect(screen.getByText(/is ever uploaded anywhere by this app/)).toBeTruthy();
    expect(screen.queryByText(/we (do not|don't) collect any data/i)).toBeNull();
  });

  it('marks unconfirmed company/legal details as "to be confirmed" rather than inventing them', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getAllByText(/to be confirmed/).length).toBeGreaterThan(0));
  });

  it('shows the legal/privacy body text in English even when the UI language is switched, with a translated notice explaining why', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('Privacy, Legal & Support')).toBeTruthy());
    await i18n.changeLanguage('zh-Hant');
    await screen.findByText('私隱、法律與支援'); // chrome is translated
    expect(screen.getByText(/register\.ponyabc\.uk/)).toBeTruthy(); // body stays English
    expect(screen.getByText(/仍待審閱/)).toBeTruthy(); // translated "pending review" notice
  });

  it('"Open full website privacy policy" calls the dedicated privacy-policy opener, never the registration one', async () => {
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByText('Open full website privacy policy'));
    await waitFor(() => expect(window.ponyabc.openPrivacyPolicyPage).toHaveBeenCalled());
    expect(window.ponyabc.openRegistrationPage).not.toHaveBeenCalled();
  });

  it('displays the support email and copies it to the clipboard on request', async () => {
    render(<SettingsScreen />);
    await screen.findByText('marketing@ponyabc.co.uk');
    fireEvent.click(screen.getByText('Copy email address'));
    await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith('marketing@ponyabc.co.uk'));
    await waitFor(() => expect(screen.getByText('Copied!')).toBeTruthy());
  });

  it('"Contact Support" opens a mail draft with a subject naming the app version/platform, never auto-attaching diagnostics or files', async () => {
    render(<SettingsScreen />);
    await waitFor(() => expect(screen.getByText('0.2.2')).toBeTruthy()); // appInfo loaded
    fireEvent.click(await screen.findByRole('button', { name: 'Contact Support' }));
    await waitFor(() => expect(window.ponyabc.openSupportEmail).toHaveBeenCalled());
    const call = (window.ponyabc.openSupportEmail as ReturnType<typeof vi.fn>).mock.calls[0][0] as { subject: string };
    expect(call.subject).toContain('0.2.2');
    expect(call.subject).toContain('darwin');
    expect(call).toEqual({ subject: call.subject }); // no other fields (no file/diagnostics payload)
  });

  it('shows a hint instead of crashing when no mail client is available to handle the support email', async () => {
    window.ponyabc.openSupportEmail = vi.fn(async () => ({ ok: false, error: 'no handler' }));
    render(<SettingsScreen />);
    fireEvent.click(await screen.findByRole('button', { name: 'Contact Support' }));
    await screen.findByText("Couldn't open a mail app automatically — you can copy the address above instead.");
  });
});
