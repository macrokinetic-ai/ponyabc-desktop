export interface AppInfo {
  version: string;
  /** process.platform from the main process — reflects the running binary, not the host OS. */
  platform: string;
  /** process.arch from the main process — reflects the running binary's architecture. An
   *  x64 build running under Rosetta on Apple Silicon reports 'x64' here, exactly like a
   *  native Intel Mac would; this is what makes the identifier below correct without any
   *  separate host-hardware detection. */
  arch: string;
  /** Electron's own `process.windowsStore` — true only when running as an installed MSIX/APPX
   *  (Desktop Bridge) package, regardless of how the build was signed. Always false on
   *  mac and on the plain NSIS-installed Windows build; not a build-time flag, so it can't
   *  drift out of sync with how the app actually launched. */
  isWindowsStore: boolean;
}

export type KnownVariantIdentifier = 'mac-arm64' | 'mac-x64' | 'win-x64' | 'win-x64-msix';

export interface AppVariant {
  identifier: string;
  /** i18n key for the human label (settings namespace), or null for an unrecognized
   *  platform/arch combination (e.g. local dev on Linux) — never fabricate a label for a
   *  combination that isn't one of the four shipped variants. */
  labelKey: string | null;
}

/**
 * Maps a running process's platform+arch(+isWindowsStore) to one of the four shipped variant
 * identifiers. Pure and side-effect-free so it's testable without Electron — the actual
 * platform/arch/isWindowsStore values themselves are what carry the "reflects the running
 * binary, not just the host hardware" guarantee (see AppInfo above).
 */
export function identifyAppVariant(platform: string, arch: string, isWindowsStore = false): AppVariant {
  if (platform === 'darwin' && arch === 'arm64') return { identifier: 'mac-arm64', labelKey: 'about.variantMacArm64' };
  if (platform === 'darwin' && arch === 'x64') return { identifier: 'mac-x64', labelKey: 'about.variantMacX64' };
  if (platform === 'win32' && arch === 'x64' && isWindowsStore) return { identifier: 'win-x64-msix', labelKey: 'about.variantWinX64Msix' };
  if (platform === 'win32' && arch === 'x64') return { identifier: 'win-x64', labelKey: 'about.variantWinX64' };
  return { identifier: `${platform}-${arch}`, labelKey: null };
}
