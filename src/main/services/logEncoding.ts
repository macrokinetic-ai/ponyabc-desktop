import iconv from 'iconv-lite';

/**
 * Windows OEM/console codepage number -> iconv-lite encoding label. This is a lookup table for
 * codepages we have real reason to expect on a machine running this app or the vendor tool —
 * NOT a claim of exhaustive coverage of every Windows codepage. An unrecognized codepage number
 * must never be guessed at; see decodeLogBytes's fallback.
 *
 * 936 (GBK) is the expected case for the confirmed vendor tool: its own console text (e.g.
 * "下载完成。", "开始下载……") is Simplified Chinese, and GBK/CP936 is the default OEM codepage on a
 * Simplified Chinese Windows install — but this is detected at runtime via `chcp`
 * (buildFlashBatchScript), never assumed, since the app also runs on machines set to other
 * locales/codepages.
 */
const CODEPAGE_TO_ENCODING: Record<number, string> = {
  936: 'gbk', // Simplified Chinese (GBK/CP936)
  950: 'big5', // Traditional Chinese (Big5/CP950)
  65001: 'utf-8', // UTF-8 console (chcp 65001)
  437: 'cp437', // US English OEM
  850: 'cp850', // Western European OEM (DOS Latin 1)
  1252: 'windows-1252', // Windows Western European ANSI
};

/** Returns an iconv-lite-usable encoding label for a detected Windows codepage number, or null
 *  if this codepage isn't one we recognize (never guess a fallback encoding for an unknown
 *  codepage — see decodeLogBytes). */
export function codepageToEncoding(codepage: number): string | null {
  const enc = CODEPAGE_TO_ENCODING[codepage];
  return enc && iconv.encodingExists(enc) ? enc : null;
}

/** Parses `chcp`'s own stdout. Its surrounding label text is locale-dependent (e.g. "Active code
 *  page: 936" vs "現用字碼頁: 950"), but the codepage number itself is always plain ASCII digits at
 *  the end — safe to extract by position regardless of what encoding the surrounding label text
 *  actually is in (ASCII digits are byte-identical across every codepage this app might ever
 *  encounter). Returns null if no trailing digits are found. */
export function parseChcpOutput(raw: string): number | null {
  const match = raw.match(/(\d+)\s*$/);
  return match ? parseInt(match[1], 10) : null;
}

export interface DecodedLog {
  text: string;
  /** The iconv-lite label actually used, or null if the codepage was unknown/unrecognized —
   *  callers MUST treat a null encodingUsed as "not reliably readable text," never display it as
   *  if it were correctly decoded, per this app's policy of not claiming a garbled/? -substituted
   *  string has been "recovered." */
  encodingUsed: string | null;
  /** The raw codepage number that was detected (if any) — kept alongside encodingUsed since a
   *  detected-but-unrecognized codepage (encodingUsed: null) is a different, more specific state
   *  than "no codepage info was ever captured at all" (codepage: null). */
  codepage: number | null;
}

/**
 * Decodes the FULL accumulated raw log bytes fresh each time — deliberately never incrementally
 * per newly-arrived chunk. This is what makes a multi-byte character split across two separate
 * poll reads safe: as long as the bytes are eventually complete in the accumulated buffer,
 * decoding the whole thing at once every time is correct. The only transient artifact is the
 * very last, still-in-flight character while a write is mid-flight — which self-corrects on the
 * next re-decode once the rest of its bytes have arrived. Never attempt to decode only the new
 * delta in isolation; that reintroduces exactly the corruption this function exists to avoid.
 *
 * When the codepage is unknown or unrecognized, this does NOT guess UTF-8 (or any other
 * encoding) — it falls back to latin1, a lossless 1-byte-per-character mapping that preserves
 * every raw byte's numeric value in the resulting string (so the original bytes are always
 * still recoverable from it if ever needed), and marks `encodingUsed: null` so callers know this
 * text is not reliably human-readable and must not be presented as if it were.
 */
export function decodeLogBytes(raw: Buffer, codepage: number | null): DecodedLog {
  if (codepage !== null) {
    const encoding = codepageToEncoding(codepage);
    if (encoding) {
      return { text: iconv.decode(raw, encoding), encodingUsed: encoding, codepage };
    }
  }
  return { text: raw.toString('latin1'), encodingUsed: null, codepage };
}
