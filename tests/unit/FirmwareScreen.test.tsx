// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { initI18n } from '../../src/renderer/i18n';
import { PenRootProvider } from '../../src/renderer/state/PenRootContext';
import { FirmwareScreen } from '../../src/renderer/screens/FirmwareScreen';
import type { FirmwarePackageInfo, FirmwareProgressEvent, FirmwareUpgradeOutcome, PonyAbcApi } from '../../src/shared/types';

let progressListener: ((event: FirmwareProgressEvent) => void) | null = null;
let outcomeListener: ((event: FirmwareUpgradeOutcome) => void) | null = null;
let navigateMock: ReturnType<typeof vi.fn>;

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
    getOfficialFirmwareRelease: vi.fn(async () => ({ status: 'no-release' }) as const),
    prepareOfficialFirmwarePackage: vi.fn(async () => ({ status: 'no-network', message: 'offline' }) as const),
    onFirmwareDownloadProgress: vi.fn(() => () => {}),
    cancelFirmwareDownload: vi.fn(async () => ({ ok: false })),
    firmwareLastInstalled: vi.fn(async () => null),
    exportFirmwareDiagnostics: vi.fn(async () => ({ status: 'cancelled' }) as const),
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
    getFirmwareRecoveryStatus: vi.fn(async () => ({ status: 'none' }) as const),
    recheckFirmwareRecovery: vi.fn(async () => ({ status: 'none' }) as const),
    ...overrides,
  } as PonyAbcApi;
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  progressListener = null;
  outcomeListener = null;
  navigateMock = vi.fn();
  // @ts-expect-error — test-only global shim for the preload bridge
  window.ponyabc = mockPonyAbc();
});

afterEach(() => {
  cleanup();
});

function renderScreen(overrides: Record<string, unknown> = {}) {
  if (Object.keys(overrides).length > 0) {
    // @ts-expect-error — test-only global shim for the preload bridge
    window.ponyabc = { ...mockPonyAbc(), ...overrides };
  }
  render(
    <PenRootProvider>
      <FirmwareScreen onNavigate={navigateMock} />
    </PenRootProvider>,
  );
}

async function advanceToConfirm() {
  await screen.findByText('Pen detected.');
  fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  await screen.findByRole('heading', { name: 'Firmware package' });
  // The local-folder chooser lives behind the "Advanced / support" disclosure, collapsed by
  // default — this is the exact fix for it no longer being a required, always-visible step.
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Choose folder…' }));
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
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Choose folder…' }));
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
    await screen.findByText('Updating the pen — keep it connected via USB.');
    // The raw log lives behind the collapsed "Technical details" disclosure, not on the main
    // screen — never shown to a teacher unprompted.
    expect(screen.queryByText(/Write sector:147/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await screen.findByText(/Write sector:147/);
    expect(screen.queryByText(/%/)).toBeNull(); // no fabricated percentage anywhere
    expect(screen.getByText('Once the update starts it cannot be stopped. Please wait — it usually takes a few minutes.')).toBeTruthy();
    // No cancel button anywhere on this screen once upgrading has started.
    expect(screen.queryByRole('button', { name: /cancel/i })).toBeNull();
  });

  it('a real "success" outcome (log contains the confirmed signal) shows exactly one calm message, a Finish button, and a Return to Home button — no red title, no other old buttons', async () => {
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
      encodingKnown: true,
      otaTableHadFailures: false,
      sawUfwGenerated: false,
      sawNoLicenseWarning: false,
    });
    await screen.findByText('Your pen is up to date. Please switch it off and on again, then try one of your books.');
    expect(screen.getByRole('button', { name: 'Finish' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Return to Home' })).toBeTruthy();
    // No removed elements: no red "result could not be confirmed" title, no old buttons.
    expect(screen.queryByText('We could not confirm the update finished')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();
    expect(screen.queryByRole('button', { name: /I tested the pen/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /I understand/ })).toBeNull();
  });

  it('a confirmed-terminated "unclear" outcome (no recognized signal) shows the SAME calm single-message/Finish-button UI as success — the neutral "process has finished" text, never the red unclear title', async () => {
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
      encodingKnown: true,
      otaTableHadFailures: false,
      sawUfwGenerated: false,
      sawNoLicenseWarning: false,
    });
    await screen.findByText('The update has finished. Please switch your pen off and on again, then try one of your books.');
    expect(screen.queryByText('We could not confirm the update finished')).toBeNull();
    expect(screen.queryByText('Upgrade completed successfully.')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(window.ponyabc.acknowledgeFirmwareOutcome).toHaveBeenCalled());
    // Finish returns to the wizard's Prepare step — it never quits the app, and never navigates
    // away from the Firmware screen.
    await screen.findByText('Prepare your pen');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('"Return to Home" releases the pending lock the same way Finish does, resets the wizard, and navigates to the Home tab', async () => {
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
      encodingKnown: true,
      otaTableHadFailures: false,
      sawUfwGenerated: false,
      sawNoLicenseWarning: false,
    });
    await screen.findByText('The update has finished. Please switch your pen off and on again, then try one of your books.');

    fireEvent.click(screen.getByRole('button', { name: 'Return to Home' }));
    await waitFor(() => expect(window.ponyabc.acknowledgeFirmwareOutcome).toHaveBeenCalled());
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('home'));
    // The wizard itself is reset behind the scenes too (not just navigated away from) — a later
    // re-entry into the Firmware screen must not land back on this stale result.
    await screen.findByText('Prepare your pen');
  });

  it('"Return to Home" does NOT appear for a failed outcome or for a not-yet-confirmed-terminated outcome', async () => {
    renderScreen();
    await advanceToConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Start upgrade' }));
    await screen.findByRole('heading', { name: 'Upgrading' });
    outcomeListener?.({
      status: 'failed',
      reason: 'declined',
      exitCode: null,
      logExcerpt: '',
      processTerminationConfirmed: true,
      encodingKnown: true,
      otaTableHadFailures: false,
      sawUfwGenerated: false,
      sawNoLicenseWarning: false,
    });
    await screen.findByText('The update did not finish');
    expect(screen.queryByRole('button', { name: 'Return to Home' })).toBeNull();
  });

  it('Finish (from a real "success" outcome) also returns to Prepare, and this run\'s temporary wizard state is cleared so a new attempt starts clean', async () => {
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
      encodingKnown: true,
      otaTableHadFailures: false,
      sawUfwGenerated: false,
      sawNoLicenseWarning: false,
    });
    await screen.findByText('Your pen is up to date. Please switch it off and on again, then try one of your books.');

    fireEvent.click(screen.getByRole('button', { name: 'Finish' }));
    await waitFor(() => expect(window.ponyabc.acknowledgeFirmwareOutcome).toHaveBeenCalled());
    await screen.findByText('Prepare your pen');
    // A fresh "Next" click must not fall straight back into the just-finished package/outcome —
    // this run's packageInfo/outcome/progress were cleared, exactly like "Start over".
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Firmware package' });
    expect(screen.queryByText(/Selected:/)).toBeNull();
  });

  it('a "failed" outcome (e.g. declined UAC) shows its own distinct, truthful message and a "Start over" button — never claims completion', async () => {
    renderScreen();
    await advanceToConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Start upgrade' }));
    await screen.findByRole('heading', { name: 'Upgrading' });

    outcomeListener?.({
      status: 'failed',
      reason: 'declined',
      exitCode: null,
      logExcerpt: '',
      processTerminationConfirmed: true,
      encodingKnown: true,
      otaTableHadFailures: false,
      sawUfwGenerated: false,
      sawNoLicenseWarning: false,
    });
    await screen.findByText('The update did not finish');
    expect(screen.queryByText('Your pen is up to date. Please switch it off and on again, then try one of your books.')).toBeNull();
    expect(screen.queryByText('The update has finished. Please switch your pen off and on again, then try one of your books.')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
  });

  it('a pre-flash cleanup abort explains itself instead of showing the generic failure text', async () => {
    renderScreen();
    await advanceToConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Start upgrade' }));
    await screen.findByRole('heading', { name: 'Upgrading' });

    outcomeListener?.({
      status: 'failed',
      reason: 'preflight-deletion-failed',
      exitCode: null,
      logExcerpt: '1.BIN: EACCES',
      // Nothing was launched, so termination is genuinely confirmed and the pen is untouched.
      processTerminationConfirmed: true,
      encodingKnown: true,
      otaTableHadFailures: false,
      sawUfwGenerated: false,
      sawNoLicenseWarning: false,
    });

    await screen.findByText('The update did not start');
    await screen.findByText('Your pen has not been changed. Please check it is still plugged in and try again.');
    // The generic wording would tell the user nothing about what to do next, and would leave
    // "did not complete" hanging over a pen that was never written to.
    expect(screen.queryByText('The update did not finish')).toBeNull();
    expect(screen.getByRole('button', { name: 'Start over' })).toBeTruthy();
  });

  it('never shows a customer the index filenames or the vendor tool — they are internal', async () => {
    // The wizard handles the cleanup silently. A parent should not meet 1.BIN, BOOKFILE.BIN or
    // the manufacturer's own tool anywhere in this app; that lives in docs/vendor-notes.md.
    renderScreen();
    await advanceToConfirm();
    expect(document.body.textContent).not.toMatch(/1\.BIN|BOOKFILE|vendor tool|manufacturer/i);
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
    await screen.findByText('We could not confirm the update finished');
    // Neither the normal-completion "Finish" button nor "Start over" is offered here — those
    // paths are only for a confirmed-terminated outcome.
    expect(screen.queryByRole('button', { name: 'Finish' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start over' })).toBeNull();

    const restartButton = screen.getByRole('button', { name: 'I understand — I will restart the app' });
    fireEvent.click(restartButton);
    await waitFor(() => expect(window.ponyabc.acknowledgeFirmwareOutcome).toHaveBeenCalled());

    // Clicking through shows the persistent "still locked" notice — never the reset wizard.
    await screen.findByText(
      'Please close PonyABC completely and open it again before using your pen with this app.',
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

const fakeRelease = {
  id: 'rel-1',
  version: 'AC6966-V1.18',
  hardwareRev: 'PENDING-HWREV',
  notes: 'Test release notes.',
  sizeBytes: 49027437,
  sha256: 'abc123',
  minAppVersion: null,
  releasedAt: '2026-09-16T00:00:00.000Z',
  packageLabel: 'AC6966-V1.18 20260316',
  packageDate: '2026-03-16',
  recommended: false,
  downloadUrl: 'https://register.ponyabc.uk/api/public/firmware/download?id=rel-1',
};

describe('FirmwareScreen — official download flow (Windows), simulated release (no real device/flash)', () => {
  it('a published release: download -> prepare -> reach Confirm WITHOUT ever touching the local-folder chooser', async () => {
    window.ponyabc.getOfficialFirmwareRelease = vi.fn(async () => ({ status: 'ok', release: fakeRelease }));
    window.ponyabc.prepareOfficialFirmwarePackage = vi.fn(async () => ({ status: 'ok', packageDir: 'C:\\Users\\teacher\\AppData\\Roaming\\ponyabc-desktop\\firmwareDownloads\\PENDING-HWREV\\AC6966-V1.18\\tools' }));

    renderScreen();
    await screen.findByText('Pen detected.');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Firmware package' });

    // The official release info renders on its own, before any user action.
    await screen.findByText('Official version: AC6966-V1.18');
    await screen.findByText(/AC6966-V1\.18 20260316/);
    await screen.findByText('Test release notes.');

    // The Advanced/support disclosure stays collapsed — its local-folder button never appears.
    expect(screen.queryByRole('button', { name: 'Choose folder…' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Download official update' }));
    await screen.findByText('Ready — click Next to continue.');
    expect(window.ponyabc.prepareOfficialFirmwarePackage).toHaveBeenCalledWith(fakeRelease);
    // Still never touched the local-folder chooser.
    expect(window.ponyabc.selectFirmwarePackage).not.toHaveBeenCalled();

    // A successful download alone does NOT enable Next — the hardware-applicability
    // confirmation gate is a separate, required, explicit step (see the describe block below
    // for the gate's own dedicated tests). Only after explicitly confirming does Next enable.
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: /Confirmed — my pen is hardware version/ }));
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Confirm' });
  });

  it('hardware-applicability confirmation gate: never pre-checked, "not sure" never enables Next, and it can be un-confirmed again', async () => {
    window.ponyabc.getOfficialFirmwareRelease = vi.fn(async () => ({ status: 'ok', release: fakeRelease }));
    window.ponyabc.prepareOfficialFirmwarePackage = vi.fn(async () => ({ status: 'ok', packageDir: 'C:\\pkg' }));
    renderScreen();
    await screen.findByText('Pen detected.');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByText('Official version: AC6966-V1.18');

    // Neither option is pre-selected — the app never defaults to "confirmed" for any pen.
    const confirmedRadio = screen.getByRole('radio', { name: /Confirmed — my pen is hardware version/ }) as HTMLInputElement;
    const notSureRadio = screen.getByRole('radio', { name: 'Not sure' }) as HTMLInputElement;
    expect(confirmedRadio.checked).toBe(false);
    expect(notSureRadio.checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Download official update' }));
    await screen.findByText('Ready — click Next to continue.');

    // Explicitly choosing "not sure" must never enable Next — this is the literal case a
    // connected pen whose hardware version isn't actually known (e.g. a real hardware_rev='v2'
    // pen, which this app cannot distinguish from 'v1' since there is no detection capability)
    // must land in.
    fireEvent.click(notSureRadio);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
    await screen.findByText(
      "Confirm the hardware version above before continuing. If you're not sure, do not proceed — check the pen or contact support.",
    );

    // Confirming enables Next...
    fireEvent.click(confirmedRadio);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(false);

    // ...but switching back to "not sure" disables it again — confirmation isn't a one-way,
    // sticky flag once granted.
    fireEvent.click(notSureRadio);
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('the hardware-applicability gate only applies to the official path — the local-folder (advanced/support) path is unaffected', async () => {
    window.ponyabc.getOfficialFirmwareRelease = vi.fn(async () => ({ status: 'no-release' }));
    renderScreen();
    await advanceToConfirm();
    // advanceToConfirm() (local-folder path) reaching Confirm at all proves this — no hardware
    // radio exists for it to have blocked on, since the notice/gate only renders inside the
    // official-release block.
    expect(screen.queryByRole('radio', { name: /Confirmed — my pen is hardware version/ })).toBeNull();
  });

  it('no published release: shows "no update available" and does NOT fall back to the local-folder chooser — Next stays disabled until the user explicitly opens Advanced/support', async () => {
    window.ponyabc.getOfficialFirmwareRelease = vi.fn(async () => ({ status: 'no-release' }));
    renderScreen();
    await screen.findByText('Pen detected.');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Firmware package' });

    await screen.findByText('No official firmware release has been published yet.');
    expect(screen.queryByRole('button', { name: 'Download official update' })).toBeNull();
    // The disclosure exists but is collapsed — no local-folder button visible without opening it.
    expect(screen.queryByRole('button', { name: 'Choose folder…' })).toBeNull();
    expect((screen.getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a network error checking for the release shows a message distinct from "no release"', async () => {
    window.ponyabc.getOfficialFirmwareRelease = vi.fn(async () => ({ status: 'no-network', message: 'offline' }));
    renderScreen();
    await screen.findByText('Pen detected.');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await screen.findByRole('heading', { name: 'Firmware package' });

    await screen.findByText('Could not reach the update server. Check your internet connection and try again.');
    expect(screen.queryByText('No official firmware release has been published yet.')).toBeNull();
  });
});

const pendingFixture = {
  startedAtMs: 1_700_000_000_000,
  workDir: 'C:\\Users\\teacher\\AppData\\Roaming\\ponyabc-desktop\\firmwareRun',
  packageDir: 'C:\\Users\\teacher\\Desktop\\tools',
  entryBatPath: 'C:\\Users\\teacher\\Desktop\\tools\\download.bat',
};

describe('FirmwareScreen — cross-restart recovery screen (a previous session left an unresolved upgrade)', () => {
  it('"still-running": renders the blocking recovery screen instead of the normal wizard, never the "Prepare your pen" step', async () => {
    window.ponyabc.getFirmwareRecoveryStatus = vi.fn(async () => ({
      status: 'still-running',
      pending: pendingFixture,
      lastCheckedAtMs: 1_700_000_001_000,
    }));
    renderScreen();
    await screen.findByText('An earlier update may still be running');
    expect(
      screen.getByText(
        'An update started earlier is still running on this computer. Please wait for it to finish, or restart the computer, before using your pen with this app.',
      ),
    ).toBeTruthy();
    // The normal wizard must not render underneath/instead — no way to sneak into a new attempt.
    expect(screen.queryByText('Prepare your pen')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('"unknown": distinct body text from "still-running", same blocking behavior', async () => {
    window.ponyabc.getFirmwareRecoveryStatus = vi.fn(async () => ({
      status: 'unknown',
      pending: pendingFixture,
      lastCheckedAtMs: 1_700_000_001_000,
    }));
    renderScreen();
    await screen.findByText('An earlier update may still be running');
    expect(
      screen.getByText(
        'We could not tell whether an earlier update finished. To keep your pen safe, this app will not change anything on it until that is clear.',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Prepare your pen')).toBeNull();
  });

  it('"Check again" calls the real (read-only) recheck IPC and, once it reports clear, unblocks the normal wizard', async () => {
    window.ponyabc.getFirmwareRecoveryStatus = vi.fn(async () => ({
      status: 'still-running',
      pending: pendingFixture,
      lastCheckedAtMs: 1_700_000_001_000,
    }));
    window.ponyabc.recheckFirmwareRecovery = vi.fn(async () => ({ status: 'none' }) as const);
    renderScreen();
    await screen.findByText('An earlier update may still be running');

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(window.ponyabc.recheckFirmwareRecovery).toHaveBeenCalled());

    // Now unblocked — the normal wizard renders.
    await screen.findByText('Prepare your pen');
  });

  it('"Check again" still reporting still-running keeps the blocking screen up — never optimistically clears on its own', async () => {
    window.ponyabc.getFirmwareRecoveryStatus = vi.fn(async () => ({
      status: 'still-running',
      pending: pendingFixture,
      lastCheckedAtMs: 1_700_000_001_000,
    }));
    window.ponyabc.recheckFirmwareRecovery = vi.fn(async () => ({
      status: 'still-running',
      pending: pendingFixture,
      lastCheckedAtMs: 1_700_000_002_000,
    }));
    renderScreen();
    await screen.findByText('An earlier update may still be running');

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(window.ponyabc.recheckFirmwareRecovery).toHaveBeenCalled());

    expect(screen.queryByText('Prepare your pen')).toBeNull();
    await screen.findByText('An earlier update may still be running');
  });

  it('"none" (the common case): the normal wizard renders immediately, no recovery screen at all', async () => {
    window.ponyabc.getFirmwareRecoveryStatus = vi.fn(async () => ({ status: 'none' }) as const);
    renderScreen();
    await screen.findByText('Prepare your pen');
    expect(screen.queryByText('An earlier update may still be running')).toBeNull();
  });
});

/**
 * The version question, asked by the owner after testing rc5: "show the pen's current firmware
 * version if it can be read; if not, say so plainly."
 *
 * It cannot be read. Every scripted path in the vendor toolkit is write-only (traced in
 * firmwareUpgrade.ts, and `penFirmwareVersionVerified` in firmwareSessionLog.ts is a literal
 * `false` so that a future accident is a compile error). So the screen says so, and then says
 * the one thing the app does know: what it installed itself. These tests exist to stop those two
 * claims ever being merged into one.
 */
describe('FirmwareScreen — the version on the pen', () => {
  it('says plainly that the pen does not report its version, before any catalogue answer', async () => {
    renderScreen({ firmwareGetOfficialRelease: vi.fn(async () => ({ status: 'no-network' })) });

    await screen.findByText('The version on your pen');
    await screen.findByText(/does not report which firmware version it is running/);
  });

  it('says so when the app has installed nothing yet, rather than showing a blank', async () => {
    renderScreen({ firmwareLastInstalled: vi.fn(async () => null) });
    await screen.findByText('This app has not installed a firmware version on a pen yet.');
  });

  it('shows what the app itself installed, and says that is not a reading from the pen', async () => {
    renderScreen({
      firmwareLastInstalled: vi.fn(async () => ({ version: 'V1.26', atMs: Date.UTC(2026, 8, 30, 12, 0, 0) })),
    });

    await screen.findByText(/The last version this app installed was V1\.26/);
    // The distinction, in as many words.
    await screen.findByText(/not a reading from the pen in your hand/);
  });
});
