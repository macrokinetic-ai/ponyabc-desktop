import fs from 'node:fs';
import path from 'node:path';
import extractZip from 'extract-zip';
import { inspectFirmwarePackage } from './firmwareUpgrade';

export type FirmwareExtractOutcome =
  | { ok: true; packageDir: string }
  | { ok: false; reason: string; missingFiles?: string[] };

/**
 * Extracts `zipPath` into `destDir`, then auto-detects the real package root: `tools.zip` (the
 * first confirmed real package) nests everything one level under `tools/`, so the extraction
 * root itself never passes `inspectFirmwarePackage()` — this generically handles that (and any
 * future package with a different single top-level folder name) without hardcoding "tools".
 *
 * Zip-slip guard: `extract-zip` itself already refuses to write any entry whose real
 * (symlink-resolved) destination falls outside `destDir` — see its own `Out of bound path`
 * check — but `onEntry` here adds an explicit, independent check on the entry's nominal path
 * before any bytes are written, as defense in depth. Either guard rejecting an entry aborts the
 * whole extraction (extract-zip has no partial-continue mode), and `destDir` is then removed so
 * nothing from a rejected archive is left behind.
 */
export async function extractFirmwarePackage(zipPath: string, destDir: string): Promise<FirmwareExtractOutcome> {
  fs.mkdirSync(destDir, { recursive: true });

  try {
    await extractZip(zipPath, {
      dir: destDir,
      onEntry: (entry) => {
        const resolved = path.resolve(destDir, entry.fileName);
        if (resolved !== destDir && !resolved.startsWith(destDir + path.sep)) {
          throw new Error(`Refusing to extract entry outside the destination directory: ${entry.fileName}`);
        }
      },
    });
  } catch (err) {
    // Never leave a partially-extracted (or, for a rejected zip-slip attempt, potentially
    // unexpected) directory tree behind — clean up before reporting failure.
    await fs.promises.rm(destDir, { recursive: true, force: true }).catch(() => {});
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }

  const direct = inspectFirmwarePackage(destDir);
  if (direct.looksValid) return { ok: true, packageDir: destDir };

  let subdirs: string[] = [];
  try {
    subdirs = fs
      .readdirSync(destDir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    subdirs = [];
  }
  if (subdirs.length === 1) {
    const nestedDir = path.join(destDir, subdirs[0]);
    const nested = inspectFirmwarePackage(nestedDir);
    if (nested.looksValid) return { ok: true, packageDir: nestedDir };
    // The single-subdir candidate is the more likely intended package root (matches tools.zip's
    // real layout) — report its missing files, not the extraction root's, since that's the
    // actionable list for whoever needs to fix the vendor package.
    return { ok: false, reason: 'invalid-package-layout', missingFiles: nested.missingFiles };
  }

  return { ok: false, reason: 'invalid-package-layout', missingFiles: direct.missingFiles };
}
