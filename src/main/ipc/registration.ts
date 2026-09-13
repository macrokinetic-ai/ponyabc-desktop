import { shell } from 'electron';

// Hardcoded — the renderer has no way to influence what URL gets opened.
const REGISTRATION_URL = 'https://register.ponyabc.uk/register';

export async function openRegistrationPage(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await shell.openExternal(REGISTRATION_URL);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
