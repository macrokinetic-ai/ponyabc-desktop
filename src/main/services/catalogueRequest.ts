/**
 * The headers every catalogue request carries, and the rule about where they may be sent.
 *
 * 0.3.17 sent `X-PonyABC-App-Version` on the BOOK catalogue request and nowhere else — not on
 * the firmware request, not on either download. The server, correctly, never offers firmware to
 * a caller that has not said it is new enough to handle it, so 0.3.17 could never be offered a
 * firmware update however the catalogue was configured. That is why this exists in one place
 * instead of at each call site: the next request someone adds gets the rule for free.
 *
 * **Where they may be sent matters as much as what they are.** A download URL comes from the
 * server's own response, so it is data, not a constant. Attaching the tester key to whatever
 * host that response names would hand an internal credential to anyone who could influence it.
 * So the headers go to the PonyABC origin and nowhere else, and `catalogueHeaders` returns an
 * empty object for any other URL rather than trusting the caller to have checked.
 *
 * Pure on purpose: no `electron` import, so it can be tested directly. The caller supplies the
 * identity, and in a Store build `testerKey` is always null — see `src/main/internal/stub.ts`.
 */

import { APP_VERSION_HEADER } from '@shared/contentContract';
import { TESTER_KEY_HEADER } from '@internal';

/** The only host these headers are ever sent to. */
export const CATALOGUE_ORIGIN = 'https://register.ponyabc.uk';

export interface CatalogueIdentity {
  /** This build's version, e.g. '0.3.18'. What the server gates on. */
  appVersion: string;
  /** Internal builds with testing mode on, and only then. Null everywhere else. */
  testerKey: string | null;
}

/** Is this a URL belonging to the PonyABC catalogue? Anything unparseable is not. */
export function isCatalogueUrl(url: string, origin: string = CATALOGUE_ORIGIN): boolean {
  try {
    return new URL(url).origin === new URL(origin).origin;
  } catch {
    return false;
  }
}

/**
 * The headers for one catalogue request, or `{}` if the URL is not ours.
 *
 * The tester header is omitted entirely when there is no key, rather than sent empty: an empty
 * value is a value, and the server compares what it is given against the secret. In a Store
 * build `TESTER_KEY_HEADER` is the empty string and `testerKey` is always null, so neither the
 * name nor a value can appear.
 */
export function catalogueHeaders(params: {
  url: string;
  identity: CatalogueIdentity;
  origin?: string;
}): Record<string, string> {
  const { url, identity, origin } = params;
  if (!isCatalogueUrl(url, origin ?? CATALOGUE_ORIGIN)) return {};
  const headers: Record<string, string> = {};
  if (identity.appVersion) headers[APP_VERSION_HEADER] = identity.appVersion;
  if (identity.testerKey && TESTER_KEY_HEADER) headers[TESTER_KEY_HEADER] = identity.testerKey;
  return headers;
}
