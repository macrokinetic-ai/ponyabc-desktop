import { describe, expect, it } from 'vitest';

import { catalogueHeaders, isCatalogueUrl, CATALOGUE_ORIGIN } from '../../src/main/services/catalogueRequest';
import { getOfficialFirmwareRelease } from '../../src/main/services/firmwareCatalog/httpClient';
import { APP_VERSION_HEADER } from '../../src/shared/contentContract';
import { TESTER_KEY_HEADER } from '../../src/main/internal';

/**
 * The bug this file exists for.
 *
 * 0.3.17 sent `X-PonyABC-App-Version` on the BOOK catalogue request and **nowhere else**. The
 * server never offers firmware to a caller that has not said it is new enough to handle it, so
 * 0.3.17 could never be offered a firmware update however the catalogue was configured — and
 * nothing failed, which is why it went unnoticed for a whole release. The responses below are
 * the REAL ones, recorded from https://register.ponyabc.uk on 2026-10-04 while V1.26 was hidden.
 */

const REAL_RELEASE = {
  id: '6a3cc336-23b1-40d5-bf03-b9cb23457798',
  version: 'AC6966-V1.26',
  hardwareRev: 'v1',
  notes: 'Needs the BIN preflight: BOOK/1.BIN and BOOK/BOOKFILE.BIN must be deleted from the pen before flashing, and restored if the flash never starts.',
  sizeBytes: 49605426,
  sha256: '14cc6ca6e86badc95c0f96f3b55d5f836c83461d3d37870aa18486efa2adbeef',
  minAppVersion: '0.3.17',
  releasedAt: null,
  packageLabel: 'pen-AC6966-V1.26-20260924-vddio-3400-Rectail-500-pause-bnf-ble-SD',
  packageDate: '2026-09-24',
  recommended: false,
  downloadUrl: 'https://register.ponyabc.uk/api/public/firmware/download?id=6a3cc336-23b1-40d5-bf03-b9cb23457798',
};

/** A fetch that answers the way the live server does, and records what it was asked. */
function serverLike() {
  const seen: { url: string; headers: Record<string, string> }[] = [];
  const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const headers = Object.fromEntries(
      Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    seen.push({ url, headers });

    // The server's own rule: firmware is offered only to a caller that says it is 0.3.17 or
    // newer, and a HIDDEN release additionally needs the tester key.
    const version = headers[APP_VERSION_HEADER.toLowerCase()];
    const key = TESTER_KEY_HEADER ? headers[TESTER_KEY_HEADER.toLowerCase()] : undefined;
    const newEnough = typeof version === 'string' && version >= '0.3.17';
    const release = newEnough && key === 'the-tester-key' ? REAL_RELEASE : null;

    return new Response(JSON.stringify({ release }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  return { fetchFn, seen };
}

describe('the firmware request identifies this build', () => {
  it('sends the version header — which 0.3.17 did not, and is why it was never offered firmware', async () => {
    const { fetchFn, seen } = serverLike();
    await getOfficialFirmwareRelease('v1', { appVersion: '0.3.18', testerKey: null }, fetchFn);
    expect(seen).toHaveLength(1);
    expect(seen[0].headers[APP_VERSION_HEADER.toLowerCase()]).toBe('0.3.18');
  });

  it('0.3.18 with no key: firmware is null while V1.26 is hidden', async () => {
    const { fetchFn } = serverLike();
    const result = await getOfficialFirmwareRelease('v1', { appVersion: '0.3.18', testerKey: null }, fetchFn);
    expect(result.status).toBe('no-release');
  });

  it('0.3.18 with the tester key: V1.26 comes back, parsed', async () => {
    const { fetchFn, seen } = serverLike();
    const result = await getOfficialFirmwareRelease('v1', { appVersion: '0.3.18', testerKey: 'the-tester-key' }, fetchFn);
    expect(seen[0].headers[TESTER_KEY_HEADER.toLowerCase()]).toBe('the-tester-key');
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.release.version).toBe('AC6966-V1.26');
    expect(result.release.hardwareRev).toBe('v1');
    expect(result.release.minAppVersion).toBe('0.3.17');
    expect(result.release.sizeBytes).toBe(49605426);
    expect(result.release.downloadUrl).toContain('/api/public/firmware/download?id=');
  });

  it('a Store build sends no tester header at all, only the version', async () => {
    const { fetchFn, seen } = serverLike();
    await getOfficialFirmwareRelease('v1', { appVersion: '0.3.18', testerKey: null }, fetchFn);
    // Not "sent empty" — absent. An empty value is still a value for the server to compare.
    expect(Object.keys(seen[0].headers)).toEqual([APP_VERSION_HEADER.toLowerCase()]);
  });

  it('still asks the endpoint it always asked, with the rev encoded', async () => {
    const { fetchFn, seen } = serverLike();
    await getOfficialFirmwareRelease('a rev/with?odd chars', { appVersion: '0.3.18', testerKey: null }, fetchFn);
    expect(seen[0].url).toBe(`${CATALOGUE_ORIGIN}/api/public/firmware?hardware_rev=a%20rev%2Fwith%3Fodd%20chars`);
  });
});

describe('where the headers may be sent', () => {
  it('attaches them to a PonyABC URL', () => {
    const h = catalogueHeaders({
      url: `${CATALOGUE_ORIGIN}/api/public/books/download?id=x`,
      identity: { appVersion: '0.3.18', testerKey: 'secret' },
    });
    expect(h[APP_VERSION_HEADER]).toBe('0.3.18');
    expect(h[TESTER_KEY_HEADER]).toBe('secret');
  });

  it('sends NOTHING to any other host — a download URL comes from the server, so it is data', () => {
    // The failure this prevents: a catalogue response naming someone else's host, and the app
    // posting an internal credential to it.
    for (const url of [
      'https://evil.example/api/public/books/download?id=x',
      'http://register.ponyabc.uk/api/public/books/download?id=x', // http, not https
      'https://register.ponyabc.uk.evil.example/x',
      'https://ponyabc.uk/x',
      'not a url at all',
      '',
    ]) {
      expect(catalogueHeaders({ url, identity: { appVersion: '0.3.18', testerKey: 'secret' } }), url).toEqual({});
      expect(isCatalogueUrl(url), url).toBe(false);
    }
  });

  it('omits the tester header when there is no key, rather than sending it empty', () => {
    const h = catalogueHeaders({
      url: `${CATALOGUE_ORIGIN}/api/public/firmware?hardware_rev=v1`,
      identity: { appVersion: '0.3.18', testerKey: null },
    });
    expect(h).toEqual({ [APP_VERSION_HEADER]: '0.3.18' });
  });
});

/**
 * The downloads, which 0.3.17 also sent anonymously.
 *
 * `downloadFile` is the single funnel both the BOOK and the firmware download go through, so
 * proving it here covers both. The bytes come from the catalogue, so the request that fetches
 * them identifies itself exactly as the request that described them did.
 */
describe('the downloads identify this build too', () => {
  it('sends the version header, and the tester key when there is one', async () => {
    const { downloadFile } = await import('../../src/main/services/transferService');
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    const body = Buffer.from('hello');
    const seen: Record<string, string>[] = [];
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push(
        Object.fromEntries(
          Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
        ),
      );
      return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
    }) as unknown as typeof fetch;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-dl-headers-'));
    try {
      const outcome = await downloadFile({
        url: `${CATALOGUE_ORIGIN}/api/public/books/download?id=abc`,
        destTmpPath: path.join(dir, 'out.part'),
        expectedSize: body.length,
        expectedSha256: null,
        signal: new AbortController().signal,
        identity: { appVersion: '0.3.18', testerKey: 'the-tester-key' },
        fetchFn,
      });
      expect(outcome.status).toBe('ok');
      expect(seen[0][APP_VERSION_HEADER.toLowerCase()]).toBe('0.3.18');
      expect(seen[0][TESTER_KEY_HEADER.toLowerCase()]).toBe('the-tester-key');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sends nothing when the server points the download at another host', async () => {
    const { downloadFile } = await import('../../src/main/services/transferService');
    const os = await import('node:os');
    const path = await import('node:path');
    const fs = await import('node:fs');

    const body = Buffer.from('hello');
    const seen: Record<string, string>[] = [];
    const fetchFn = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      seen.push((init?.headers ?? {}) as Record<string, string>);
      return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
    }) as unknown as typeof fetch;

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-dl-headers-'));
    try {
      await downloadFile({
        url: 'https://cdn.example.net/whatever.axb',
        destTmpPath: path.join(dir, 'out.part'),
        expectedSize: body.length,
        expectedSha256: null,
        signal: new AbortController().signal,
        identity: { appVersion: '0.3.18', testerKey: 'the-tester-key' },
        fetchFn,
      });
      expect(seen[0]).toEqual({});
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
