import { afterEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ isPackaged: false }));
vi.mock('electron', () => ({
  app: {
    get isPackaged() {
      return h.isPackaged;
    },
  },
}));

import { demoFirmwareEnabled, demoFirmwareOutcome } from '../../src/main/services/demoFirmware';

const env = { ...process.env };
afterEach(() => {
  process.env = { ...env };
  h.isPackaged = false;
});

describe('the firmware screenshot path', () => {
  it('is off when nothing asks for it', () => {
    delete process.env.PONYABC_DEMO_FIRMWARE;
    expect(demoFirmwareEnabled()).toBe(false);
  });

  it('is on in a development build when asked for', () => {
    process.env.PONYABC_DEMO_FIRMWARE = 'success';
    expect(demoFirmwareEnabled()).toBe(true);
  });

  // The one that matters: a shipped build must never be able to show a firmware result it did
  // not really produce, whatever its environment says.
  it('stays off in a packaged build even when the environment asks for it', () => {
    process.env.PONYABC_DEMO_FIRMWARE = 'success';
    h.isPackaged = true;
    expect(demoFirmwareEnabled()).toBe(false);
  });

  it('describes a finished update, and a refused one, in the shapes the screen reads', () => {
    process.env.PONYABC_DEMO_FIRMWARE = 'success';
    const success = demoFirmwareOutcome();
    expect(success.status).toBe('success');
    expect(success.processTerminationConfirmed).toBe(true);

    process.env.PONYABC_DEMO_FIRMWARE = 'not-started';
    const notStarted = demoFirmwareOutcome();
    expect(notStarted.status).toBe('failed');
    // The screen picks "The update did not start" off this prefix.
    expect(notStarted.reason.startsWith('preflight-')).toBe(true);
  });
});
