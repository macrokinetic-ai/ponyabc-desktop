import { execFileSync } from 'node:child_process';

/**
 * Flushes and ejects the pen after a change, so the customer can unplug it immediately.
 *
 * Best effort by design, and never a reason to fail an operation that already succeeded:
 *
 * - **macOS** does this properly with `diskutil eject`, which flushes and unmounts.
 * - **Windows** has no way to eject a removable volume from a normal user process without
 *   administrator rights or a driver-level call. We do not ask for either. FAT writes are
 *   already flushed when each file handle closes, so the pen is consistent; the customer is
 *   told to unplug it, which is what Windows itself recommends for a FAT volume.
 *
 * Returns whether the volume was actually ejected, so the UI can be honest about it.
 */
export function ejectPen(penRootPath: string, platform: NodeJS.Platform = process.platform): boolean {
  if (platform !== 'darwin') return false;
  try {
    execFileSync('/usr/sbin/diskutil', ['eject', penRootPath], { stdio: 'ignore', timeout: 15_000 });
    return true;
  } catch {
    // Busy, already gone, or not a whole volume. The customer unplugs it either way.
    return false;
  }
}
