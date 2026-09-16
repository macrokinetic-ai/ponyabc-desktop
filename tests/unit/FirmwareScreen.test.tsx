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
    getOfficialFirmwareRelease: vi.fn(async () => ({ status: 'no-release' }) as const),
    prepareOfficialFirmwarePackage: vi.fn(async () => ({ status: 'no-network', message: 'offline' }) as const),
    onFirmwareDownloadProgress: vi.fn(() => () => {}),
    cancelFirmwareDownload: vi.fn(async () => ({ ok: false })),
    recordFirmwarePlaybackFeedback: vi.fn(async () => ({ ok: true })),
    exportFirmwareLog: vi.fn(async () => ({ status: 'cancelled' }) as const),
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
  // The local-folder chooser lives behind the "Advanced / support" disclosure, collapsed by
  // default — this is the exact fix for it no longer being a required, always-visible step.
  fireEvent.click(screen.getByRole('button', { name: 'Show' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Test/support: select a local folder…' }));
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
    fireEvent.click(await screen.findByRole('button', { name: 'Show' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Test/support: select a local folder…' }));
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
    await screen.findByText('The upgrade did not start or did not complete.');
    // The machine-readable reason lives behind "Technical details", not on the main screen.
    expect(screen.queryByText('Details: declined')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
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

  it('"I tested the pen" button (unclear + confirmed termination only): records feedback via its OWN separate IPC call, never calls acknowledgeFirmwareOutcome, and does not appear when termination is unconfirmed', async () => {
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
    await screen.findByText('The result could not be confirmed.');

    const feedbackButton = screen.getByRole('button', { name: 'I tested the pen — it plays normally' });
    fireEvent.click(feedbackButton);
    await waitFor(() => expect(window.ponyabc.recordFirmwarePlaybackFeedback).toHaveBeenCalled());
    await screen.findByText('Noted — thank you.');
    // Never touches the real lock-release path — only the explicit acknowledge button does.
    expect(window.ponyabc.acknowledgeFirmwareOutcome).not.toHaveBeenCalled();
  });

  it('"I tested the pen" button does NOT appear when termination is unconfirmed (e.g. timeout) — testing the pen is not evidence the elevated tool has actually stopped', async () => {
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
      encodingKnown: true,
      otaTableHadFailures: false,
      sawUfwGenerated: false,
      sawNoLicenseWarning: false,
    });
    await screen.findByText('The result could not be confirmed.');
    expect(screen.queryByRole('button', { name: 'I tested the pen — it plays normally' })).toBeNull();
  });

  it('Technical details surfaces the non-fatal diagnostics (OTA table FAILs, UFW generated, "no license", unknown encoding) without any of them appearing on the main screen', async () => {
    renderScreen();
    await advanceToConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Start upgrade' }));
    await screen.findByRole('heading', { name: 'Upgrading' });
    outcomeListener?.({
      status: 'success',
      reason: 'log-contains-download-complete-zh',
      exitCode: 0,
      logExcerpt: '下载完成。',
      processTerminationConfirmed: true,
      encodingKnown: false,
      otaTableHadFailures: true,
      sawUfwGenerated: true,
      sawNoLicenseWarning: true,
    });
    await screen.findByText('Upgrade completed successfully.');
    for (const text of [
      "This app could not determine the tool's real text encoding, so some of the text above may not display correctly. It has not been altered — this is a display limitation, not data loss.",
      'The tool\'s output included the message "no license". Its exact meaning in this vendor tool is not yet confirmed.',
      'The capability table above lists some upgrade delivery methods as unavailable for this firmware size — this is expected and does not indicate a failure of this run.',
      'The tool reported generating its packaging file successfully — this is a post-processing step and does not by itself confirm the pen was flashed.',
    ]) {
      expect(screen.queryByText(text)).toBeNull(); // collapsed by default
    }
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    for (const text of [
      "This app could not determine the tool's real text encoding, so some of the text above may not display correctly. It has not been altered — this is a display limitation, not data loss.",
      'The tool\'s output included the message "no license". Its exact meaning in this vendor tool is not yet confirmed.',
      'The capability table above lists some upgrade delivery methods as unavailable for this firmware size — this is expected and does not indicate a failure of this run.',
      'The tool reported generating its packaging file successfully — this is a post-processing step and does not by itself confirm the pen was flashed.',
    ]) {
      await screen.findByText(text);
    }
  });

  it('the "Export log" button saves the log via IPC (with personal-path redaction handled main-process-side, not re-implemented here) and shows the result', async () => {
    window.ponyabc.exportFirmwareLog = vi.fn(async () => ({ status: 'ok', path: 'C:\\Users\\teacher\\Desktop\\log.txt' }));
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
    await screen.findByText('Upgrade completed successfully.');
    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    fireEvent.click(screen.getByRole('button', { name: 'Export log…' }));
    await waitFor(() => expect(window.ponyabc.exportFirmwareLog).toHaveBeenCalledWith('download success'));
    await screen.findByText('Saved to C:\\Users\\teacher\\Desktop\\log.txt');
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
    expect(screen.queryByRole('button', { name: 'Test/support: select a local folder…' })).toBeNull();

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
    expect(screen.queryByRole('button', { name: 'Test/support: select a local folder…' })).toBeNull();
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
    await screen.findByText('Previous upgrade not confirmed finished');
    expect(
      screen.getByText(
        'A firmware upgrade from a previous session appears to still be running outside this app. Restarting this app is not evidence it has stopped. New firmware upgrades and BOOK/DIY pen writes stay blocked, and this app will not attempt to stop the other process itself.',
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
    await screen.findByText('Previous upgrade not confirmed finished');
    expect(
      screen.getByText(
        'This app could not determine whether a firmware upgrade from a previous session has finished. New firmware upgrades and BOOK/DIY pen writes stay blocked until this can be confirmed.',
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
    await screen.findByText('Previous upgrade not confirmed finished');

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
    await screen.findByText('Previous upgrade not confirmed finished');

    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(window.ponyabc.recheckFirmwareRecovery).toHaveBeenCalled());

    expect(screen.queryByText('Prepare your pen')).toBeNull();
    await screen.findByText('Previous upgrade not confirmed finished');
  });

  it('"none" (the common case): the normal wizard renders immediately, no recovery screen at all', async () => {
    window.ponyabc.getFirmwareRecoveryStatus = vi.fn(async () => ({ status: 'none' }) as const);
    renderScreen();
    await screen.findByText('Prepare your pen');
    expect(screen.queryByText('Previous upgrade not confirmed finished')).toBeNull();
  });
});
