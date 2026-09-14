// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { initI18n } from '../../src/renderer/i18n';
import { PenRootProvider } from '../../src/renderer/state/PenRootContext';
import { MyRecordingsScreen } from '../../src/renderer/screens/MyRecordingsScreen';
import type { PonyAbcApi } from '../../src/shared/types';

function mockPonyAbc(): PonyAbcApi {
  return {
    platform: 'darwin',
    openRegistrationPage: vi.fn(async () => ({ ok: true })),
    selectPenRoot: vi.fn(async () => ({ status: 'ok', path: '/Volumes/PEN' })),
    restorePenRoot: vi.fn(async () => ({ status: 'ok', path: '/Volumes/PEN' })),
    listDiyRecordings: vi.fn(async () => ({
      status: 'ok',
      diyFolderName: 'DIY',
      files: [
        { name: '0001.mp3', sizeBytes: 1000, mtimeMs: 0 },
        { name: '0002.mp3', sizeBytes: 2000, mtimeMs: 0 },
      ],
    })),
    chooseSaveDestination: vi.fn(async () => ({ status: 'ok', path: '/Users/test/Desktop' })),
    copyRecordings: vi.fn(async () => ({ status: 'completed', succeeded: [], renamed: [], failed: [] })),
    getSettings: vi.fn(async () => ({ version: 1, locale: 'en', lastPenRootPath: null })),
    setSettings: vi.fn(async () => ({ version: 1, locale: 'en', lastPenRootPath: null })),
    onCopyProgress: vi.fn(() => () => {}),
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
      <MyRecordingsScreen />
    </PenRootProvider>,
  );
  await screen.findByText('0001.mp3');
}

function selectFirstFile() {
  const checkboxes = screen.getAllByRole('checkbox');
  fireEvent.click(checkboxes[1]); // index 0 is "select all"
}

function clickSave() {
  fireEvent.click(screen.getByText(/Save selected to computer/));
}

describe('MyRecordingsScreen — save flow does not get stuck on failure', () => {
  it('recovers (re-enables Save) when chooseSaveDestination rejects', async () => {
    window.ponyabc.chooseSaveDestination = vi.fn(async () => {
      throw new Error('IPC channel disconnected');
    });
    await renderScreen();
    selectFirstFile();
    clickSave();

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());
    const saveButton = screen.getByText(/Save selected to computer/) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });

  it('recovers (re-enables Save) when copyRecordings rejects', async () => {
    window.ponyabc.copyRecordings = vi.fn(async () => {
      throw new Error('main process crashed');
    });
    await renderScreen();
    selectFirstFile();
    clickSave();

    await waitFor(() => expect(screen.getByText(/Something went wrong/)).toBeTruthy());
    const saveButton = screen.getByText(/Save selected to computer/) as HTMLButtonElement;
    expect(saveButton.disabled).toBe(false);
  });
});

describe('MyRecordingsScreen — CopySummary.status is surfaced honestly', () => {
  it('shows the real reason for status "error" instead of a false success', async () => {
    window.ponyabc.copyRecordings = vi.fn(async () => ({
      status: 'error',
      succeeded: [],
      renamed: [],
      failed: [],
      message: 'Expected folder(s) missing on the pen: DIY',
    }));
    await renderScreen();
    selectFirstFile();
    clickSave();

    await waitFor(() => expect(screen.getByText(/Expected folder\(s\) missing on the pen: DIY/)).toBeTruthy());
    expect(screen.queryByText(/0 files saved/)).toBeNull();
  });

  it('shows the on-pen explanation for status "invalid-destination"', async () => {
    window.ponyabc.copyRecordings = vi.fn(async () => ({
      status: 'invalid-destination',
      succeeded: [],
      renamed: [],
      failed: [],
    }));
    await renderScreen();
    selectFirstFile();
    clickSave();

    await waitFor(() => expect(screen.getByText(/can't save recordings back onto the pen/i)).toBeTruthy());
  });

  it('shows the no-destination explanation for status "no-destination-selected"', async () => {
    window.ponyabc.copyRecordings = vi.fn(async () => ({
      status: 'no-destination-selected',
      succeeded: [],
      renamed: [],
      failed: [],
    }));
    await renderScreen();
    selectFirstFile();
    clickSave();

    await waitFor(() => expect(screen.getByText(/Choose a destination folder first/)).toBeTruthy());
  });
});

describe('MyRecordingsScreen — success accounting', () => {
  it('counts renamed files as part of the success total, and keeps the rename detail', async () => {
    window.ponyabc.copyRecordings = vi.fn(async () => ({
      status: 'completed',
      succeeded: ['0001.mp3'],
      renamed: [{ original: '0002.mp3', savedAs: '0002 (1).mp3' }],
      failed: [],
      destinationPath: '/Users/test/Desktop',
    }));
    await renderScreen();
    selectFirstFile();
    clickSave();

    await waitFor(() => expect(screen.getByText(/2 files saved/)).toBeTruthy());
    expect(screen.getByText(/0002\.mp3 → 0002 \(1\)\.mp3/)).toBeTruthy();
  });
});
