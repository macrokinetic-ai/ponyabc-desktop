import { describe, expect, it } from 'vitest';
import { identifyAppVariant } from '../../src/shared/appVariant';

describe('identifyAppVariant', () => {
  it('maps darwin/arm64 to mac-arm64', () => {
    expect(identifyAppVariant('darwin', 'arm64')).toEqual({ identifier: 'mac-arm64', labelKey: 'about.variantMacArm64' });
  });

  it('maps darwin/x64 to mac-x64', () => {
    expect(identifyAppVariant('darwin', 'x64')).toEqual({ identifier: 'mac-x64', labelKey: 'about.variantMacX64' });
  });

  it('maps win32/x64 to win-x64', () => {
    expect(identifyAppVariant('win32', 'x64')).toEqual({ identifier: 'win-x64', labelKey: 'about.variantWinX64' });
  });

  it('reflects the running BINARY architecture, not host hardware — an x64 build under Rosetta on Apple Silicon must read as mac-x64', () => {
    // The whole point: this function only ever sees process.arch, which Node/Electron
    // report as the architecture the binary was compiled for — under Rosetta, that value
    // is 'x64' regardless of the host CPU being arm64. There is no separate "host CPU"
    // input here at all, which is what makes this guarantee hold by construction.
    const result = identifyAppVariant('darwin', 'x64');
    expect(result.identifier).toBe('mac-x64');
    expect(result.identifier).not.toBe('mac-arm64');
  });

  it('falls back to a raw "<platform>-<arch>" identifier with no label for an unsupported combination, never fabricating a label', () => {
    const result = identifyAppVariant('linux', 'x64');
    expect(result.identifier).toBe('linux-x64');
    expect(result.labelKey).toBeNull();
  });
});
