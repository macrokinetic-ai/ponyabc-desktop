#!/usr/bin/env node
/**
 * Builds one of the two flavours, portably.
 *
 *   node scripts/build-flavour.mjs store      the only build ever submitted to the Store
 *   node scripts/build-flavour.mjs internal   the same code plus testing mode and support tools
 *
 * A node wrapper rather than a cross-env dependency: two scripts do not justify a package, and
 * this one can say out loud which build it is making, which is worth more than brevity when the
 * difference between them is what a customer can reach.
 */
import { spawnSync } from 'node:child_process';

const flavour = process.argv[2];
if (flavour !== 'store' && flavour !== 'internal') {
  console.error('Usage: node scripts/build-flavour.mjs store|internal');
  process.exit(2);
}

const internal = flavour === 'internal';
console.log(
  internal
    ? 'Building the INTERNAL build — testing mode and support tools included.'
    : 'Building the STORE build — no testing mode, no support tools, no developer switches.',
);

const result = spawnSync('npx', ['electron-vite', 'build'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, PONYABC_INTERNAL: internal ? '1' : '0' },
});
process.exit(result.status ?? 1);
