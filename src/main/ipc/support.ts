import { shell } from 'electron';

// Hardcoded — the renderer can only ever influence the subject line, never the recipient,
// and never add extra mailto fields (cc/bcc/body) since the subject is percent-encoded below.
const SUPPORT_EMAIL = 'marketing@ponyabc.co.uk';

/**
 * Opens the user's default mail client with a pre-filled "To" and "Subject" — nothing is
 * sent automatically, no diagnostics/files/personal data are attached, and the user can
 * still edit or discard the draft entirely before choosing to send it themselves.
 */
export async function openSupportEmail(params: { subject: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(params.subject)}`;
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
