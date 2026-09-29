import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  DEFAULT_FIRMWARE_PREFLIGHT_DELETIONS,
  restorePreflightBackups,
  runFirmwarePreflight,
  summarizePreflight,
  summarizeRestore,
} from '../../src/main/services/firmwarePreflight';

/**
 * The rule under test: EVERY firmware upgrade must first delete 1.BIN and BOOKFILE.BIN
 * from the pen's BOOK directory, or the upgrade silently does not take effect
 * (vendor-confirmed, verified on a real pen 2026-09-30).
 *
 * These run against real directories in a temp folder rather than a mocked fs, because
 * the things most likely to be wrong here — FAT's case-insensitivity, not recursing, not
 * touching neighbouring files — are filesystem behaviours, and a mock would simply agree
 * with whatever the implementation assumed.
 */

let tmp: string;

function makePen(opts: { book?: boolean; diy?: boolean } = {}): string {
  const root = path.join(tmp, 'PEN');
  fs.mkdirSync(root, { recursive: true });
  if (opts.book !== false) fs.mkdirSync(path.join(root, 'BOOK'), { recursive: true });
  if (opts.diy !== false) fs.mkdirSync(path.join(root, 'DIY'), { recursive: true });
  return root;
}

const write = (p: string, body = 'x') => fs.writeFileSync(p, body);

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-'));
});
afterEach(() => {
  try {
    fs.chmodSync(path.join(tmp, 'PEN', 'BOOK'), 0o755);
  } catch {
    /* only needed by the permission test */
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('firmware preflight — files present', () => {
  it('deletes exactly 1.BIN and BOOKFILE.BIN and reports both as deleted', () => {
    const root = makePen();
    const book = path.join(root, 'BOOK');
    write(path.join(book, '1.BIN'));
    write(path.join(book, 'BOOKFILE.BIN'));

    const r = runFirmwarePreflight(root);

    expect(r.ok).toBe(true);
    expect(r.deletions.map((d) => d.status)).toEqual(['deleted', 'deleted']);
    expect(fs.existsSync(path.join(book, '1.BIN'))).toBe(false);
    expect(fs.existsSync(path.join(book, 'BOOKFILE.BIN'))).toBe(false);
  });

  it('NEVER touches any other file — books, recordings or DIY', () => {
    const root = makePen();
    const book = path.join(root, 'BOOK');
    write(path.join(book, '1.BIN'));
    write(path.join(book, 'BOOKFILE.BIN'));
    // The files that must survive. A regression here is destructive for a real customer.
    write(path.join(book, 'phonics card.axb'), 'book content');
    write(path.join(book, '2.BIN'), 'not the index');
    write(path.join(book, 'BOOKFILE.BIN.bak'), 'backup');
    write(path.join(root, 'DIY', '0001.MP3'), 'recording');

    const r = runFirmwarePreflight(root);

    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(book, 'phonics card.axb'))).toBe(true);
    expect(fs.existsSync(path.join(book, '2.BIN'))).toBe(true);
    expect(fs.existsSync(path.join(book, 'BOOKFILE.BIN.bak'))).toBe(true);
    expect(fs.existsSync(path.join(root, 'DIY', '0001.MP3'))).toBe(true);
  });

  it('matches case-insensitively, as FAT does, and deletes using the on-disk name', () => {
    const root = makePen();
    const book = path.join(root, 'BOOK');
    write(path.join(book, '1.bin'));
    write(path.join(book, 'BookFile.Bin'));

    const r = runFirmwarePreflight(root);

    expect(r.ok).toBe(true);
    expect(r.deletions.find((d) => d.requested === '1.BIN')?.matched).toBe('1.bin');
    expect(r.deletions.find((d) => d.requested === 'BOOKFILE.BIN')?.matched).toBe('BookFile.Bin');
    expect(fs.readdirSync(book)).toHaveLength(0);
  });

  it('only looks at the BOOK root, never recursively', () => {
    const root = makePen();
    const nested = path.join(root, 'BOOK', 'sub');
    fs.mkdirSync(nested, { recursive: true });
    write(path.join(nested, '1.BIN'), 'somebody content, not the index');

    const r = runFirmwarePreflight(root);

    expect(r.ok).toBe(true);
    expect(r.deletions.every((d) => d.status === 'absent')).toBe(true);
    expect(fs.existsSync(path.join(nested, '1.BIN'))).toBe(true);
  });

  it('ignores a DIRECTORY that happens to be named 1.BIN', () => {
    const root = makePen();
    fs.mkdirSync(path.join(root, 'BOOK', '1.BIN'), { recursive: true });

    const r = runFirmwarePreflight(root);

    expect(r.ok).toBe(true);
    expect(r.deletions.find((d) => d.requested === '1.BIN')?.status).toBe('absent');
    expect(fs.existsSync(path.join(root, 'BOOK', '1.BIN'))).toBe(true);
  });
});

describe('firmware preflight — files absent', () => {
  it('succeeds when neither file exists (a pen that has never held books)', () => {
    const root = makePen();

    const r = runFirmwarePreflight(root);

    expect(r.ok).toBe(true);
    expect(r.deletions.map((d) => d.status)).toEqual(['absent', 'absent']);
  });

  it('succeeds when only one of the two is present', () => {
    const root = makePen();
    write(path.join(root, 'BOOK', 'BOOKFILE.BIN'));

    const r = runFirmwarePreflight(root);

    expect(r.ok).toBe(true);
    expect(r.deletions.find((d) => d.requested === '1.BIN')?.status).toBe('absent');
    expect(r.deletions.find((d) => d.requested === 'BOOKFILE.BIN')?.status).toBe('deleted');
  });
});

describe('firmware preflight — deletion fails', () => {
  // Root can unlink regardless of directory permissions, which would make this assert the
  // opposite of what it claims. Skip rather than silently pass.
  const canTestPermissions = typeof process.getuid === 'function' && process.getuid() !== 0;

  it.skipIf(!canTestPermissions)('ABORTS when a present file cannot be deleted', () => {
    const root = makePen();
    const book = path.join(root, 'BOOK');
    write(path.join(book, '1.BIN'));
    write(path.join(book, 'BOOKFILE.BIN'));
    fs.chmodSync(book, 0o500); // read + execute: can list, cannot unlink

    const r = runFirmwarePreflight(root);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('deletion-failed');
    expect(r.detail).toBeTruthy();
    // Stops at the first failure rather than thrashing the rest.
    expect(r.deletions.filter((d) => d.status === 'failed')).toHaveLength(1);

    fs.chmodSync(book, 0o755);
    // Nothing was removed, so the pen is in a known state and a retry is safe.
    expect(fs.existsSync(path.join(book, '1.BIN'))).toBe(true);
    expect(fs.existsSync(path.join(book, 'BOOKFILE.BIN'))).toBe(true);
  });
});

describe('firmware preflight — wrong drive', () => {
  it('refuses a directory with no BOOK/DIY and deletes nothing', () => {
    const notAPen = path.join(tmp, 'USB-STICK');
    fs.mkdirSync(path.join(notAPen, 'BOOK'), { recursive: true }); // BOOK but no DIY
    write(path.join(notAPen, 'BOOK', '1.BIN'), 'someone else file');

    const r = runFirmwarePreflight(notAPen);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not-a-pen');
    expect(r.deletions).toEqual([]);
    // The whole point: an arbitrary drive keeps its files.
    expect(fs.existsSync(path.join(notAPen, 'BOOK', '1.BIN'))).toBe(true);
  });

  it('refuses a path that does not exist', () => {
    const r = runFirmwarePreflight(path.join(tmp, 'nope'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('not-a-pen');
  });
});

describe('firmware preflight — configuration and reporting', () => {
  it('defaults to exactly the two known files', () => {
    expect([...DEFAULT_FIRMWARE_PREFLIGHT_DELETIONS]).toEqual(['1.BIN', 'BOOKFILE.BIN']);
  });

  it('accepts a per-release list so the vendor can add steps without an app release', () => {
    const root = makePen();
    write(path.join(root, 'BOOK', 'INDEX.DAT'));
    write(path.join(root, 'BOOK', '1.BIN'));

    const r = runFirmwarePreflight(root, ['INDEX.DAT']);

    expect(r.ok).toBe(true);
    expect(fs.existsSync(path.join(root, 'BOOK', 'INDEX.DAT'))).toBe(false);
    // Only what was asked for — 1.BIN was not in this release's list.
    expect(fs.existsSync(path.join(root, 'BOOK', '1.BIN'))).toBe(true);
  });

  it('summarises for the diagnostics log without leaking paths', () => {
    const s = summarizePreflight([
      { requested: '1.BIN', matched: '1.bin', status: 'deleted' },
      { requested: 'BOOKFILE.BIN', matched: null, status: 'absent' },
    ]);
    expect(s).toBe('1.BIN=deleted (as 1.bin), BOOKFILE.BIN=absent');
  });
});

describe('firmware preflight — backup and restore', () => {
  /**
   * Why this exists: nothing in the vendor package can put the pen's index back (verified
   * 2026-09-29 — the package contains no 1.BIN/BOOKFILE.BIN, and download.bat only programs the
   * norflash; the pen's own firmware rebuilds the index). So if an upgrade is abandoned before
   * the flash begins, these copies are the only way the pen gets its books back.
   */

  it('copies each file before deleting it, and reports where', () => {
    const root = makePen();
    const book = path.join(root, 'BOOK');
    const backupDir = path.join(tmp, 'backup');
    write(path.join(book, '1.BIN'), 'old index');
    write(path.join(book, 'BOOKFILE.BIN'), 'old list');

    const r = runFirmwarePreflight(root, DEFAULT_FIRMWARE_PREFLIGHT_DELETIONS, { backupDir });

    expect(r.ok).toBe(true);
    expect(fs.readFileSync(path.join(backupDir, '1.BIN'), 'utf8')).toBe('old index');
    expect(fs.readFileSync(path.join(backupDir, 'BOOKFILE.BIN'), 'utf8')).toBe('old list');
    expect(r.deletions.every((d) => d.status !== 'deleted' || typeof d.backupPath === 'string')).toBe(true);
  });

  it('backs up under the pen\'s own casing, so a restore puts the name back unchanged', () => {
    const root = makePen();
    const backupDir = path.join(tmp, 'backup');
    write(path.join(root, 'BOOK', '1.bin'), 'lowercase on this pen');

    runFirmwarePreflight(root, ['1.BIN'], { backupDir });

    expect(fs.readdirSync(backupDir)).toEqual(['1.bin']);
  });

  it('does NOT delete a file it could not back up', () => {
    const root = makePen();
    const book = path.join(root, 'BOOK');
    write(path.join(book, '1.BIN'), 'precious');
    // A path that cannot be created as a directory — mkdirSync fails, so the backup fails.
    const backupDir = path.join(tmp, 'not-a-dir');
    write(backupDir, 'this is a file');

    const r = runFirmwarePreflight(root, ['1.BIN'], { backupDir });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('deletion-failed');
    expect(r.detail).toMatch(/back up/i);
    // Deleting a file we could not copy would leave the pen with no index and no way back —
    // strictly worse than not upgrading at all.
    expect(fs.readFileSync(path.join(book, '1.BIN'), 'utf8')).toBe('precious');
  });

  it('restores both files exactly as they were', () => {
    const root = makePen();
    const book = path.join(root, 'BOOK');
    const backupDir = path.join(tmp, 'backup');
    write(path.join(book, '1.BIN'), 'old index');
    write(path.join(book, 'BOOKFILE.BIN'), 'old list');

    const r = runFirmwarePreflight(root, DEFAULT_FIRMWARE_PREFLIGHT_DELETIONS, { backupDir });
    expect(fs.existsSync(path.join(book, '1.BIN'))).toBe(false);

    const restore = restorePreflightBackups(book, r.deletions);

    expect(restore.restored.sort()).toEqual(['1.BIN', 'BOOKFILE.BIN']);
    expect(restore.failed).toEqual([]);
    expect(fs.readFileSync(path.join(book, '1.BIN'), 'utf8')).toBe('old index');
    expect(fs.readFileSync(path.join(book, 'BOOKFILE.BIN'), 'utf8')).toBe('old list');
  });

  it('never overwrites an index the new firmware has already rebuilt', () => {
    const root = makePen();
    const book = path.join(root, 'BOOK');
    const backupDir = path.join(tmp, 'backup');
    write(path.join(book, '1.BIN'), 'old index');

    const r = runFirmwarePreflight(root, ['1.BIN'], { backupDir });
    // The pen booted on new firmware and rebuilt its own index before we got here.
    write(path.join(book, '1.BIN'), 'REBUILT BY NEW FIRMWARE');

    const restore = restorePreflightBackups(book, r.deletions);

    expect(restore.restored).toEqual([]);
    expect(restore.skippedPresent).toEqual(['1.BIN']);
    expect(fs.readFileSync(path.join(book, '1.BIN'), 'utf8')).toBe('REBUILT BY NEW FIRMWARE');
  });

  it('restores only what it actually deleted — an absent file is not invented', () => {
    const root = makePen();
    const book = path.join(root, 'BOOK');
    const backupDir = path.join(tmp, 'backup');
    write(path.join(book, '1.BIN'), 'only this one existed');

    const r = runFirmwarePreflight(root, DEFAULT_FIRMWARE_PREFLIGHT_DELETIONS, { backupDir });
    const restore = restorePreflightBackups(book, r.deletions);

    expect(restore.restored).toEqual(['1.BIN']);
    expect(fs.existsSync(path.join(book, 'BOOKFILE.BIN'))).toBe(false);
  });

  it('is a no-op when no backup directory was given', () => {
    const root = makePen();
    const book = path.join(root, 'BOOK');
    write(path.join(book, '1.BIN'), 'gone for good');

    const r = runFirmwarePreflight(root, ['1.BIN']);
    const restore = restorePreflightBackups(book, r.deletions);

    expect(restore.restored).toEqual([]);
    expect(fs.existsSync(path.join(book, '1.BIN'))).toBe(false);
  });

  it('reports a restore failure rather than claiming success', () => {
    const root = makePen();
    const book = path.join(root, 'BOOK');
    const backupDir = path.join(tmp, 'backup');
    write(path.join(book, '1.BIN'), 'old index');

    const r = runFirmwarePreflight(root, ['1.BIN'], { backupDir });
    fs.rmSync(backupDir, { recursive: true, force: true }); // backup lost between delete and restore

    const restore = restorePreflightBackups(book, r.deletions);

    expect(restore.restored).toEqual([]);
    expect(restore.failed).toHaveLength(1);
    expect(summarizeRestore(restore)).toMatch(/FAILED/);
  });

  it('summarises a restore for the log', () => {
    expect(summarizeRestore({ restored: ['1.BIN'], skippedPresent: ['BOOKFILE.BIN'], failed: [] })).toBe(
      'restored 1, skipped 1 (already present)',
    );
  });
});
