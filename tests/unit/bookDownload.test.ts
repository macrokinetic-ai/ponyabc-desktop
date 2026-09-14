import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BookCatalogEntry } from '../../src/shared/types';
import { cacheFilePath, cancelDownload, downloadToCache } from '../../src/main/services/bookDownload';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-dl-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function entry(overrides: Partial<BookCatalogEntry> = {}): BookCatalogEntry {
  const bytes = Buffer.from('hello world');
  return {
    contentId: 'b1',
    filename: '0451.axb',
    filenameSource: 'declared',
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    friendlyName: 'Book One',
    friendlyNameI18n: null,
    contentLanguages: [],
    sortOrder: 0,
    updatedAtMs: null,
    downloadUrl: 'https://x.test/download?id=b1',
    ...overrides,
  };
}

function immediateFetch(bytes: Buffer, status = 200): typeof fetch {
  return (async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      { status },
    )) as unknown as typeof fetch;
}

/** A fetch whose response body only emits once `release()` is called — lets a test control
 *  exactly when a download "finishes" relative to a concurrent second call. Abort-aware (like
 *  a real in-flight fetch): if the passed signal aborts before release(), the stream errors
 *  with an AbortError instead of hanging forever, matching what a real aborted network
 *  request does to its response body reader. */
function controllableFetch(bytes: Buffer): { fetchFn: typeof fetch; release: () => void; calls: number[] } {
  const calls: number[] = [];
  let releaseFn: (() => void) | null = null;
  const released = new Promise<void>((resolve) => {
    releaseFn = resolve;
  });
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    calls.push(Date.now());
    const signal = init?.signal;
    return new Response(
      new ReadableStream({
        async start(controller) {
          await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) {
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }
            released.then(resolve);
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
          });
          controller.enqueue(bytes);
          controller.close();
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { fetchFn, release: () => releaseFn?.(), calls };
}

const freeBytesFn = async () => 10_000_000;

describe('downloadToCache', () => {
  it('downloads, verifies size + sha256, and rejects install-eligible-check-failed entries', async () => {
    const cacheDir = mkTempDir();
    const bytes = Buffer.from('hello world');
    const outcome = await downloadToCache({
      entry: entry(),
      cacheDir,
      fetchFn: immediateFetch(bytes),
      getFreeBytesFn: freeBytesFn,
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    const finalPath = cacheFilePath(cacheDir, outcome.cacheEntry.contentId, outcome.cacheEntry.sha256);
    expect(fs.existsSync(finalPath)).toBe(true);
    expect(fs.readFileSync(finalPath, 'utf-8')).toBe('hello world');
    expect(fs.readdirSync(cacheDir).some((f) => f.includes('.ponyabc-dl-'))).toBe(false);
  });

  it('metadata-incomplete refuses to start at all for a non-install-eligible entry (no network call)', async () => {
    const fetchFn = vi.fn();
    const outcome = await downloadToCache({
      entry: entry({ filenameSource: 'fallback-storage-key' }),
      cacheDir: mkTempDir(),
      fetchFn: fetchFn as unknown as typeof fetch,
      getFreeBytesFn: freeBytesFn,
    });
    expect(outcome).toEqual({ status: 'metadata-incomplete' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('hash-mismatch when the downloaded bytes do not match the declared sha256 — no cache file left behind, and reports the actual size/hash', async () => {
    const cacheDir = mkTempDir();
    const actualBytes = Buffer.from('hello world');
    const outcome = await downloadToCache({
      entry: entry({ sha256: 'f'.repeat(64) }),
      cacheDir,
      fetchFn: immediateFetch(actualBytes),
      getFreeBytesFn: freeBytesFn,
    });
    expect(outcome).toEqual({
      status: 'hash-mismatch',
      actualSizeBytes: actualBytes.length,
      actualSha256: crypto.createHash('sha256').update(actualBytes).digest('hex'),
    });
    expect(fs.readdirSync(cacheDir)).toEqual([]);
  });

  it('hash-mismatch reports a null actual hash when the size itself already differs (never hashed)', async () => {
    const cacheDir = mkTempDir();
    const actualBytes = Buffer.from('hello world');
    const outcome = await downloadToCache({
      entry: entry({ sizeBytes: actualBytes.length + 1, sha256: 'f'.repeat(64) }),
      cacheDir,
      fetchFn: immediateFetch(actualBytes),
      getFreeBytesFn: freeBytesFn,
    });
    // The stream never receives the extra declared byte, so it ends naturally rather than
    // tripping the mid-stream "exceeded declared size" guard — the mismatch is only caught
    // at the final size check.
    expect(outcome).toEqual({ status: 'hash-mismatch', actualSizeBytes: actualBytes.length, actualSha256: null });
    expect(fs.readdirSync(cacheDir)).toEqual([]);
  });

  it('aborts if more bytes arrive than the declared size, and leaves no partial file', async () => {
    const cacheDir = mkTempDir();
    const bytes = Buffer.from('hello world');
    const outcome = await downloadToCache({
      entry: entry({ sizeBytes: 3 }), // declares far fewer bytes than the body actually sends
      cacheDir,
      fetchFn: immediateFetch(bytes),
      getFreeBytesFn: freeBytesFn,
    });
    expect(outcome.status).toBe('network-error');
    expect(fs.readdirSync(cacheDir)).toEqual([]);
  });

  it('no-space when free bytes are below the declared size — no network call', async () => {
    const fetchFn = vi.fn();
    const outcome = await downloadToCache({
      entry: entry(),
      cacheDir: mkTempDir(),
      fetchFn: fetchFn as unknown as typeof fetch,
      getFreeBytesFn: async () => 1,
    });
    expect(outcome).toEqual({ status: 'no-space' });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('network-error on a non-ok HTTP response, and on a thrown fetch error', async () => {
    const cacheDir = mkTempDir();
    const badStatus = await downloadToCache({
      entry: entry(),
      cacheDir,
      fetchFn: immediateFetch(Buffer.from('hello world'), 503),
      getFreeBytesFn: freeBytesFn,
    });
    expect(badStatus.status).toBe('network-error');

    const thrown = await downloadToCache({
      entry: entry(),
      cacheDir,
      fetchFn: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
      getFreeBytesFn: freeBytesFn,
    });
    expect(thrown).toEqual({ status: 'network-error', message: 'offline' });
  });

  it('a second call for the same contentId while one is in flight joins the same download — fetch called once', async () => {
    const cacheDir = mkTempDir();
    const { fetchFn, release, calls } = controllableFetch(Buffer.from('hello world'));

    const first = downloadToCache({ entry: entry(), cacheDir, fetchFn, getFreeBytesFn: freeBytesFn });
    const second = downloadToCache({ entry: entry(), cacheDir, fetchFn, getFreeBytesFn: freeBytesFn });
    release();
    const [r1, r2] = await Promise.all([first, second]);

    expect(calls).toHaveLength(1);
    expect(r1.status).toBe('ok');
    expect(r2).toEqual(r1);
  });

  it('a reinstall (forceFresh) call while one is in flight aborts the old one and starts a fresh download', async () => {
    const cacheDir = mkTempDir();
    const first = controllableFetch(Buffer.from('hello world'));

    const firstCall = downloadToCache({ entry: entry(), cacheDir, fetchFn: first.fetchFn, getFreeBytesFn: freeBytesFn });
    // Let the first call actually register itself as in-flight before we force a fresh one.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const second = controllableFetch(Buffer.from('hello world'));
    const secondCall = downloadToCache({ entry: entry(), cacheDir, forceFresh: true, fetchFn: second.fetchFn, getFreeBytesFn: freeBytesFn });
    second.release();

    const secondResult = await secondCall;
    expect(secondResult.status).toBe('ok');
    expect(second.calls).toHaveLength(1);

    first.release(); // let the aborted first call's stream unwind so its promise can settle
    const firstResult = await firstCall;
    expect(firstResult.status).toBe('cancelled');
  });

  it('cancelDownload aborts an in-flight download and returns false when nothing is in flight', async () => {
    const cacheDir = mkTempDir();
    const { fetchFn, release } = controllableFetch(Buffer.from('hello world'));
    const call = downloadToCache({ entry: entry(), cacheDir, fetchFn, getFreeBytesFn: freeBytesFn });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(cancelDownload('b1')).toBe(true);
    release();
    await expect(call).resolves.toEqual({ status: 'cancelled' });

    expect(cancelDownload('b1')).toBe(false);
  });
});
