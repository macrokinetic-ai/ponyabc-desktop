import type { FirmwareReleaseFetchResult, FirmwareReleaseInfo } from '@shared/types';

// Hardcoded — the renderer has no way to influence which host this reads from. Secret-free
// public endpoint, same as BOOK_API_BASE_URL in main/ipc/book.ts: no Authorization header,
// nothing embedded to protect. This never sees a draft/withdrawn release — the public API only
// ever returns the current `status='active'` row for the given hardware_rev, or `{release:null}`.
export const FIRMWARE_API_BASE_URL = 'https://register.ponyabc.uk';

/**
 * The confirmed real-device-verified hardware_rev for the officially published firmware
 * (matches product_serials.hardware_rev — see supabase/migrations/20260909120003_
 * product_serials.sql in ponyabc-web). Real registered serials currently exist for BOTH 'v1'
 * (7 serials) and 'v2' (3 serials) — this app has no way to detect which one a connected pen
 * actually is, and the officially published firmware has ONLY been confirmed on 'v1' hardware.
 * Hardcoding a single value is a deliberate v1 simplification, not a claim that all P5 hardware
 * batches are covered — a 'v2' pen querying the server gets `{release: null}` (no firmware
 * published for it) rather than being offered firmware never verified on its hardware. Revisit
 * if/when a real hardware-detection method or a 'v2' release exists.
 */
export const HARDWARE_REV_CONST = 'v1';

interface RawFirmwareRelease {
  id: unknown;
  version: unknown;
  hardwareRev: unknown;
  notes: unknown;
  sizeBytes: unknown;
  sha256: unknown;
  minAppVersion: unknown;
  releasedAt: unknown;
  packageLabel: unknown;
  packageDate: unknown;
  recommended: unknown;
  downloadUrl: unknown;
}

function toRelease(r: RawFirmwareRelease): FirmwareReleaseInfo {
  return {
    id: String(r.id),
    version: String(r.version),
    hardwareRev: String(r.hardwareRev),
    notes: typeof r.notes === 'string' ? r.notes : null,
    sizeBytes: typeof r.sizeBytes === 'number' ? r.sizeBytes : Number(r.sizeBytes) || 0,
    sha256: typeof r.sha256 === 'string' ? r.sha256 : null,
    minAppVersion: typeof r.minAppVersion === 'string' ? r.minAppVersion : null,
    releasedAt: typeof r.releasedAt === 'string' ? r.releasedAt : null,
    packageLabel: typeof r.packageLabel === 'string' ? r.packageLabel : null,
    packageDate: typeof r.packageDate === 'string' ? r.packageDate : null,
    recommended: r.recommended === true,
    downloadUrl: String(r.downloadUrl),
  };
}

/**
 * Talks to the secret-free public firmware catalog endpoint (GET /api/public/firmware) — no
 * Authorization header, mirroring bookCatalog/httpClient.ts's createHttpBookCatalogClient. A
 * single function rather than a client-object (unlike the BOOK catalog's client.ts/httpClient.ts
 * split) since there is exactly one operation here and no fixture/live distinction to abstract
 * over yet.
 */
export async function getOfficialFirmwareRelease(hardwareRev: string, fetchFn: typeof fetch = fetch): Promise<FirmwareReleaseFetchResult> {
  let response: Response;
  try {
    response = await fetchFn(`${FIRMWARE_API_BASE_URL}/api/public/firmware?hardware_rev=${encodeURIComponent(hardwareRev)}`, {
      signal: AbortSignal.timeout(10000),
    });
  } catch (err) {
    return { status: 'no-network', message: err instanceof Error ? err.message : String(err) };
  }
  if (!response.ok) {
    return { status: 'no-network', message: `Server returned ${response.status}.` };
  }

  let data: { release?: unknown };
  try {
    data = (await response.json()) as { release?: unknown };
  } catch {
    return { status: 'no-network', message: 'Malformed catalog response.' };
  }

  if (data.release === null || data.release === undefined) return { status: 'no-release' };
  if (typeof data.release !== 'object') return { status: 'no-network', message: 'Malformed catalog response.' };
  return { status: 'ok', release: toRelease(data.release as RawFirmwareRelease) };
}
