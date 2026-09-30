import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * The strings `scripts/check-store-build.mjs` looks for must exist to be worth looking for.
 *
 * rc6 shipped a needle that could never have fired: `'Deleted BOOK/'`, when the panel builds that
 * line as `Deleted ${detail}` and the literal in the bundle is `'Deleted '`. It matched nothing in
 * either build, so it reported a pass every time, for both. A check that cannot fail is worse than
 * no check — it looks like coverage.
 *
 * This reads the source of the Internal panel rather than a built bundle, so it runs in the
 * ordinary test suite with no build step: every needle must be a literal that panel really
 * contains.
 */

const REPO = path.resolve(__dirname, '../..');

/** The same list as the 'the technical log' check in scripts/check-store-build.mjs. */
const NEEDLES = ['Technical log', 'Index reset requested', 'Index reset FAILED', 'Index reset done', 'Nothing yet. Sync a book'];

describe('the Store-build check looks for strings that exist', () => {
  const panel = fs.readFileSync(path.join(REPO, 'src/renderer/internal/index.tsx'), 'utf8');
  const stub = fs.readFileSync(path.join(REPO, 'src/renderer/internal/stub.tsx'), 'utf8');

  it.each(NEEDLES)('the Internal panel contains %j', (needle) => {
    expect(panel).toContain(needle);
  });

  it.each(NEEDLES)('the Store stub contains no %j', (needle) => {
    expect(stub).not.toContain(needle);
  });

  it('the checker still asks for exactly these, so the two lists cannot drift', () => {
    const checker = fs.readFileSync(path.join(REPO, 'scripts/check-store-build.mjs'), 'utf8');
    const block = checker.slice(checker.indexOf("'the technical log'"));
    const listed = block.slice(0, block.indexOf(']')).match(/'([^']+)'/g) ?? [];
    const names = listed.map((q) => q.slice(1, -1)).filter((n) => n !== 'the technical log');
    expect(names.sort()).toEqual([...NEEDLES].sort());
  });
});
