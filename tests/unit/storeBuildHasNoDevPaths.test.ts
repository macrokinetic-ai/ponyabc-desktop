import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DEVELOPER_ONLY_SWITCHES } from '../../src/shared/buildFlavour';

/**
 * The Store build must not merely hide the testing paths — it must not contain them.
 *
 * This does not take the build-time flag on trust, and it does not read the source. It builds a
 * Store bundle the way CI builds one, then reads the bytes that would ship, looking for the
 * things that would prove a developer path came along. A guard that the bundler failed to
 * remove is exactly the kind of mistake that looks fine in review.
 *
 * It is slow — a real build — so it runs only where a built bundle is wanted anyway.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const MAIN_BUNDLE = path.join(ROOT, 'out/main/index.js');
const RENDERER_DIR = path.join(ROOT, 'out/renderer');

let storeBundle = '';
let rendererBundle = '';

beforeAll(() => {
  execFileSync('npm', ['run', 'build'], {
    cwd: ROOT,
    // The Store build is the one with the flag OFF. Everything else is the same command.
    env: { ...process.env, PONYABC_INTERNAL: '0', PONYABC_BUILD_TAG: '', PONYABC_BUILD_COMMIT: '' },
    stdio: 'pipe',
  });
  storeBundle = fs.readFileSync(MAIN_BUNDLE, 'utf8');
  rendererBundle = fs
    .readdirSync(path.join(RENDERER_DIR, 'assets'))
    .filter((f) => f.endsWith('.js'))
    .map((f) => fs.readFileSync(path.join(RENDERER_DIR, 'assets', f), 'utf8'))
    .join('\n');
}, 180_000);

afterAll(() => {
  // Leave the tree holding an Internal build rather than a Store one, so a developer running
  // the app straight after the tests gets the build they were working on.
  execFileSync('npm', ['run', 'build'], { cwd: ROOT, env: { ...process.env, PONYABC_INTERNAL: '1' }, stdio: 'pipe' });
}, 180_000);

describe('the Store build', () => {
  it('names none of the developer environment switches', () => {
    const found = DEVELOPER_ONLY_SWITCHES.filter((name) => storeBundle.includes(name));
    expect(found).toEqual([]);
  });

  it('carries no demonstration catalogue', () => {
    for (const fixture of ['Cantonese Nursery Rhymes', 'Art for Little Ones', 'grandma-stories.axb']) {
      expect(storeBundle).not.toContain(fixture);
    }
  });

  it('carries no testing mode, in the main process or on screen', () => {
    for (const marker of ['testingMode.json', 'X-PonyABC-Tester-Key', 'INTERNAL TEST BUILD']) {
      expect(storeBundle).not.toContain(marker);
      expect(rendererBundle).not.toContain(marker);
    }
  });

  it('offers no way to pick a firmware folder by hand', () => {
    // The vendor-package picker is a support tool: it runs an unsigned vendor flasher against
    // whatever folder someone points at.
    expect(storeBundle).not.toContain('Select the extracted firmware package folder');
    expect(rendererBundle).not.toContain('Test/support: select a local folder');
  });

  it('says it is not internal', () => {
    // The literal the bundler substituted. If this is true in a Store bundle, everything above
    // is meaningless.
    expect(storeBundle).not.toMatch(/__PONYABC_INTERNAL__/);
  });
});
