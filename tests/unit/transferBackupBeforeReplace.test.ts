import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * Keeping the pen's own recordings before replacing any of them.
 *
 * `safeWriteFile` already keeps a loose per-file copy under `userData/backups`. That makes an
 * interrupted write recoverable and is not what this is about: it is not a snapshot, so it never
 * appears in the backups list on My Recordings, and a teacher who has just replaced the wrong
 * recording cannot get the old one back from it.
 *
 * So a batch that will replace anything takes one ordinary snapshot first — the same kind the
 * button takes — and if that cannot be done, nothing is overwritten at all.
 */

const h = vi.hoisted(() => ({ userDataDir: '' }));
vi.mock('electron', () => ({
  app: { getPath: (name: string) => (name === 'userData' ? h.userDataDir : ''), getVersion: () => '0.0.0-test' },
  dialog: { showOpenDialog: vi.fn() },
}));

let tmp: string;
let penDir: string;
let diyDir: string;
let computerDir: string;

beforeEach(async () => {
  vi.resetModules();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'transfer-backup-'));
  h.userDataDir = path.join(tmp, 'userData');
  fs.mkdirSync(h.userDataDir, { recursive: true });
  penDir = path.join(tmp, 'PEN');
  diyDir = path.join(penDir, 'DIY');
  fs.mkdirSync(diyDir, { recursive: true });
  fs.mkdirSync(path.join(penDir, 'BOOK'), { recursive: true });
  computerDir = path.join(tmp, 'computer');
  fs.mkdirSync(computerDir, { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function connect() {
  const session = await import('../../src/main/services/session');
  const { resolvePenRoot } = await import('../../src/main/services/pathSecurity');
  const resolved = resolvePenRoot(penDir);
  if (resolved.status !== 'ok') throw new Error('fixture pen invalid');
  session.setPenRoot(resolved);
  session.setComputerFolder(computerDir);
  return session;
}

const fakeWindow = () => ({ webContents: { send: () => {} } }) as never;

describe('sending recordings that replace what is on the pen', () => {
  it('keeps the pen\'s copies in a backup a teacher can see, labelled with what it protected', async () => {
    const session = await connect();
    const { executeTransferToPen } = await import('../../src/main/ipc/transfer');
    const { listRecordingBackups } = await import('../../src/main/ipc/recordingBackup');

    fs.writeFileSync(path.join(diyDir, '0451.mp3'), 'the take on the pen');
    fs.writeFileSync(path.join(computerDir, '0451.mp3'), 'the new take');

    const summary = await executeTransferToPen(fakeWindow(), {
      fileNames: ['0451.mp3'],
      decisions: { '0451.mp3': 'replace' },
      penGeneration: session.getGeneration(),
    });

    expect(summary.status).toBe('completed');
    const backups = listRecordingBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0].reason).toBe('before-replace');
    expect(backups[0].protecting).toBe('0451.mp3');
    expect(backups[0].recordingCount).toBe(1);
  });

  it('does not name one recording when several are being replaced at once', async () => {
    const session = await connect();
    const { executeTransferToPen } = await import('../../src/main/ipc/transfer');
    const { listRecordingBackups } = await import('../../src/main/ipc/recordingBackup');

    for (const name of ['0451.mp3', '0452.mp3']) {
      fs.writeFileSync(path.join(diyDir, name), `pen ${name}`);
      fs.writeFileSync(path.join(computerDir, name), `new ${name}`);
    }

    await executeTransferToPen(fakeWindow(), {
      fileNames: ['0451.mp3', '0452.mp3'],
      decisions: { '0451.mp3': 'replace', '0452.mp3': 'replace' },
      penGeneration: session.getGeneration(),
    });

    const backups = listRecordingBackups();
    expect(backups[0].reason).toBe('before-replace');
    expect(backups[0].protecting).toBeNull();
  });

  it('takes no snapshot at all when nothing is being replaced', async () => {
    const session = await connect();
    const { executeTransferToPen } = await import('../../src/main/ipc/transfer');
    const { listRecordingBackups } = await import('../../src/main/ipc/recordingBackup');

    fs.writeFileSync(path.join(computerDir, '0452.mp3'), 'a new recording');

    const summary = await executeTransferToPen(fakeWindow(), {
      fileNames: ['0452.mp3'],
      decisions: {},
      penGeneration: session.getGeneration(),
    });

    expect(summary.status).toBe('completed');
    // Adding a recording takes nothing away, so there is nothing to protect.
    expect(listRecordingBackups()).toHaveLength(0);
  });

  it('overwrites nothing when the pen\'s copies could not be kept', async () => {
    const session = await connect();
    const { executeTransferToPen } = await import('../../src/main/ipc/transfer');

    fs.writeFileSync(path.join(diyDir, '0451.mp3'), 'the only copy of this');
    fs.writeFileSync(path.join(computerDir, '0451.mp3'), 'the new take');

    // The snapshot cannot be written: its root is a file, not a directory.
    fs.rmSync(path.join(h.userDataDir, 'RecordingBackups'), { recursive: true, force: true });
    fs.writeFileSync(path.join(h.userDataDir, 'RecordingBackups'), 'not a directory');

    const summary = await executeTransferToPen(fakeWindow(), {
      fileNames: ['0451.mp3'],
      decisions: { '0451.mp3': 'replace' },
      penGeneration: session.getGeneration(),
    });

    expect(summary.status).toBe('backup-failed');
    // The thing that matters: the pen still holds what it held.
    expect(fs.readFileSync(path.join(diyDir, '0451.mp3'), 'utf8')).toBe('the only copy of this');
  });
});
