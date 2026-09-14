// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { initI18n } from '../../src/renderer/i18n';
import { PenRootProvider } from '../../src/renderer/state/PenRootContext';
import { ComputerFolderProvider } from '../../src/renderer/state/ComputerFolderContext';
import { MyRecordingsScreen } from '../../src/renderer/screens/MyRecordingsScreen';
import type { PonyAbcApi } from '../../src/shared/types';

function mockPonyAbc(overrides: Partial<PonyAbcApi> = {}): PonyAbcApi {
  return {
    platform: 'darwin',
    openRegistrationPage: vi.fn(async () => ({ ok: true })),
    scanForPenRoot: vi.fn(async () => ({ status: 'ok', path: '/Volumes/PEN', volumeLabel: 'PEN', generation: 1, auto: true })),
    chooseCandidatePenRoot: vi.fn(async () => ({ status: 'ok', path: '/Volumes/PEN', volumeLabel: 'PEN', generation: 1 })),
    selectPenRoot: vi.fn(async () => ({ status: 'ok', path: '/Volumes/PEN', volumeLabel: 'PEN', generation: 1 })),
    listDiyRecordings: vi.fn(async () => ({
      status: 'ok',
      diyFolderName: 'DIY',
      files: [
        { name: '0001.mp3', sizeBytes: 1000, mtimeMs: 0 },
        { name: '0002.mp3', sizeBytes: 2000, mtimeMs: 0 },
      ],
    })),
    onPenVolumesChanged: vi.fn(() => () => {}),
    selectComputerFolder: vi.fn(async () => ({ status: 'ok', path: '/Users/teacher/Desktop' })),
    restoreComputerFolder: vi.fn(async () => ({ status: 'ok', path: '/Users/teacher/Desktop' })),
    listComputerFolder: vi.fn(async () => ({
      status: 'ok',
      folderPath: '/Users/teacher/Desktop',
      files: [{ name: 'teacher-take.mp3', sizeBytes: 500, mtimeMs: 0 }],
    })),
    copyRecordingsToComputer: vi.fn(async () => ({ status: 'completed', succeeded: [], renamed: [], failed: [] })),
    planTransferToPen: vi.fn(async () => ({
      status: 'ok',
      toAdd: [],
      conflicts: [],
      rejected: [],
      destinationVolumeLabel: 'PEN',
      requiredBytes: 0,
      freeBytes: 1000,
      hasEnoughSpace: true,
      penGeneration: 1,
    })),
    executeTransferToPen: vi.fn(async () => ({ status: 'completed', added: [], replaced: [], skipped: [], failed: [] })),
    planReplaceSticker: vi.fn(async () => ({
      status: 'ok',
      penFileName: '0001.mp3',
      penFileSizeBytes: 1000,
      computerFileName: 'teacher-take.mp3',
      computerFileSizeBytes: 500,
      penGeneration: 1,
    })),
    executeReplaceSticker: vi.fn(async () => ({ status: 'completed', backupPath: '/backups/0001.mp3' })),
    onTransferProgress: vi.fn(() => () => {}),
    getSettings: vi.fn(async () => ({ version: 1, locale: 'en', lastPenRootPath: null, lastComputerFolderPath: null })),
    setSettings: vi.fn(async () => ({ version: 1, locale: 'en', lastPenRootPath: null, lastComputerFolderPath: null })),
    ...overrides,
  };
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  // @ts-expect-error — test-only global shim for the preload bridge
  window.ponyabc = mockPonyAbc();
});

afterEach(() => {
  cleanup();
});

async function renderScreen() {
  render(
    <PenRootProvider>
      <ComputerFolderProvider>
        <MyRecordingsScreen />
      </ComputerFolderProvider>
    </PenRootProvider>,
  );
  await screen.findByText('0001.mp3');
  await screen.findByText('teacher-take.mp3');
}

describe('MyRecordingsScreen — dual pane basics', () => {
  it('renders both panes and lists files independently', async () => {
    await renderScreen();
    expect(screen.getByText('0001.mp3')).toBeTruthy();
    expect(screen.getByText('0002.mp3')).toBeTruthy();
    expect(screen.getByText('teacher-take.mp3')).toBeTruthy();
  });

  it('right pane still works when no pen is connected, but pen-dependent actions are disabled', async () => {
    window.ponyabc.scanForPenRoot = vi.fn(async () => ({ status: 'none' }));
    render(
      <PenRootProvider>
        <ComputerFolderProvider>
          <MyRecordingsScreen />
        </ComputerFolderProvider>
      </PenRootProvider>,
    );
    await screen.findByText('teacher-take.mp3'); // computer pane still populated
    const saveButton = screen.getByText(/Save to computer/) as HTMLButtonElement;
    const sendButton = screen.getByText(/Send to pen/) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
    expect(sendButton.disabled).toBe(true);
  });
});

describe('MyRecordingsScreen — save to computer does not get stuck on failure', () => {
  it('re-enables after copyRecordingsToComputer rejects', async () => {
    window.ponyabc.copyRecordingsToComputer = vi.fn(async () => {
      throw new Error('IPC crashed');
    });
    await renderScreen();
    fireEvent.click(screen.getAllByRole('checkbox').find((el) => (el as HTMLInputElement).closest('li')?.textContent?.includes('0001.mp3'))!);
    fireEvent.click(screen.getByText(/Save to computer/));

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());
    const saveButton = screen.getByText(/Save to computer/) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false); // selection still present, not stuck busy
  });
});

describe('MyRecordingsScreen — send-to-pen conflict plan', () => {
  it('requires an explicit decision for every conflict before confirming', async () => {
    window.ponyabc.planTransferToPen = vi.fn(async () => ({
      status: 'ok',
      toAdd: [],
      conflicts: [{ fileName: 'teacher-take.mp3', sourceSizeBytes: 500, existingSizeBytes: 400 }],
      rejected: [],
      destinationVolumeLabel: 'PEN',
      requiredBytes: 500,
      freeBytes: 100000,
      hasEnoughSpace: true,
      penGeneration: 1,
    }));
    await renderScreen();
    fireEvent.click(screen.getAllByRole('checkbox').find((el) => (el as HTMLInputElement).closest('li')?.textContent?.includes('teacher-take.mp3'))!);
    fireEvent.click(screen.getByText(/Send to pen/));

    await screen.findByText(/review before sending/);
    const confirmButton = screen.getByText('Confirm and send') as HTMLButtonElement;
    expect(confirmButton.disabled).toBe(true); // no decision made yet — must not be sendable

    const replaceRadio = screen.getAllByLabelText('Replace')[0];
    fireEvent.click(replaceRadio);
    expect((screen.getByText('Confirm and send') as HTMLButtonElement).disabled).toBe(false);
  });

  it('sends the request and shows the summary once confirmed', async () => {
    window.ponyabc.planTransferToPen = vi.fn(async () => ({
      status: 'ok',
      toAdd: [{ fileName: 'teacher-take.mp3', sizeBytes: 500 }],
      conflicts: [],
      rejected: [],
      destinationVolumeLabel: 'PEN',
      requiredBytes: 500,
      freeBytes: 100000,
      hasEnoughSpace: true,
      penGeneration: 1,
    }));
    window.ponyabc.executeTransferToPen = vi.fn(async () => ({
      status: 'completed',
      added: ['teacher-take.mp3'],
      replaced: [],
      skipped: [],
      failed: [],
      backupFolder: '/backups/batch1',
    }));
    await renderScreen();
    fireEvent.click(screen.getAllByRole('checkbox').find((el) => (el as HTMLInputElement).closest('li')?.textContent?.includes('teacher-take.mp3'))!);
    fireEvent.click(screen.getByText(/Send to pen/));
    await screen.findByText(/review before sending/);
    fireEvent.click(screen.getByText('Confirm and send'));

    await waitFor(() => expect(window.ponyabc.executeTransferToPen).toHaveBeenCalled());
    await screen.findByText('Send complete');
  });
});

describe('MyRecordingsScreen — replace sticker', () => {
  it('shows the exact confirmation text with the pen filename as the write target', async () => {
    await renderScreen();
    fireEvent.click(screen.getAllByRole('checkbox').find((el) => (el as HTMLInputElement).closest('li')?.textContent?.includes('0001.mp3'))!);
    fireEvent.click(screen.getAllByRole('checkbox').find((el) => (el as HTMLInputElement).closest('li')?.textContent?.includes('teacher-take.mp3'))!);

    const replaceButton = screen.getByText("Replace this sticker's audio") as HTMLButtonElement;
    expect(replaceButton.disabled).toBe(false);
    fireEvent.click(replaceButton);

    await screen.findByText('teacher-take.mp3 → Pen DIY/0001.mp3, replacing the original audio');
  });
});
