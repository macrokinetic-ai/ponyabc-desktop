import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { downloadFile } from '../../src/main/services/transferService';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-downloadFile-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

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

function neverSettlingFetch(): { fetchFn: typeof fetch } {
  const fetchFn = (async (_url: string, init?: RequestInit) => {
    const signal = init?.signal;
    return new Response(
      new ReadableStream({
        async start(controller) {
          await new Promise<void>((resolve, reject) => {
            if (signal?.aborted) {
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }
            signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            // deliberately never resolves on its own — only the abort listener above settles it
          });
          controller.close();
        },
      }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;
  return { fetchFn };
}

describe('downloadFile', () => {
  it('downloads and verifies size + sha256, leaving the verified bytes at destTmpPath', async () => {
    const dir = mkTempDir();
    const bytes = Buffer.from('hello world');
    const destTmpPath = path.join(dir, 'out.part');
    const outcome = await downloadFile({
      url: 'https://x.test/file',
      destTmpPath,
      expectedSize: bytes.length,
      expectedSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
      signal: new AbortController().signal,
      fetchFn: immediateFetch(bytes),
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.sizeBytes).toBe(bytes.length);
    expect(fs.readFileSync(destTmpPath, 'utf-8')).toBe('hello world');
  });

  it('skips hash verification (size-only) when expectedSha256 is null', async () => {
    const dir = mkTempDir();
    const bytes = Buffer.from('hello world');
    const outcome = await downloadFile({
      url: 'https://x.test/file',
      destTmpPath: path.join(dir, 'out.part'),
      expectedSize: bytes.length,
      expectedSha256: null,
      signal: new AbortController().signal,
      fetchFn: immediateFetch(bytes),
    });
    expect(outcome.status).toBe('ok');
    if (outcome.status !== 'ok') return;
    expect(outcome.sha256).toBe(crypto.createHash('sha256').update(bytes).digest('hex'));
  });

  it('hash-mismatch when the bytes do not match the declared sha256 — tmp file removed', async () => {
    const dir = mkTempDir();
    const bytes = Buffer.from('hello world');
    const destTmpPath = path.join(dir, 'out.part');
    const outcome = await downloadFile({
      url: 'https://x.test/file',
      destTmpPath,
      expectedSize: bytes.length,
      expectedSha256: 'f'.repeat(64),
      signal: new AbortController().signal,
      fetchFn: immediateFetch(bytes),
    });
    expect(outcome).toEqual({
      status: 'hash-mismatch',
      actualSizeBytes: bytes.length,
      actualSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    });
    expect(fs.existsSync(destTmpPath)).toBe(false);
  });

  it('hash-mismatch with a null actual hash when the size itself already differs (never hashed)', async () => {
    const dir = mkTempDir();
    const bytes = Buffer.from('hello world');
    const outcome = await downloadFile({
      url: 'https://x.test/file',
      destTmpPath: path.join(dir, 'out.part'),
      expectedSize: bytes.length + 1,
      expectedSha256: 'f'.repeat(64),
      signal: new AbortController().signal,
      fetchFn: immediateFetch(bytes),
    });
    expect(outcome).toEqual({ status: 'hash-mismatch', actualSizeBytes: bytes.length, actualSha256: null });
  });

  it('network-error on more bytes arriving than the declared size — no partial file left', async () => {
    const dir = mkTempDir();
    const bytes = Buffer.from('hello world');
    const destTmpPath = path.join(dir, 'out.part');
    const outcome = await downloadFile({
      url: 'https://x.test/file',
      destTmpPath,
      expectedSize: 3,
      expectedSha256: null,
      signal: new AbortController().signal,
      fetchFn: immediateFetch(bytes),
    });
    expect(outcome.status).toBe('network-error');
    expect(fs.existsSync(destTmpPath)).toBe(false);
  });

  it('network-error on a non-ok HTTP response, and on a thrown fetch error', async () => {
    const dir = mkTempDir();
    const badStatus = await downloadFile({
      url: 'https://x.test/file',
      destTmpPath: path.join(dir, 'out1.part'),
      expectedSize: 3,
      expectedSha256: null,
      signal: new AbortController().signal,
      fetchFn: immediateFetch(Buffer.from('abc'), 503),
    });
    expect(badStatus.status).toBe('network-error');

    const thrown = await downloadFile({
      url: 'https://x.test/file',
      destTmpPath: path.join(dir, 'out2.part'),
      expectedSize: 3,
      expectedSha256: null,
      signal: new AbortController().signal,
      fetchFn: (async () => {
        throw new Error('offline');
      }) as unknown as typeof fetch,
    });
    expect(thrown).toEqual({ status: 'network-error', message: 'offline' });
  });

  it('cancelled: aborting mid-stream via the signal resolves as cancelled, no partial file left', async () => {
    const dir = mkTempDir();
    const destTmpPath = path.join(dir, 'out.part');
    const controller = new AbortController();
    const { fetchFn } = neverSettlingFetch();

    const promise = downloadFile({
      url: 'https://x.test/file',
      destTmpPath,
      expectedSize: 100,
      expectedSha256: null,
      signal: controller.signal,
      fetchFn,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    const outcome = await promise;
    expect(outcome).toEqual({ status: 'cancelled' });
    expect(fs.existsSync(destTmpPath)).toBe(false);
  });

  it('reports real progress events across downloading/verifying/done', async () => {
    const dir = mkTempDir();
    const bytes = Buffer.from('hello world');
    const phases: string[] = [];
    const outcome = await downloadFile({
      url: 'https://x.test/file',
      destTmpPath: path.join(dir, 'out.part'),
      expectedSize: bytes.length,
      expectedSha256: null,
      signal: new AbortController().signal,
      fetchFn: immediateFetch(bytes),
      onProgress: (e) => phases.push(e.phase),
    });
    expect(outcome.status).toBe('ok');
    expect(phases).toEqual(['downloading', 'downloading', 'verifying', 'done']);
  });
});
