import { app, shell } from 'electron';
import type { UpdateCheckResult } from '@shared/types';
import { isNewerVersion } from '@shared/semver';

// Hardcoded — the renderer has no way to influence which repo/URL this checks or opens.
const REPO = 'macrokinetic-ai/ponyabc-desktop';
const LATEST_RELEASE_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const LATEST_RELEASE_PAGE_URL = `https://github.com/${REPO}/releases/latest`;

/**
 * Checks GitHub Releases for a newer version than the running app. This only ever reads a
 * public, hardcoded URL and compares version numbers — it never downloads or installs
 * anything itself. These builds are unsigned, so a real silent auto-update (Squirrel.Mac /
 * NSIS differential update) isn't viable yet either way; "updating" means the user clicks
 * through to the GitHub release page and installs the new build manually, same as any other
 * unsigned desktop app download.
 */
export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  try {
    const response = await fetch(LATEST_RELEASE_API_URL, {
      headers: { 'User-Agent': 'PonyABC-Desktop-UpdateCheck', Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      return { status: 'error', message: `GitHub returned ${response.status}.` };
    }
    const data = (await response.json()) as { tag_name?: unknown };
    if (typeof data.tag_name !== 'string' || data.tag_name.length === 0) {
      return { status: 'error', message: 'No release information was found.' };
    }
    const latestVersion = data.tag_name;
    if (isNewerVersion(latestVersion, currentVersion)) {
      return { status: 'update-available', currentVersion, latestVersion };
    }
    return { status: 'up-to-date', currentVersion };
  } catch (err) {
    return { status: 'error', message: err instanceof Error ? err.message : String(err) };
  }
}

export async function openLatestReleasePage(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await shell.openExternal(LATEST_RELEASE_PAGE_URL);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
