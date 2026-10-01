/**
 * The Internal-only screens and controls, as the STORE build sees them: nothing.
 *
 * `electron.vite.config.ts` aliases `@internal-ui` here unless PONYABC_INTERNAL=1. The Store
 * build therefore contains neither the testing-mode screen, nor the by-hand firmware picker,
 * nor the internal banner — nor any of their words, which is why none of them appears in its
 * bundle.
 */
export const INTERNAL_UI = false;

export function InternalBanner(): null {
  return null;
}

export function FirmwareFolderPicker(): null {
  return null;
}

export function TestingModeSection(): null {
  return null;
}

/** No panel, and none of its wording, in a Store build. */
export function TechnicalLogPanel(): null {
  return null;
}
