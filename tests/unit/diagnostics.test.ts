import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { DiagnosticEntry } from '../../src/shared/types';
import { createJsonStore } from '../../src/main/services/bookStore';
import { appendDiagnostic, redactText } from '../../src/main/services/diagnostics';

const tempDirs: string[] = [];
function mkTempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-diag-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('redactText', () => {
  it('strips a macOS home-directory path', () => {
    expect(redactText('failed at /Users/benny/Documents/secret/file.axb')).toBe('failed at <path>');
  });

  it('strips a Windows home-directory path', () => {
    expect(redactText('at C:\\Users\\benny\\AppData\\Local\\x.tmp')).toBe('at <path>');
  });

  it('strips a bearer token', () => {
    expect(redactText('sent Bearer abc123.def456')).toBe('sent bearer <redacted>');
  });

  it('strips an authorization header line', () => {
    expect(redactText('Authorization: Bearer abc123')).toBe('authorization: <redacted>');
  });

  it('strips a credentialed query parameter', () => {
    expect(redactText('https://x.test/download?id=1&token=SECRET123')).toBe('https://x.test/download?id=1&token=<redacted>');
  });

  it('leaves an ordinary message untouched', () => {
    expect(redactText('Server returned 503.')).toBe('Server returned 503.');
  });
});

describe('appendDiagnostic', () => {
  it('redacts string fields in the detail object before persisting', () => {
    const store = createJsonStore<DiagnosticEntry[]>(path.join(mkTempDir(), 'diagnostics.json'), () => []);
    appendDiagnostic(store, 'catalog-fetch', { message: 'failed reading /Users/benny/x.json', httpStatus: 503 });
    expect(store.get()[0].detail).toEqual({ message: 'failed reading <path>', httpStatus: 503 });
  });

  it('caps the log at the newest 500 entries', () => {
    const store = createJsonStore<DiagnosticEntry[]>(path.join(mkTempDir(), 'diagnostics.json'), () => []);
    for (let i = 0; i < 505; i++) appendDiagnostic(store, 'app-start', { i });
    const entries = store.get();
    expect(entries).toHaveLength(500);
    expect(entries[0].detail.i).toBe(5);
    expect(entries[499].detail.i).toBe(504);
  });
});
