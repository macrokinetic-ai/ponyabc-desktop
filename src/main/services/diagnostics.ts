import type { DiagnosticEntry, DiagnosticEntryKind } from '@shared/types';
import type { JsonStore } from './bookStore';

/** Capped, not rotated by file size — a JSON array trimmed to the newest N entries on every
 *  write is simpler than log-file rotation and is more than enough for a companion app whose
 *  diagnostic events are small, structured, and infrequent. */
const MAX_ENTRIES = 500;

/** Defensive redaction applied at insert time (and re-applied on export) so the log can never
 *  carry a local filesystem path, an auth header/token, or a credentialed URL even if a caller
 *  passes one in by mistake — every writer in this codebase is expected to already avoid these,
 *  this is the backstop, not the only safeguard. Never touches audio/AXB bytes because no
 *  caller ever puts file content into a diagnostic detail object in the first place. */
export function redactText(text: string): string {
  return text
    .replace(/\/Users\/[^\s"']+/g, '<path>')
    .replace(/[A-Za-z]:\\Users\\[^\s"']+/g, '<path>')
    .replace(/\/home\/[^\s"']+/g, '<path>')
    // Whole rest of the line, so this always wins over the narrower bearer-token pattern
    // below instead of leaving its trailing tokens to be redacted a second time.
    .replace(/\bauthorization\s*:\s*.*/gi, 'authorization: <redacted>')
    .replace(/\bbearer\s+\S+/gi, 'bearer <redacted>')
    .replace(/([?&](?:token|key|secret|password|auth)=)[^&\s]+/gi, '$1<redacted>');
}

function redactDetail(detail: Record<string, string | number | boolean | null>): Record<string, string | number | boolean | null> {
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(detail)) out[k] = typeof v === 'string' ? redactText(v) : v;
  return out;
}

export function appendDiagnostic(
  store: JsonStore<DiagnosticEntry[]>,
  kind: DiagnosticEntryKind,
  detail: Record<string, string | number | boolean | null>,
): void {
  const entry: DiagnosticEntry = { atMs: Date.now(), kind, detail: redactDetail(detail) };
  store.update((cur) => [...cur, entry].slice(-MAX_ENTRIES));
}
