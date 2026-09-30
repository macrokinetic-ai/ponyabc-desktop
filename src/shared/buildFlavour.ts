/**
 * Which of the two builds this is.
 *
 * Every commit produces two: the **Store** build, which is the only one ever submitted to the
 * Microsoft Store, and the **Internal** build, which is the same code plus testing mode and the
 * support tools. The difference is decided at build time, not at run time, so that a Store build
 * does not merely hide the testing paths — it does not contain them.
 *
 * `__PONYABC_INTERNAL__` is replaced by the literal `false` or `true` when the bundle is built
 * (electron.vite.config.ts). A `if (!IS_INTERNAL_BUILD) return …` guard therefore collapses to
 * dead code the bundler removes. `tests/unit/storeBuildHasNoDevPaths.test.ts` does not take that
 * on trust: it builds a Store bundle and reads it, looking for the strings that would prove
 * otherwise.
 */
declare const __PONYABC_INTERNAL__: boolean;

export const IS_INTERNAL_BUILD: boolean =
  typeof __PONYABC_INTERNAL__ === 'boolean'
    ? __PONYABC_INTERNAL__
    : // Only ever reached under the test runner, which does not apply the build-time define.
      // A real build always has the literal, so this branch cannot decide a shipped app.
      typeof process !== 'undefined' && process.env?.PONYABC_INTERNAL === '1';

/** What the app calls itself. The Internal build is a different product to Windows. */
export const INTERNAL_PRODUCT_NAME = 'PonyABC Desktop Internal';

/**
 * Every environment override and developer affordance, named in one place so an audit is a
 * list rather than a search. None of these exists in a Store build.
 */
export const DEVELOPER_ONLY_SWITCHES = [
  'PONYABC_DEMO_DATA',
  'PONYABC_DEMO_FIRMWARE',
  'PONYABC_DEMO_FIRMWARE_DIR',
  'PONYABC_LOCALE',
  'PONYABC_TEST_VOLUMES_ROOT',
  'PONYABC_TEST_COMPUTER_FOLDER',
  'PONYABC_MSIX_FIRMWARE_PROBE',
  'PONYABC_MSIX_FIRMWARE_PROBE_OUTPUT',
  'PONYABC_MSIX_PROBE_DELAY_SECONDS',
] as const;
