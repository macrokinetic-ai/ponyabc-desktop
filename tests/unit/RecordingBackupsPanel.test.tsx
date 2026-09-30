// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { initI18n } from '../../src/renderer/i18n';
import { RecordingBackupsPanel } from '../../src/renderer/components/RecordingBackupsPanel';

/**
 * The parent-facing half of recordings v2. These assert what the person sees and is asked,
 * not how the files move — that is covered against real directories in recordingSnapshot /
 * recordingRestore / recordingManage.
 */

vi.mock('mpg123-decoder', () => {
  class MockMPEGDecoder {
    ready = Promise.resolve();
    async reset() {}
    free() {}
    decode() {
      return { channelData: [new Float32Array(8000)], samplesDecoded: 8000, sampleRate: 8000, errors: [] };
    }
  }
  return { MPEGDecoder: MockMPEGDecoder };
});

const api = () => window.ponyabc as unknown as Record<string, ReturnType<typeof vi.fn>>;

function mockApi(overrides: Record<string, unknown> = {}) {
  return {
    listDiyRecordings: vi.fn(async () => ({
      status: 'ok',
      diyFolderName: 'DIY',
      files: [{ name: '0451.mp3', sizeBytes: 1000, mtimeMs: 0 }],
    })),
    recordingBackupList: vi.fn(async () => [
      { snapshotId: 's1', createdAtMs: 1_790_000_000_000, penVolumeLabel: 'PEN', recordingCount: 2, reason: 'manual', protecting: null },
    ]),
    recordingBackupContents: vi.fn(async () => ({
      status: 'ok',
      snapshotId: 's1',
      createdAtMs: 1_790_000_000_000,
      reason: 'manual',
      protecting: null,
      entries: [
        { fileName: '0451.mp3', label: 'Grandma reading', sizeBytes: 1_500_000, mtimeMs: 0 },
        { fileName: '0452.mp3', label: null, sizeBytes: 900_000, mtimeMs: 0 },
      ],
    })),
    recordingLabelsGet: vi.fn(async () => ({})),
    recordingLabelSet: vi.fn(async () => ({})),
    recordingBackupCreate: vi.fn(async () => ({ status: 'ok', snapshotId: 's2', recordingCount: 3, dedupedCount: 1, failedCount: 0 })),
    recordingRestorePlan: vi.fn(async () => ({ status: 'ok', snapshotId: 's1', items: [], missingFromBackup: [] })),
    recordingRestoreExecute: vi.fn(async () => ({ status: 'ok', restored: [], replaced: [], skipped: [], unchanged: [], failed: [], penBackupSnapshotId: null })),
    recordingDeleteFromPen: vi.fn(async () => ({ status: 'ok', deleted: ['0451.mp3'], failed: [], backupSnapshotId: 's3' })),
    recordingReassign: vi.fn(async () => ({ status: 'ok', fileName: '0462.mp3', backupSnapshotId: 's3' })),
    readAudioPreview: vi.fn(async () => ({ status: 'ok', base64: btoa('bytes'), mimeType: 'audio/mpeg', sizeBytes: 5 })),
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

async function renderPanel(overrides: Record<string, unknown> = {}) {
  // @ts-expect-error — test-only shim
  window.ponyabc = mockApi(overrides);
  render(<RecordingBackupsPanel />);
  await screen.findByText('On your pen');
}

describe('recordings — backing up', () => {
  it('backs up on one click and says what happened', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Back up my recordings' }));
    await screen.findByText('Backed up 3 recordings.');
    expect(api().recordingBackupCreate).toHaveBeenCalled();
  });

  it('says plainly when there are no backups yet', async () => {
    await renderPanel({ recordingBackupList: vi.fn(async () => []) });
    await screen.findByText('No backups yet. Select Back up my recordings to make one.');
  });
});

describe('recordings — putting them back', () => {
  it('does nothing and says so when the backup is already on the pen', async () => {
    await renderPanel({
      recordingRestorePlan: vi.fn(async () => ({
        status: 'ok',
        snapshotId: 's1',
        items: [{ fileName: '0451.mp3', state: 'identical', label: null, backupSizeBytes: 1, backupMtimeMs: 1, penSizeBytes: 1, penMtimeMs: 1 }],
        missingFromBackup: [],
      })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Put selected recordings back on my pen' }));
    await screen.findByText('Everything in that backup is already on your pen.');
    expect(api().recordingRestoreExecute).not.toHaveBeenCalled();
  });

  it('a clash asks the parent to choose, and will not continue until they have', async () => {
    await renderPanel({
      recordingRestorePlan: vi.fn(async () => ({
        status: 'ok',
        snapshotId: 's1',
        items: [{ fileName: '0451.mp3', state: 'clash', label: 'Grandma, page 12', backupSizeBytes: 400, backupMtimeMs: 1, penSizeBytes: 900, penMtimeMs: 2 }],
        missingFromBackup: [],
      })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Put selected recordings back on my pen' }));

    await screen.findByText('Some of these numbers already have a recording on your pen. Listen to both and choose which one to keep.');
    // Both takes can be heard before deciding — only the person who recorded them can tell.
    // Scoped to the dialog: the pen list behind it has its own Play button per recording.
    const dialog = within(document.querySelector('.plan-panel') as HTMLElement);
    expect(dialog.getAllByRole('button', { name: 'Play' })).toHaveLength(2);
    expect((screen.getByRole('button', { name: 'Put them back' }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('radio', { name: 'Use the one from the backup' }));
    expect((screen.getByRole('button', { name: 'Put them back' }) as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Put them back' }));
    await waitFor(() => expect(api().recordingRestoreExecute).toHaveBeenCalled());
    expect(api().recordingRestoreExecute.mock.calls[0][0].decisions).toEqual({ '0451.mp3': 'replace' });
  });

  it('plays the backup copy from the backup, not from the pen', async () => {
    await renderPanel({
      recordingRestorePlan: vi.fn(async () => ({
        status: 'ok',
        snapshotId: 's1',
        items: [{ fileName: '0451.mp3', state: 'clash', label: null, backupSizeBytes: 1, backupMtimeMs: 1, penSizeBytes: 2, penMtimeMs: 2 }],
        missingFromBackup: [],
      })),
    });
    fireEvent.click(screen.getByRole('button', { name: 'Put selected recordings back on my pen' }));
    await screen.findByText('From the backup:');

    const dialog = within(document.querySelector('.plan-panel') as HTMLElement);
    fireEvent.click(dialog.getAllByRole('button', { name: 'Play' })[0]);
    await waitFor(() => expect(api().readAudioPreview).toHaveBeenCalled());
    expect(api().readAudioPreview.mock.calls[0][0]).toMatchObject({ source: 'backup', snapshotId: 's1', fileName: '0451.mp3' });
  });
});

describe('recordings — changing a sticker', () => {
  it('explains a wrong-length number instead of silently padding it', async () => {
    // 0451 and 00451 may be different stickers, so "451" must never become "0451" for them.
    await renderPanel({ recordingReassign: vi.fn(async () => ({ status: 'rejected', reason: 'invalid-length' })) });
    fireEvent.click(screen.getByRole('button', { name: 'Change sticker number' }));
    fireEvent.change(screen.getByLabelText('New sticker number'), { target: { value: '451' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move it' }));

    await screen.findByText('Please type the number exactly as printed on the sticker, including any zeros at the start.');
  });

  it('sends exactly what was typed', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Change sticker number' }));
    fireEvent.change(screen.getByLabelText('New sticker number'), { target: { value: '00462' } });
    fireEvent.click(screen.getByRole('button', { name: 'Move it' }));

    await waitFor(() => expect(api().recordingReassign).toHaveBeenCalled());
    expect(api().recordingReassign.mock.calls[0][0]).toEqual({ fileName: '0451.mp3', input: '00462' });
  });
});

describe('recordings — naming and deleting', () => {
  it('says a name is only on this computer', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Rename' }));
    await screen.findByText('This name is only on this computer. Your pen always uses the sticker number.');
  });

  it('confirms before deleting, and promises the copy', async () => {
    await renderPanel();
    fireEvent.click(screen.getByRole('button', { name: 'Delete from pen' }));

    await screen.findByText('Delete “0451” from your pen?');
    await screen.findByText('A copy is saved to this computer first, so you can put it back later.');
    expect(api().recordingDeleteFromPen).not.toHaveBeenCalled();

    // The confirm button, not the row button that opened the dialog.
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete from pen' })[1]);
    await waitFor(() => expect(api().recordingDeleteFromPen).toHaveBeenCalled());
  });

  it('offers no way to delete from both sides at once', async () => {
    await renderPanel();
    expect(screen.queryByText(/both/i)).toBeNull();
  });
});

describe('recordings — plain language', () => {
  it('never shows a parent a filename, a hash or a manifest', async () => {
    await renderPanel();
    const text = document.body.textContent ?? '';
    expect(text).not.toMatch(/\.mp3|checksum|hash|SHA-?256|manifest|snapshot|DIY/i);
  });
});

/**
 * What the owner found testing rc5 on a real Windows PC:
 *
 *   "a backup's title says 20 recordings but nothing is listed under it"
 *
 * The count came from the summary; the recordings themselves never left the main process. These
 * tests fail if the list ever goes back to being a promise of contents nobody can see.
 */
describe('recordings — what is inside a backup', () => {
  it('lists every recording in the chosen backup, with its name and size', async () => {
    await renderPanel();

    await screen.findByText('In this backup');
    // The sticker number, because that is what is written on the sticker in their hand.
    expect(screen.getAllByText('0451').length).toBeGreaterThan(0);
    await screen.findByText('0452');
    // The name they gave it, where they gave it one.
    await screen.findByText('Grandma reading');
    await screen.findByText('1.4 MB');
    await screen.findByText('879 KB');
  });

  it('starts with everything ticked, and Select all clears and restores the lot', async () => {
    await renderPanel();
    await screen.findByText('In this backup');

    await screen.findByText('2 chosen');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await screen.findByText('0 chosen');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await screen.findByText('2 chosen');
  });

  it('puts back only what is ticked', async () => {
    await renderPanel();
    await screen.findByText('In this backup');

    // Untick the first recording, leaving one.
    const rows = screen.getAllByRole('checkbox');
    const firstRecording = rows.find((r) => r.closest('li')?.textContent?.includes('Grandma reading'));
    expect(firstRecording).toBeDefined();
    fireEvent.click(firstRecording as HTMLElement);
    await screen.findByText('1 chosen');

    fireEvent.click(screen.getByRole('button', { name: 'Put selected recordings back on my pen' }));

    await waitFor(() =>
      expect(api().recordingRestorePlan).toHaveBeenCalledWith({ snapshotId: 's1', fileNames: ['0452.mp3'] }),
    );
  });

  it('cannot put anything back when nothing is ticked', async () => {
    await renderPanel();
    await screen.findByText('In this backup');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all' }));
    await screen.findByText('0 chosen');

    expect((screen.getByRole('button', { name: 'Put selected recordings back on my pen' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says the older backups are kept, so the list does not look like clutter', async () => {
    await renderPanel();
    await screen.findByText(/Older backups are kept/);
  });
});

describe('recordings — telling the two kinds of backup apart', () => {
  it('names a backup the owner asked for, and one the app took by itself, differently', async () => {
    await renderPanel({
      recordingBackupList: vi.fn(async () => [
        { snapshotId: 's1', createdAtMs: 1_790_000_000_000, penVolumeLabel: 'PEN', recordingCount: 2, reason: 'manual', protecting: null },
        {
          snapshotId: 's2',
          createdAtMs: 1_790_000_100_000,
          penVolumeLabel: 'PEN',
          recordingCount: 2,
          reason: 'before-replace',
          protecting: '0451.mp3',
        },
      ]),
    });

    const options = await screen.findAllByRole('option');
    const text = options.map((o) => o.textContent ?? '');
    expect(text.some((o) => o.startsWith('Backup ·'))).toBe(true);
    expect(text.some((o) => o.includes('Automatic backup before replacing 0451'))).toBe(true);
  });

  it('a backup from before rc6, which carries no reason, reads as one the owner made', async () => {
    await renderPanel({
      recordingBackupList: vi.fn(async () => [
        // No `reason` key at all — exactly what is on disk from rc5 and earlier.
        { snapshotId: 's1', createdAtMs: 1_790_000_000_000, penVolumeLabel: 'PEN', recordingCount: 2 },
      ]),
    });

    const options = await screen.findAllByRole('option');
    expect(options[0].textContent ?? '').toContain('Backup ·');
  });
});

describe('recordings — backing up cannot happen twice', () => {
  it('a double click on Back up my recordings makes one backup, not two', async () => {
    let release: (() => void) | null = null;
    const create = vi.fn(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ status: 'ok', snapshotId: 's9', recordingCount: 3, dedupedCount: 0, failedCount: 0 });
        }),
    );
    await renderPanel({ recordingBackupCreate: create });

    const button = screen.getByRole('button', { name: 'Back up my recordings' });
    fireEvent.click(button);
    // The second half of the double click, while the first is still running.
    fireEvent.click(screen.getByRole('button', { name: 'Backing up your recordings…' }));

    expect(create).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button', { name: 'Backing up your recordings…' }) as HTMLButtonElement).disabled).toBe(true);

    release?.();
    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
  });
});
