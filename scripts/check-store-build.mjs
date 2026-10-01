#!/usr/bin/env node
/**
 * Proves the STORE build contains none of the developer or testing paths.
 *
 * It reads the bytes that would ship. Not the source, and not a build-time flag: a guard the
 * bundler failed to remove looks exactly like one it removed, until you look at the artefact.
 * This found three real leaks the first time it ran — a comment naming a switch, a dialog title,
 * and the tester header's name.
 *
 *   npm run build:store && node scripts/check-store-build.mjs
 *
 * A separate script rather than a unit test on purpose: building inside the test suite made the
 * suite start a second npm, which is not portable to Windows and slowed another test enough to
 * time it out.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN = path.join(ROOT, 'out/main/index.js');
const RENDERER = path.join(ROOT, 'out/renderer/assets');

if (!fs.existsSync(MAIN)) {
  console.error(`No build at ${MAIN}. Run: npm run build:store`);
  process.exit(2);
}

const main = fs.readFileSync(MAIN, 'utf8');
const renderer = fs
  .readdirSync(RENDERER)
  .filter((f) => f.endsWith('.js'))
  .map((f) => fs.readFileSync(path.join(RENDERER, f), 'utf8'))
  .join('\n');

/** Every developer switch, mirroring DEVELOPER_ONLY_SWITCHES in src/shared/buildFlavour.ts. */
const SWITCHES = [
  'PONYABC_DEMO_DATA',
  'PONYABC_DEMO_FIRMWARE',
  'PONYABC_DEMO_FIRMWARE_DIR',
  'PONYABC_LOCALE',
  'PONYABC_TEST_VOLUMES_ROOT',
  'PONYABC_TEST_COMPUTER_FOLDER',
  'PONYABC_MSIX_FIRMWARE_PROBE',
  'PONYABC_MSIX_FIRMWARE_PROBE_OUTPUT',
  'PONYABC_MSIX_PROBE_DELAY_SECONDS',
];

const CHECKS = [
  ['a developer environment switch', SWITCHES, [main]],
  ['the demonstration catalogue', ['Cantonese Nursery Rhymes', 'Art for Little Ones', 'grandma-stories.axb'], [main]],
  ['testing mode', ['testingMode.json', 'X-PonyABC-Tester-Key', 'INTERNAL TEST BUILD'], [main, renderer]],
  // Not the bare words "Choose folder…" — the recordings screen has its own, for customers.
  // These two strings belong to the by-hand vendor-package picker and to nothing else.
  ['the by-hand firmware picker', ['Select the extracted firmware package folder', 'Internal: choose a firmware folder'], [main, renderer]],
  // The technical log: the panel, its heading and its step wording. None of it is translated, so
  // these exact strings are the whole of it — if any appears, the panel shipped.
  //
  // Deliberately NOT the `ponyabc:technical:*` channel names. Those live in the shared channel
  // table and the Store build does register handlers for them, wired to the stub: the getter
  // answers with an empty list and nothing is ever recorded, because `technical()` compiles to an
  // empty function. Same as testing mode's channels. A name with no panel, no recorder and no
  // caller is not a feature that shipped; the wording below is what would prove one had.
  //
  // Every needle below is checked to be PRESENT in the Internal bundle by
  // tests/unit/technicalLogNeedles.test.ts. 'Deleted BOOK/' was here first and could never have
  // fired: the panel builds that line as `Deleted ${detail}`, so the literal in the bundle is
  // 'Deleted ' and the longer needle matched nothing in either build. A check that cannot fail
  // is worse than no check, because it reads like one that passed.
  [
    'the technical log',
    ['Technical log', 'Index reset requested', 'Index reset FAILED', 'Index reset done', 'Nothing yet. Sync a book'],
    [main, renderer],
  ],
  ['an unresolved build flag', ['__PONYABC_INTERNAL__'], [main, renderer]],
];

const found = [];
for (const [what, needles, haystacks] of CHECKS) {
  for (const needle of needles) {
    if (haystacks.some((hay) => hay.includes(needle))) found.push(`${what}: ${needle}`);
  }
}

if (found.length > 0) {
  console.error('The STORE build contains things it must not:\n  ' + found.join('\n  '));
  console.error('\nEverything internal belongs behind @internal / @internal-ui, which the Store');
  console.error('build aliases to a file of do-nothing exports. See src/main/internal/.');
  process.exit(1);
}

const total = CHECKS.reduce((n, [, needles]) => n + needles.length, 0);
console.log(`Store build checked — ${total} strings, none present:`);
for (const [what, needles] of CHECKS) console.log(`  ${what} (${needles.length})`);
