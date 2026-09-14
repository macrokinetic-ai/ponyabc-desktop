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
    readAudioPreview: vi.fn(async () => ({ status: 'ok', base64: btoa('fake-audio-bytes'), mimeType: 'audio/mpeg', sizeBytes: 17 })),
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
  // jsdom doesn't implement real media playback — stub just enough for useAudioPreview to work.
  window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
  window.HTMLMediaElement.prototype.pause = vi.fn();
  window.HTMLMediaElement.prototype.load = vi.fn();
  URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  URL.revokeObjectURL = vi.fn();
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

    const replaceButton = screen.getByText("Replace this sticker using selected audio…") as HTMLButtonElement;
    expect(replaceButton.disabled).toBe(false);
    fireEvent.click(replaceButton);

    await screen.findByText('Computer: teacher-take.mp3 → Pen DIY: 0001.mp3 (this replaces the audio on the pen)');
  });

  it('clears both checkboxes once the replace completes, but a failed replace leaves them selected for retry', async () => {
    await renderScreen();
    const checkbox = (name: string) =>
      screen.getAllByRole('checkbox').find((el) => (el as HTMLInputElement).closest('li')?.textContent?.includes(name))! as HTMLInputElement;

    fireEvent.click(checkbox('0001.mp3'));
    fireEvent.click(checkbox('teacher-take.mp3'));
    fireEvent.click(screen.getByText("Replace this sticker using selected audio…"));
    await screen.findByText('Computer: teacher-take.mp3 → Pen DIY: 0001.mp3 (this replaces the audio on the pen)');
    fireEvent.click(screen.getByText('Confirm replacement'));
    await waitFor(() => expect(window.ponyabc.executeReplaceSticker).toHaveBeenCalled());

    await waitFor(() => expect(checkbox('0001.mp3').checked).toBe(false));
    expect(checkbox('teacher-take.mp3').checked).toBe(false);
  });

  it('leaves both files selected when the replace fails', async () => {
    window.ponyabc.executeReplaceSticker = vi.fn(async () => ({ status: 'backup-failed', message: 'disk full' }));
    await renderScreen();
    const checkbox = (name: string) =>
      screen.getAllByRole('checkbox').find((el) => (el as HTMLInputElement).closest('li')?.textContent?.includes(name))! as HTMLInputElement;

    fireEvent.click(checkbox('0001.mp3'));
    fireEvent.click(checkbox('teacher-take.mp3'));
    fireEvent.click(screen.getByText("Replace this sticker using selected audio…"));
    await screen.findByText('Computer: teacher-take.mp3 → Pen DIY: 0001.mp3 (this replaces the audio on the pen)');
    fireEvent.click(screen.getByText('Confirm replacement'));
    await waitFor(() => expect(window.ponyabc.executeReplaceSticker).toHaveBeenCalled());

    expect(checkbox('0001.mp3').checked).toBe(true);
    expect(checkbox('teacher-take.mp3').checked).toBe(true);
  });
});

describe('MyRecordingsScreen — selection clears only for resolved items, and stale panels don\'t linger', () => {
  it('save to computer: clears the checkbox for a succeeded file but keeps a failed one selected', async () => {
    window.ponyabc.copyRecordingsToComputer = vi.fn(async () => ({
      status: 'completed',
      succeeded: ['0001.mp3'],
      renamed: [],
      failed: [{ file: '0002.mp3', message: 'disconnected', reason: 'device-changed' }],
    }));
    await renderScreen();
    const checkbox = (name: string) =>
      screen.getAllByRole('checkbox').find((el) => (el as HTMLInputElement).closest('li')?.textContent?.includes(name))! as HTMLInputElement;
    fireEvent.click(checkbox('0001.mp3'));
    fireEvent.click(checkbox('0002.mp3'));
    fireEvent.click(screen.getByText(/Save to computer/));

    await waitFor(() => expect(window.ponyabc.copyRecordingsToComputer).toHaveBeenCalled());
    await waitFor(() => expect(checkbox('0001.mp3').checked).toBe(false));
    expect(checkbox('0002.mp3').checked).toBe(true); // failed — stays selected for retry
  });

  it('send to pen: clears the checkbox for an added file after a completed send', async () => {
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
    const checkbox = (name: string) =>
      screen.getAllByRole('checkbox').find((el) => (el as HTMLInputElement).closest('li')?.textContent?.includes(name))! as HTMLInputElement;
    fireEvent.click(checkbox('teacher-take.mp3'));
    fireEvent.click(screen.getByText(/Send to pen/));
    await screen.findByText(/review before sending/);
    fireEvent.click(screen.getByText('Confirm and send'));

    await waitFor(() => expect(window.ponyabc.executeTransferToPen).toHaveBeenCalled());
    await waitFor(() => expect(checkbox('teacher-take.mp3').checked).toBe(false));
  });

  it('starting a new operation clears an unrelated leftover summary panel from a previous one', async () => {
    window.ponyabc.copyRecordingsToComputer = vi.fn(async () => ({ status: 'completed', succeeded: ['0001.mp3'], renamed: [], failed: [] }));
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
    await renderScreen();
    const checkbox = (name: string) =>
      screen.getAllByRole('checkbox').find((el) => (el as HTMLInputElement).closest('li')?.textContent?.includes(name))! as HTMLInputElement;

    fireEvent.click(checkbox('0001.mp3'));
    fireEvent.click(screen.getByText(/Save to computer/));
    await waitFor(() => expect(window.ponyabc.copyRecordingsToComputer).toHaveBeenCalled());
    await screen.findByText('Copy complete'); // the save-to-computer summary panel is up

    fireEvent.click(checkbox('teacher-take.mp3'));
    fireEvent.click(screen.getByText(/Send to pen/));
    await screen.findByText(/review before sending/);

    expect(screen.queryByText('Copy complete')).toBeNull(); // the stale save summary is gone, not stacked alongside the new plan
  });
});

describe('MyRecordingsScreen — audio preview', () => {
  function previewButton(name: string): HTMLButtonElement {
    return screen
      .getAllByRole('button')
      .find((el) => (el as HTMLButtonElement).closest('li')?.textContent?.includes(name) && /preview/i.test(el.textContent ?? '')) as HTMLButtonElement;
  }

  it('previews a pen file: calls readAudioPreview with the pen source and shows the shared player bar', async () => {
    await renderScreen();
    fireEvent.click(previewButton('0001.mp3'));

    await waitFor(() => expect(window.ponyabc.readAudioPreview).toHaveBeenCalledWith({ source: 'pen', fileName: '0001.mp3' }));
    await waitFor(() => expect(document.querySelector('.audio-preview-bar__filename')?.textContent).toBe('0001.mp3'));
    expect(document.querySelector('.audio-preview-bar__source')?.textContent).toBe('Pen');
    await waitFor(() => expect(previewButton('0001.mp3').textContent).toBe('Stop preview'));
  });

  it('previews a computer file with the computer source label and an encoding-guarantee hint', async () => {
    await renderScreen();
    fireEvent.click(previewButton('teacher-take.mp3'));

    await waitFor(() => expect(window.ponyabc.readAudioPreview).toHaveBeenCalledWith({ source: 'computer', fileName: 'teacher-take.mp3' }));
    await waitFor(() => expect(document.querySelector('.audio-preview-bar__source')?.textContent).toBe('Computer'));
    expect(screen.getByText(/doesn't guarantee the pen can play the same file/)).toBeTruthy();
  });

  it('shows a clear error instead of hanging when the file cannot be read', async () => {
    window.ponyabc.readAudioPreview = vi.fn(async () => ({ status: 'not-found' }));
    await renderScreen();
    fireEvent.click(previewButton('0001.mp3'));

    await screen.findByText('This file is no longer available.');
  });

  it('playing a second file stops the first — only one plays at a time', async () => {
    await renderScreen();
    fireEvent.click(previewButton('0001.mp3'));
    await waitFor(() => expect(previewButton('0001.mp3').textContent).toBe('Stop preview'));

    fireEvent.click(previewButton('0002.mp3'));
    await waitFor(() => expect(previewButton('0002.mp3').textContent).toBe('Stop preview'));
    expect(previewButton('0001.mp3').textContent).toBe('Preview');
    expect(window.ponyabc.readAudioPreview).toHaveBeenCalledTimes(2);
  });

  it('the close button stops playback and hides the player bar', async () => {
    await renderScreen();
    fireEvent.click(previewButton('0001.mp3'));
    await waitFor(() => expect(previewButton('0001.mp3').textContent).toBe('Stop preview'));

    fireEvent.click(screen.getByLabelText('Close preview'));
    expect(document.querySelector('.audio-preview-bar')).toBeNull();
    expect(previewButton('0001.mp3').textContent).toBe('Preview');
  });

  it('stops a pen-source preview when the pen changes (swap/disconnect), releasing it', async () => {
    let volumesChangedListener: (() => void) | null = null;
    window.ponyabc.onPenVolumesChanged = vi.fn((listener: () => void) => {
      volumesChangedListener = listener;
      return () => {};
    });
    await renderScreen();
    fireEvent.click(previewButton('0001.mp3'));
    await waitFor(() => expect(previewButton('0001.mp3').textContent).toBe('Stop preview'));

    window.ponyabc.scanForPenRoot = vi.fn(async () => ({ status: 'ok', path: '/Volumes/OTHERPEN', volumeLabel: 'OTHERPEN', generation: 2, auto: true }));
    window.ponyabc.listDiyRecordings = vi.fn(async () => ({ status: 'ok', diyFolderName: 'DIY', files: [] }));
    volumesChangedListener?.();

    await waitFor(() => expect(document.querySelector('.audio-preview-bar')).toBeNull());
  });
});
