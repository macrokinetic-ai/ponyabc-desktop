import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ openExternal: vi.fn(async () => {}) }));
vi.mock('electron', () => ({
  shell: { openExternal: h.openExternal },
}));

import { openPrivacyPolicyPage, openRegistrationPage } from '../../src/main/ipc/registration';
import { openSupportEmail } from '../../src/main/ipc/support';

beforeEach(() => {
  h.openExternal.mockClear();
  h.openExternal.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('openRegistrationPage', () => {
  it('opens the hardcoded registration URL, ignoring anything the renderer might try to supply', async () => {
    const result = await openRegistrationPage();
    expect(result).toEqual({ ok: true });
    expect(h.openExternal).toHaveBeenCalledWith('https://register.ponyabc.uk/register');
  });

  it('reports a structured failure rather than throwing when shell.openExternal rejects', async () => {
    h.openExternal.mockRejectedValueOnce(new Error('no handler'));
    const result = await openRegistrationPage();
    expect(result).toEqual({ ok: false, error: 'no handler' });
  });
});

describe('openPrivacyPolicyPage', () => {
  it('opens the hardcoded privacy-policy URL — a different URL than registration', async () => {
    const result = await openPrivacyPolicyPage();
    expect(result).toEqual({ ok: true });
    expect(h.openExternal).toHaveBeenCalledWith('https://register.ponyabc.uk/privacy');
  });

  it('reports a structured failure rather than throwing when shell.openExternal rejects', async () => {
    h.openExternal.mockRejectedValueOnce(new Error('no handler'));
    const result = await openPrivacyPolicyPage();
    expect(result).toEqual({ ok: false, error: 'no handler' });
  });
});

describe('openSupportEmail', () => {
  it('opens a mailto: link to the hardcoded support address with the given subject encoded', async () => {
    const result = await openSupportEmail({ subject: 'PonyABC Desktop Support — v1.2.3 (darwin)' });
    expect(result).toEqual({ ok: true });
    expect(h.openExternal).toHaveBeenCalledWith('mailto:marketing@ponyabc.co.uk?subject=PonyABC%20Desktop%20Support%20%E2%80%94%20v1.2.3%20(darwin)');
  });

  it('percent-encodes a subject containing "&"/"=" so it can never inject extra mailto fields (cc/bcc/body)', async () => {
    await openSupportEmail({ subject: 'x&bcc=attacker@evil.com&body=hello' });
    const url = h.openExternal.mock.calls[0][0] as string;
    // The recipient is always exactly marketing@ponyabc.co.uk with nothing else before "?subject="
    expect(url.startsWith('mailto:marketing@ponyabc.co.uk?subject=')).toBe(true);
    // The attacker-supplied "&"/"=" are encoded, so they never start a second query parameter.
    expect(url).not.toContain('&bcc=');
    expect(url).not.toContain('&body=');
  });

  it('reports a structured failure rather than throwing when shell.openExternal rejects (e.g. no mail client configured)', async () => {
    h.openExternal.mockRejectedValueOnce(new Error('no handler'));
    const result = await openSupportEmail({ subject: 'test' });
    expect(result).toEqual({ ok: false, error: 'no handler' });
  });
});
