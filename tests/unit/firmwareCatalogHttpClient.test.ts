import { describe, expect, it, vi } from 'vitest';
import { getOfficialFirmwareRelease } from '../../src/main/services/firmwareCatalog/httpClient';

function fetchReturning(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

const rawRelease = {
  id: 'r1',
  version: 'AC6966-V1.18',
  hardwareRev: 'PENDING-HWREV',
  notes: 'Initial draft release',
  sizeBytes: 12345,
  sha256: 'a'.repeat(64),
  minAppVersion: '0.3.0',
  releasedAt: '2026-09-15T00:00:00.000Z',
  packageLabel: 'AC6966-V1.18 20260316',
  packageDate: '2026-03-16',
  recommended: false,
  downloadUrl: '/api/public/firmware/download?id=r1',
};

describe('getOfficialFirmwareRelease', () => {
  it('ok: maps a real release payload into FirmwareReleaseInfo (camelCase passthrough)', async () => {
    const fetchFn = fetchReturning({ release: rawRelease });
    const result = await getOfficialFirmwareRelease('PENDING-HWREV', fetchFn);
    expect(result).toEqual({ status: 'ok', release: rawRelease });
  });

  it("no-release: { release: null } is a normal state, not an error", async () => {
    const fetchFn = fetchReturning({ release: null });
    const result = await getOfficialFirmwareRelease('PENDING-HWREV', fetchFn);
    expect(result).toEqual({ status: 'no-release' });
  });

  it('no-network: a thrown fetch error (offline/DNS/etc.)', async () => {
    const fetchFn = (async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    }) as unknown as typeof fetch;
    const result = await getOfficialFirmwareRelease('PENDING-HWREV', fetchFn);
    expect(result).toEqual({ status: 'no-network', message: 'getaddrinfo ENOTFOUND' });
  });

  it('no-network: a non-ok HTTP status', async () => {
    const fetchFn = fetchReturning({ error: 'nope' }, 503);
    const result = await getOfficialFirmwareRelease('PENDING-HWREV', fetchFn);
    expect(result).toEqual({ status: 'no-network', message: 'Server returned 503.' });
  });

  it('no-network: malformed JSON body', async () => {
    const fetchFn = (async () => new Response('not json{{{', { status: 200 })) as unknown as typeof fetch;
    const result = await getOfficialFirmwareRelease('PENDING-HWREV', fetchFn);
    expect(result.status).toBe('no-network');
  });

  it('no-network: a well-formed JSON body missing the expected shape entirely', async () => {
    const fetchFn = fetchReturning({ release: 'not-an-object' });
    const result = await getOfficialFirmwareRelease('PENDING-HWREV', fetchFn);
    expect(result.status).toBe('no-network');
  });

  it('encodes the hardware_rev query parameter and hits the expected public endpoint', async () => {
    const fetchFn = vi.fn(fetchReturning({ release: null })) as unknown as typeof fetch;
    await getOfficialFirmwareRelease('a rev/with?odd chars', fetchFn);
    const calledUrl = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(calledUrl).toBe('https://register.ponyabc.uk/api/public/firmware?hardware_rev=a%20rev%2Fwith%3Fodd%20chars');
  });
});
