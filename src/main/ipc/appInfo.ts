import { app } from 'electron';
import type { AppInfo } from '@shared/types';

/** process.platform / process.arch reflect the running binary, not the host machine — an
 *  x64 build under Rosetta on Apple Silicon reports 'x64' here, same as a native Intel Mac.
 *  process.windowsStore is Electron's own runtime flag for "launched from an installed
 *  MSIX/APPX package" — undefined/false everywhere else. Deliberately does not touch app
 *  name/userData/appId — this only reads existing values. */
export function getAppInfo(): AppInfo {
  return {
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isWindowsStore: process.windowsStore === true,
  };
}
