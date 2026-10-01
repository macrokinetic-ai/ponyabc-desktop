import { describe, expect, it } from 'vitest';
import { formatBuildLabel, identifyAppVariant } from '../../src/shared/appVariant';

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

  it('maps win32/x64 with isWindowsStore=false explicitly to plain win-x64, same as the default', () => {
    expect(identifyAppVariant('win32', 'x64', false)).toEqual({ identifier: 'win-x64', labelKey: 'about.variantWinX64' });
  });

  it('maps win32/x64 with isWindowsStore=true to the distinct win-x64-msix variant', () => {
    expect(identifyAppVariant('win32', 'x64', true)).toEqual({ identifier: 'win-x64-msix', labelKey: 'about.variantWinX64Msix' });
  });

  it('ignores isWindowsStore on non-Windows platforms — it is not a generic "packaged" flag', () => {
    expect(identifyAppVariant('darwin', 'arm64', true)).toEqual({ identifier: 'mac-arm64', labelKey: 'about.variantMacArm64' });
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

/**
 * A tester may hold three builds called "0.3.17" in one week. The build a customer installs
 * says only "0.3.17", because which candidate it came from is none of their business.
 */
describe('formatBuildLabel', () => {
  it('shows a plain version for the Microsoft Store build, which carries no stamp', () => {
    expect(formatBuildLabel('0.3.17', '', '')).toBe('0.3.17');
  });

  it('names the candidate and the commit for a test build', () => {
    expect(formatBuildLabel('0.3.17', 'rc1', '69e4412')).toBe('0.3.17 (rc1, 69e4412)');
  });

  it('names the candidate alone when the commit was not stamped', () => {
    expect(formatBuildLabel('0.3.17', 'rc2', '')).toBe('0.3.17 (rc2)');
  });

  it('says nothing extra for a commit without a candidate — an unstamped build is not a candidate', () => {
    expect(formatBuildLabel('0.3.17', '', 'abc1234')).toBe('0.3.17');
  });

  it('survives an AppInfo that predates the stamp rather than blanking the support screen', () => {
    expect(formatBuildLabel('0.3.17', undefined, undefined)).toBe('0.3.17');
  });

  it('ignores whitespace that a build script might pass through', () => {
    expect(formatBuildLabel('0.3.17', '  ', ' abc1234 ')).toBe('0.3.17');
    expect(formatBuildLabel('0.3.17', ' rc3 ', ' abc1234 ')).toBe('0.3.17 (rc3, abc1234)');
  });
});
