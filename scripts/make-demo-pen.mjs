#!/usr/bin/env node
// Builds a throwaway "pen" on disk for the manual screenshots — a plain folder with the two
// directories the app looks for, some recordings in it, and a matching userData directory.
//
// This exists so the screenshots show the app doing real work: the pen is detected by the same
// code that detects a real pen, the recordings are real files that are really backed up,
// really relabelled and really restored. Nothing here ever touches a real pen — the whole
// fixture lives under the output directory this script creates.
//
// Usage: node scripts/make-demo-pen.mjs <out-dir> --locale=en [--stale-index]

import fs from 'node:fs';
import path from 'node:path';

const [outDir, ...rest] = process.argv.slice(2);
if (!outDir) {
  console.error('Usage: node scripts/make-demo-pen.mjs <out-dir> --locale=en [--stale-index]');
  process.exit(2);
}
const arg = (name, fallback) => {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const locale = arg('locale', 'en');
const staleIndex = rest.includes('--stale-index');
/** Builds everything except the pen itself — the fixture for "no pen connected". */
const noPen = rest.includes('--no-pen');

/** One book record in the pen's index is 44 bytes — see src/main/services/bookIndexReset.ts. */
const BOOK_INDEX_RECORD_BYTES = 44;

/**
 * A real, playable MP3 of silence.
 *
 * Every frame is a valid MPEG-1 Layer III header (128 kbps, 44.1 kHz, mono) followed by zeroed
 * payload. A synthesised file keeps the fixture self-contained — no audio asset to ship, no
 * sample of a real child's voice anywhere near the repo.
 */
function silentMp3(seconds) {
  const FRAME_BYTES = 417; // 128 kbps @ 44.1 kHz
  const FRAMES_PER_SECOND = 38.28;
  const frames = Math.max(1, Math.round(seconds * FRAMES_PER_SECOND));
  const frame = Buffer.alloc(FRAME_BYTES);
  frame[0] = 0xff;
  frame[1] = 0xfb; // MPEG-1 Layer III, no CRC
  frame[2] = 0x90; // 128 kbps, 44.1 kHz
  frame[3] = 0xc0; // mono
  return Buffer.concat(Array.from({ length: frames }, () => frame));
}

// The app is pointed at this directory with PONYABC_TEST_VOLUMES_ROOT, so its volume scan
// finds exactly this fixture and never looks at /Volumes. A real pen plugged into the same
// machine is therefore invisible to the app during a capture — it cannot be selected, read
// or written, by construction rather than by care.
const volumesRoot = path.join(outDir, 'volumes');
const penDir = path.join(volumesRoot, 'PONYABC');
const bookDir = path.join(penDir, 'BOOK');
const diyDir = path.join(penDir, 'DIY');
const userDataDir = path.join(outDir, 'userData');
const computerDir = path.join(outDir, 'Saved recordings');

fs.rmSync(outDir, { recursive: true, force: true });
const dirs = noPen ? [volumesRoot, userDataDir, computerDir] : [volumesRoot, bookDir, diyDir, userDataDir, computerDir];
for (const dir of dirs) fs.mkdirSync(dir, { recursive: true });

if (noPen) {
  fs.writeFileSync(
    path.join(userDataDir, 'settings.json'),
    JSON.stringify({ version: 1, locale, lastPenRootPath: null, lastComputerFolderPath: computerDir }, null, 2),
  );
  console.log(JSON.stringify({ volumesRoot, penDir: null, userDataDir, computerDir, diyDir: null, bookDir: null }));
  process.exit(0);
}

// --- BOOK: enough files for the book-list check to have something to count ----------------
const BOOKS = ['0451.axb', '0452.axb', '0453.axb', '0454.axb'];
for (const name of BOOKS) fs.writeFileSync(path.join(bookDir, name), Buffer.alloc(64 * 1024));

// The pen's own index. Sized to match the books present — unless we deliberately want the
// "your pen's book list doesn't match" screen, where the index is one record short, exactly
// what a parent who dragged a book in with Finder ends up with.
const indexRecords = staleIndex ? BOOKS.length - 1 : BOOKS.length;
fs.writeFileSync(path.join(bookDir, 'BOOKFILE.BIN'), Buffer.alloc(indexRecords * BOOK_INDEX_RECORD_BYTES));
fs.writeFileSync(path.join(bookDir, '1.BIN'), Buffer.alloc(0));

// --- DIY: the recordings, named the way the pen names them (sticker number) ---------------
const RECORDINGS = [
  { name: '0451.mp3', seconds: 22 },
  { name: '0452.mp3', seconds: 14 },
  { name: '0453.mp3', seconds: 31 },
  { name: '0455.mp3', seconds: 9 },
];
for (const r of RECORDINGS) fs.writeFileSync(path.join(diyDir, r.name), silentMp3(r.seconds));

// --- userData: settings + one label already given, so the list is not all bare numbers ----
fs.writeFileSync(
  path.join(userDataDir, 'settings.json'),
  JSON.stringify({ version: 1, locale, lastPenRootPath: penDir, lastComputerFolderPath: computerDir }, null, 2),
);

const penVolumeLabel = path.basename(penDir);
const labels = locale === 'zh-Hant'
  ? { '0451.mp3': '媽媽唸的晚安故事', '0452.mp3': '婆婆唱的兒歌' }
  : { '0451.mp3': "Mum's bedtime story", '0452.mp3': "Grandma's song" };
fs.writeFileSync(path.join(userDataDir, 'recordingLabels.json'), JSON.stringify({ [penVolumeLabel]: labels }, null, 2));

console.log(JSON.stringify({ volumesRoot, penDir, userDataDir, computerDir, diyDir, bookDir }));
