// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AddRecordingsPanel } from '../../src/renderer/components/AddRecordingsPanel';
import { initI18n } from '../../src/renderer/i18n';

/**
 * Putting a teacher's own recordings on a pen.
 *
 * The owner asked for this to come out of Advanced tools, because it is what teachers use the app
 * for. What these tests hold onto is the part that can cost someone a recording: a file that would
 * land on a number the pen already has must be called a replacement before anything is copied, and
 * the pen's own copies must be kept first.
 */

const api = () => window.ponyabc as unknown as Record<string, ReturnType<typeof vi.fn>>;

function mockApi(overrides: Record<string, unknown> = {}) {
  return {
    chooseRecordingFiles: vi.fn(async () => ({
      status: 'ok',
      folder: '/Users/teacher/Recordings',
      fileNames: ['0451.mp3', '0452.mp3'],
      rejected: [],
    })),
    planTransferToPen: vi.fn(async () => ({
      status: 'ok',
      toAdd: [{ fileName: '0452.mp3', sizeBytes: 900_000 }],
      conflicts: [{ fileName: '0451.mp3', sizeBytes: 1_000_000, penSizeBytes: 1_100_000 }],
      rejected: [],
      destinationVolumeLabel: 'PEN',
      requiredBytes: 1_900_000,
      freeBytes: 5_000_000_000,
      hasEnoughSpace: true,
      penGeneration: 7,
    })),
    executeTransferToPen: vi.fn(async () => ({
      status: 'completed',
      added: ['0452.mp3'],
      replaced: [{ fileName: '0451.mp3', backupPath: '/b/0451.mp3' }],
      skipped: [],
      failed: [],
    })),
    readAudioPreview: vi.fn(async () => ({ status: 'ok', base64: btoa('bytes'), mimeType: 'audio/mpeg', sizeBytes: 5 })),
    onTransferProgress: vi.fn(() => () => {}),
    ...overrides,
  };
}

beforeAll(async () => {
  await initI18n('en');
});

beforeEach(() => {
  // @ts-expect-error — test-only shim for the preload bridge
  window.ponyabc = mockApi();
  // @ts-expect-error — jsdom has no Web Audio API and these tests never reach playback
  window.AudioContext = class {
    currentTime = 0;
    state = 'running';
    destination = {};
    createBuffer() {
      return { copyToChannel: () => {}, duration: 1 };
    }
    createBufferSource() {
      return { buffer: null, connect: () => {}, start: () => {}, stop: () => {}, disconnect: () => {} };
    }
    async resume() {}
    async close() {}
  };
});

afterEach(cleanup);

function renderPanel(overrides: Record<string, unknown> = {}) {
  // @ts-expect-error — test-only shim
  window.ponyabc = mockApi(overrides);
  const onCopied = vi.fn();
  render(<AddRecordingsPanel penReady penIdentityKey="PEN#7" onCopied={onCopied} />);
  return { onCopied };
}

describe('adding recordings from this computer', () => {
  it('explains the naming rule in plain words, with an example and no file extension', async () => {
    renderPanel();
    await screen.findByText(/four digits, like 0451, or five/);
    // Windows hides file extensions by default, so "name it 0451" is both plainer and what a
    // teacher actually types. The picker adds the rest.
    expect(document.body.textContent).not.toMatch(/\.mp3/);
  });

  it('marks one as new and the other as a replacement, using the main process\'s own plan', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Choose recordings…' }));

    await screen.findByText('WILL REPLACE the recording on your pen');
    await screen.findByText('New');
    // The sticker number, not the file name.
    expect(screen.getAllByText('0451').length).toBeGreaterThan(0);
    expect(screen.queryByText('0451.mp3')).toBeNull();
  });

  it('offers both takes for listening, but only where there is one to compare with', async () => {
    renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Choose recordings…' }));
    await screen.findByText('WILL REPLACE the recording on your pen');

    // Two chosen files, so two "play the computer's copy" buttons; one clash, so one "play the
    // pen's copy".
    expect(screen.getAllByRole('button', { name: 'Play the one on this computer' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Play the one on the pen' })).toHaveLength(1);
  });

  it('says the pen\'s own copies are kept first, and where to find them', async () => {
    renderPanel();
    await screen.findByText(/backed up first, automatically. You will find them under Backups on this computer/);
  });

  it('copies against the plan\'s own pen connection, naming every replacement explicitly', async () => {
    const { onCopied } = renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Choose recordings…' }));
    await screen.findByText('WILL REPLACE the recording on your pen');

    fireEvent.click(screen.getByRole('button', { name: 'Copy to my pen' }));

    await waitFor(() =>
      expect(api().executeTransferToPen).toHaveBeenCalledWith({
        fileNames: ['0451.mp3', '0452.mp3'],
        // Only the clash is a replacement. Nothing else may be overwritten.
        decisions: { '0451.mp3': 'replace' },
        penGeneration: 7,
      }),
    );
    await screen.findByText('Copied 2 recordings to your pen.');
    expect(onCopied).toHaveBeenCalled();
  });

  it('refuses a name that is not a sticker number, and never sends it', async () => {
    renderPanel({
      chooseRecordingFiles: vi.fn(async () => ({
        status: 'ok',
        folder: '/Users/teacher/Recordings',
        fileNames: ['grandma.mp3', '0452.mp3'],
        rejected: [],
      })),
      planTransferToPen: vi.fn(async () => ({
        status: 'ok',
        toAdd: [{ fileName: '0452.mp3', sizeBytes: 900_000 }],
        conflicts: [],
        rejected: [],
        destinationVolumeLabel: 'PEN',
        requiredBytes: 900_000,
        freeBytes: 5_000_000_000,
        hasEnoughSpace: true,
        penGeneration: 7,
      })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose recordings…' }));

    await screen.findByText(/Not a sticker number — rename it to four digits, like 0451/);
    fireEvent.click(screen.getByRole('button', { name: 'Copy to my pen' }));

    await waitFor(() =>
      expect(api().executeTransferToPen).toHaveBeenCalledWith({
        fileNames: ['0452.mp3'],
        decisions: {},
        penGeneration: 7,
      }),
    );
  });

  it('says so, and changes nothing, when the pen\'s copies could not be kept', async () => {
    renderPanel({
      executeTransferToPen: vi.fn(async () => ({ status: 'backup-failed', added: [], replaced: [], skipped: [], failed: [] })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Choose recordings…' }));
    await screen.findByText('WILL REPLACE the recording on your pen');

    fireEvent.click(screen.getByRole('button', { name: 'Copy to my pen' }));
    await screen.findByText(/could not be backed up, so nothing was changed/);
  });

  it('asks for one folder at a time rather than copying half a set', async () => {
    renderPanel({ chooseRecordingFiles: vi.fn(async () => ({ status: 'mixed-folders' })) });
    fireEvent.click(screen.getByRole('button', { name: 'Choose recordings…' }));
    await screen.findByText('Please choose recordings from one folder at a time.');
  });

  it('will not copy before anything has been chosen', async () => {
    renderPanel();
    await screen.findByText('No recordings chosen yet.');
    expect((screen.getByRole('button', { name: 'Copy to my pen' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says plainly that sending a set to many pens is not here yet', async () => {
    renderPanel();
    await screen.findByText(/coming in a later version/);
  });
});
