export interface AppInfo {
  version: string;
  /** process.platform from the main process — reflects the running binary, not the host OS. */
  platform: string;
  /** process.arch from the main process — reflects the running binary's architecture. An
   *  x64 build running under Rosetta on Apple Silicon reports 'x64' here, exactly like a
   *  native Intel Mac would; this is what makes the identifier below correct without any
   *  separate host-hardware detection. */
  arch: string;
}

export type KnownVariantIdentifier = 'mac-arm64' | 'mac-x64' | 'win-x64';

export interface AppVariant {
  identifier: string;
  /** i18n key for the human label (settings namespace), or null for an unrecognized
   *  platform/arch combination (e.g. local dev on Linux) — never fabricate a label for a
   *  combination that isn't one of the three shipped variants. */
  labelKey: string | null;
}

/**
 * Maps a running process's platform+arch to one of the three shipped variant identifiers.
 * Pure and side-effect-free so it's testable without Electron — the actual platform/arch
 * values themselves are what carry the "reflects the running binary, not just the host
 * hardware" guarantee (see AppInfo above).
 */
export function identifyAppVariant(platform: string, arch: string): AppVariant {
  if (platform === 'darwin' && arch === 'arm64') return { identifier: 'mac-arm64', labelKey: 'about.variantMacArm64' };
  if (platform === 'darwin' && arch === 'x64') return { identifier: 'mac-x64', labelKey: 'about.variantMacX64' };
  if (platform === 'win32' && arch === 'x64') return { identifier: 'win-x64', labelKey: 'about.variantWinX64' };
  return { identifier: `${platform}-${arch}`, labelKey: null };
}
