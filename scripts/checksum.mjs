// Writes a `<file>.sha256` sidecar next to every installer in release/, run automatically
// after each dist:mac:*/dist:win packaging step. Filenames are produced directly by
// electron-builder's own artifactName config (see electron-builder.yml / package.json) —
// this script never renames anything, it only checksums whatever is already there.
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, writeFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const releaseDir = path.resolve('release');

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

async function main() {
  if (!existsSync(releaseDir)) return;
  const entries = await readdir(releaseDir);
  const installers = entries.filter(
    (name) => name.endsWith('.dmg') || name.endsWith('.exe') || name.endsWith('.appx'),
  );
  for (const name of installers) {
    const filePath = path.join(releaseDir, name);
    const digest = await sha256(filePath);
    writeFileSync(`${filePath}.sha256`, `${digest}  ${name}\n`);
    console.log(`${digest}  ${name}`);
  }
}

main();
