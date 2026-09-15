// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { initI18n } from '../../src/renderer/i18n';
import { PenRootProvider } from '../../src/renderer/state/PenRootContext';
import { FirmwareScreen } from '../../src/renderer/screens/FirmwareScreen';
import type { FirmwarePackageInfo, FirmwareProgressEvent, FirmwareUpgradeOutcome, PonyAbcApi } from '../../src/shared/types';

let progressListener: ((event: FirmwareProgressEvent) => void) | null = null;
let outcomeListener: ((event: FirmwareUpgradeOutcome) => void) | null = null;

const validPackage: FirmwarePackageInfo = {
  rootDir: 'C:\\Users\\teacher\\Desktop\\tools',
  entryBatPath: 'C:\\Users\\teacher\\Desktop\\tools\\download.bat',
  looksValid: true,
  missingFiles: [],
};

function mockPonyAbc(overrides: Partial<PonyAbcApi> = {}): PonyAbcApi {
  return {
    platform: 'win32',
    openRegistrationPage: vi.fn(async () => ({ ok: true })),
    openPrivacyPolicyPage: vi.fn(async () => ({ ok: true })),
    openSupportEmail: vi.fn(async () => ({ ok: true })),
    scanForPenRoot: vi.fn(async () => ({ status: 'ok', path: '/Volumes/PEN', volumeLabel: 'PEN', generation: 1, auto: true })),
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
    readAudioPreview: vi.fn(async () => ({ status: 'not-found' })),
    bookList: vi.fn(async () => ({ status: 'ok', penItems: [], catalogItems: [], meta: { fetchedAtMs: null, source: 'none', offline: true, conflicts: [], lastCheck: null } })),
    bookCatalogRefresh: vi.fn(async () => ({ status: 'ok', penItems: [], catalogItems: [], meta: { fetchedAtMs: null, source: 'none', offline: true, conflicts: [], lastCheck: null } })),
    bookAdd: vi.fn(async () => ({ status: 'completed' })),
    bookUpdate: vi.fn(async () => ({ status: 'completed' })),
    bookReinstall: vi.fn(async () => ({ status: 'completed' })),
    bookRemove: vi.fn(async () => ({ status: 'completed', freedBytes: 0 })),
    bookBackups: vi.fn(async () => []),
    bookRestore: vi.fn(async () => ({ status: 'completed' })),
    bookDownloadCancel: vi.fn(async () => ({ ok: true })),
    onBookDownloadProgress: vi.fn(() => () => {}),
    bookDownloadBatch: vi.fn(async () => ({ status: 'started' })),
    bookDownloadBatchCancel: vi.fn(async () => ({ ok: true })),
    onBookDownloadBatchSummary: vi.fn(() => () => {}),
    bookVerifyContent: vi.fn(async () => ({ status: 'started' })),
    bookVerifyCancel: vi.fn(async () => ({ ok: true })),
    onBookVerifyProgress: vi.fn(() => () => {}),
    onBookVerifyUpdate: vi.fn(() => () => {}),
    getDiagnosticsSummary: vi.fn(async () => ({ appVersion: '0.0.0', platform: 'win32', arch: 'x64', entries: [] })),
    exportDiagnostics: vi.fn(async () => ({ status: 'cancelled' })),
    getSettings: vi.fn(async () => ({ version: 1, locale: 'en', lastPenRootPath: null, lastComputerFolderPath: null })),
    setSettings: vi.fn(async () => ({ version: 1, locale: 'en', lastPenRootPath: null, lastComputerFolderPath: null })),
    getAppInfo: vi.fn(async () => ({ version: '0.0.0', platform: 'win32', arch: 'x64' })),
    checkForUpdates: vi.fn(async () => ({ status: 'up-to-date', currentVersion: '0.0.0' })),
    openLatestReleasePage: vi.fn(async () => ({ ok: true })),
    selectFirmwarePackage: vi.fn(async () => ({ status: 'selected', info: validPackage })),
    startFirmwareUpgrade: vi.fn(async () => ({ status: 'started' })),
    onFirmwareProgress: vi.fn((listener) => {
      progressListener = listener;
      return () => {
        progressListener = null;
      };
    }),
    onFirmwareOutcome: vi.fn((listener) => {
      outcomeListener = listener;
      return () => {
        outcomeListener = null;
      };
    }),
    acknowledgeFirmwareOutcome: vi.fn(async () => ({ ok: true, locked: false })),
    isFirmwareUpgradeInProgress: vi.fn(async () => false),
    ...overrides,
  } as PonyAbcApi;
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  progressListener = null;
  outcomeListener = null;
  // @ts-expect-error — test-only global shim for the preload bridge
  window.ponyabc = mockPonyAbc();
});

afterEach(() => {
  cleanup();
});

function renderScreen() {
  render(
    <PenRootProvider>
      <FirmwareScreen />
    </PenRootProvider>,
  );
}

async function advanceToConfirm() {
  await screen.findByText('Pen detected.');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { name: 'Firmware package' });
  fireEvent.click(screen.getByRole('button', { name: 'Select package folder…' }));
  await screen.findByText(/Selected:/);
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { name: 'Confirm' });
}

describe('FirmwareScreen — Mac', () => {
  it('shows the "use Windows" banner and never renders the wizard', async () => {
    window.ponyabc.platform = 'darwin';
    renderScreen();
    await screen.findByText(/PonyABC Desktop app on Windows/);
    expect(screen.queryByText('Prepare your pen')).toBeNull();
  });
});

describe('FirmwareScreen — wizard flow (Windows)', () => {
  it('step 1 is gated on a connected pen', async () => {
    window.ponyabc.scanForPenRoot = vi.fn(async () => ({ status: 'none' }));
    renderScreen();
    await screen.findByText('Connect a pen to continue.');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('an invalid package folder blocks proceeding to Confirm and lists the missing files', async () => {
    window.ponyabc.selectFirmwarePackage = vi.fn(async () => ({
      status: 'selected',
      info: { rootDir: 'C:\\bad', entryBatPath: 'C:\\bad\\download.bat', looksValid: false, missingFiles: ['isd_download.exe', 'download.bat'] },
    }));
    renderScreen();
    await screen.findByText('Pen detected.');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Select package folder…' }));
    await screen.findByText('isd_download.exe');
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reaching Confirm requires an explicit "Start upgrade" click before startFirmwareUpgrade is ever called', async () => {
    renderScreen();
    await advanceToConfirm();
    expect(window.ponyabc.startFirmwareUpgrade).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Start upgrade' }));
    await waitFor(() => expect(window.ponyabc.startFirmwareUpgrade).toHaveBeenCalledWith({ packageDir: validPackage.rootDir }));
  });

  it('once upgrading, real progress phases and real log text render — never a fake percentage', async () => {
    renderScreen();
    await advanceToConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Start upgrade' }));
    await screen.findByRole('heading', { name: 'Upgrading' });

    progressListener?.({ phase: 'tool-running', logTailText: 'start downloading......\nWrite sector:147 146 145' });
    await screen.findByText('Writing to the pen — do not disconnect it…');
    await screen.findByText(/Write sector:147/);
    expect(screen.queryByText(/%/)).toBeNull(); // no fabricated percentage anywhere
    expect(screen.getByText('The upgrade cannot be force-cancelled once it has started.')).toBeTruthy();
    // No cancel button anywhere on this screen once upgrading has started.
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('a real "success" outcome (log contains the confirmed signal) shows the success screen, distinctly from failure/unclear', async () => {
    renderScreen();
    await advanceToConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Start upgrade' }));
    await screen.findByRole('heading', { name: 'Upgrading' });

    outcomeListener?.({
      status: 'success',
      reason: 'log-contains-download-success',
      exitCode: 0,
      logExcerpt: 'download success',
      processTerminationConfirmed: true,
    });
    await screen.findByText('Upgrade completed successfully.');
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
  });

  it('a "failed" outcome (e.g. declined UAC) shows the failed screen, not success', async () => {
    renderScreen();
    await advanceToConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Start upgrade' }));
    await screen.findByRole('heading', { name: 'Upgrading' });

    outcomeListener?.({ status: 'failed', reason: 'declined', exitCode: null, logExcerpt: '', processTerminationConfirmed: true });
    await screen.findByText('The upgrade did not start or did not complete.');
    await screen.findByText('Details: declined');
  });

  it('an "unclear" outcome (no recognized signal) never claims success, and requires explicit acknowledgement before starting over', async () => {
    renderScreen();
    await advanceToConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Start upgrade' }));
    await screen.findByRole('heading', { name: 'Upgrading' });

    outcomeListener?.({
      status: 'unclear',
      reason: 'no-recognized-signal',
      exitCode: 0,
      logExcerpt: 'finished, no signal seen',
      processTerminationConfirmed: true,
    });
    await screen.findByText('The result could not be confirmed.');
    expect(screen.queryByText('Upgrade completed successfully.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull(); // only the explicit acknowledge path is offered

    const ackButton = screen.getByRole('button', { name: 'I understand — result unclear' });
    fireEvent.click(ackButton);
    await waitFor(() => expect(window.ponyabc.acknowledgeFirmwareOutcome).toHaveBeenCalled());
    await screen.findByText('Prepare your pen'); // wizard resets to step 1 only after acknowledgement
  });

  it('an "unclear" outcome whose termination could NOT be confirmed (e.g. a timeout) never offers the normal acknowledge path, never resets the wizard, and stays locked even after the user clicks through', async () => {
    window.ponyabc.acknowledgeFirmwareOutcome = vi.fn(async () => ({ ok: false, locked: true }));
    renderScreen();
    await advanceToConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Start upgrade' }));
    await screen.findByRole('heading', { name: 'Upgrading' });

    outcomeListener?.({
      status: 'unclear',
      reason: 'timeout',
      exitCode: null,
      logExcerpt: 'partial output, then nothing',
      processTerminationConfirmed: false,
    });
    await screen.findByText('The result could not be confirmed.');
    // The normal "I understand — result unclear" acknowledge button (which resets the wizard)
    // must NOT be offered here — that path is only for a confirmed-terminated outcome.
    expect(screen.queryByRole('button', { name: 'I understand — result unclear' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();

    const restartButton = screen.getByRole('button', { name: 'I understand — I will restart the app' });
    fireEvent.click(restartButton);
    await waitFor(() => expect(window.ponyabc.acknowledgeFirmwareOutcome).toHaveBeenCalled());

    // Clicking through shows the persistent "still locked" notice — never the reset wizard.
    await screen.findByText(
      'Noted. This app will stay locked against new firmware upgrades and BOOK/DIY pen writes until you fully quit and reopen it.',
    );
    expect(screen.queryByText('Prepare your pen')).toBeNull();
    expect(screen.queryByRole('button', { name: 'I understand — I will restart the app' })).toBeNull();
  });

  it('double-clicking "Start upgrade" (or a second attempt while one is already running) surfaces "already-in-progress", not a duplicate real run', async () => {
    window.ponyabc.startFirmwareUpgrade = vi.fn(async () => ({ status: 'already-in-progress' }));
    renderScreen();
    await advanceToConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Start upgrade' }));
    await screen.findByText('A firmware upgrade is already in progress.');
    // Still on the Confirm step — never silently advanced to "Upgrading" for a run that didn't
    // actually start.
    expect(screen.queryByRole('heading', { name: 'Upgrading' })).toBeNull();
  });
});
