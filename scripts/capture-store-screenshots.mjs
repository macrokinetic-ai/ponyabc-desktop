#!/usr/bin/env node
/**
 * The screenshots for the Microsoft Store listing, taken from the STORE build.
 *
 * Why this is separate from capture-manual-screenshots.mjs: that script points the app at a
 * throwaway pen with `PONYABC_TEST_VOLUMES_ROOT`, and that is a developer environment switch,
 * which the Store build does not contain. Pointing the Store build at a fixture therefore has to
 * use a path a customer actually takes.
 *
 * It does. When a scan finds no pen under the real volume roots, the app falls back to the last
 * pen path it was told about (`scanPenRoot` in src/main/ipc/penRoot.ts — "in case it's a
 * non-standard mount point our scan doesn't cover"). `make-demo-pen.mjs` already writes that path
 * into the fixture's settings.json, so launching the Store build with `--user-data-dir` pointed
 * at the fixture makes it find the pen the same way a returning customer's app does. No switch,
 * no internal code, and the same binary that goes to Microsoft.
 *
 * Everything in the pictures is real: the recordings are real MP3s, the backup is made by
 * pressing the real button, and the restore clash is a real clash, produced by changing a
 * recording on the "pen" between two steps exactly as a parent re-recording one would.
 *
 * Usage:
 *   node scripts/capture-store-screenshots.mjs <app-exe> <out-dir> [--locales=en,zh-Hant]
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [appPath, outDirArg, ...rest] = process.argv.slice(2);
if (!appPath || !outDirArg) {
  console.error('Usage: node scripts/capture-store-screenshots.mjs <app-exe> <out-dir> [--locales=en,zh-Hant]');
  process.exit(2);
}
const outDir = path.resolve(outDirArg);
const argOf = (name, fallback) => {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const locales = argOf('locales', 'en,zh-Hant').split(',').map((s) => s.trim()).filter(Boolean);
// Where the fixture pen lives. It matters more than it looks: the app shows how much room is
// left on the VOLUME the pen is on, so a fixture sitting on the machine's own system drive makes
// the app truthfully report that drive — "126.3 GB of 160.5 GB used on your pen", on a product
// whose card is 16 GB. Correct behaviour, wrong picture. The workflow hands this a small mounted
// volume so the figures are a real reading of a realistically-sized disk.
const fixtureRoot = argOf('fixture-root', '');
const workRoot = fixtureRoot
  ? fs.mkdtempSync(path.join(fixtureRoot, 'shots-'))
  : fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-store-shots-'));

const NAV = { home: 0, recordings: 1, book: 2, firmware: 3, settings: 4 };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ the CDP plumbing ---- */

let nextId = 1;
function send(ws, method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20000);
    const onMessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
    };
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}
const evaluate = (ws, expression) => send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });

async function waitForTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await res.json();
      const page = targets.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error('the app never opened a debuggable window');
}

/**
 * Every picture the same size: 2560x2000.
 *
 * Partner Center takes PNGs from 1366x768 up to 3840x2160. Capturing the full page instead gave
 * 2560x2954 for the restore screen — over the height limit, and a set of listing images in five
 * different shapes. A fixed viewport with the interesting panel scrolled into it is both inside
 * the limits and a consistent set.
 */
const SHOT_WIDTH = 1280;
const SHOT_HEIGHT = 1000;

async function capture(ws, file, scrollTo) {
  await send(ws, 'Emulation.setDeviceMetricsOverride', {
    width: SHOT_WIDTH,
    height: SHOT_HEIGHT,
    deviceScaleFactor: 2,
    mobile: false,
  });
  await sleep(300);
  if (scrollTo) {
    await evaluate(
      ws,
      `(() => {
         const el = document.querySelector(${JSON.stringify(scrollTo)});
         if (el) el.scrollIntoView({ block: 'center' });
         return true;
       })()`,
    );
    await sleep(400);
  }
  let data;
  try {
    ({ data } = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }));
  } catch {
    await sleep(1500);
    ({ data } = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }));
  }
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
}

/* ------------------------------------------------------------------------ the screens ---- */

/**
 * `click` matches a button by the text it shows, in whatever language — the Store build has no
 * test ids, and adding them so a screenshot can be taken would be changing the product to
 * photograph it.
 *
 * The text is read from the locale files rather than written here. It was written here first,
 * and the next change to those strings broke the capture: the Chinese word for the pen was
 * corrected and the script went on looking for a button that no longer existed. One source.
 */
function buttonText(locale) {
  const file = path.join(REPO_ROOT, 'src/renderer/i18n/locales', locale, 'recordings.json');
  const strings = JSON.parse(fs.readFileSync(file, 'utf8'));
  const backUp = strings?.backup?.button;
  const putBack = strings?.restore?.button;
  if (!backUp || !putBack) throw new Error(`${locale}/recordings.json has no backup.button or restore.button`);
  return { backUp, putBack };
}

const SHOTS = [
  { id: '01-home', nav: 'home', wait: 1200 },
  { id: '02-books', nav: 'book', wait: 2500 },
  // The backup is made here, by pressing the real button, so the next picture shows a real one.
  { id: '03-recordings-backed-up', nav: 'recordings', click: 'backUp', wait: 2600, scrollTo: '.dual-pane' },
  // A real clash: the pen's copy of 0451 is changed after the backup was taken, exactly as it
  // would be if the child recorded over it. Restoring then has something to ask about.
  { id: '04-restore-choice', host: 'changeOneRecording', click: 'putBack', wait: 2200, scrollTo: '.plan-panel' },
  { id: '05-firmware', nav: 'firmware', wait: 2000 },
];

const HOST = {
  changeOneRecording(fixture) {
    const target = path.join(fixture.diyDir, '0451.mp3');
    const bytes = fs.readFileSync(target);
    // Same length, different contents: a different take of the same sticker number.
    bytes.fill(0x55, Math.floor(bytes.length / 2));
    fs.writeFileSync(target, bytes);
  },
};

function buildFixture(dir, locale) {
  const result = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/make-demo-pen.mjs'), dir, `--locale=${locale}`], {
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`make-demo-pen failed: ${result.stderr}`);
  return JSON.parse(result.stdout.trim().split('\n').pop());
}

async function clickByText(ws, text) {
  const ok = await evaluate(
    ws,
    `(() => {
       const wanted = ${JSON.stringify(text)};
       const button = [...document.querySelectorAll('button')].find((b) => (b.textContent || '').includes(wanted) && !b.disabled);
       if (!button) return false;
       button.click();
       return true;
     })()`,
  );
  return ok.result.value === true;
}

async function runLocale(locale, results) {
  const dir = path.join(workRoot, locale);
  const fixture = buildFixture(dir, locale);
  const port = 9700 + Math.floor(Math.random() * 400);

  const child = spawn(appPath, [`--remote-debugging-port=${port}`, `--user-data-dir=${fixture.userDataDir}`, '--disable-gpu'], {
    stdio: 'ignore',
    // Deliberately no PONYABC_* anything. The Store build would ignore them, and passing them
    // would make this capture prove less than it does: the locale and the pen both come from
    // the fixture's settings.json, which is where a returning customer's come from too.
    env: { ...process.env },
  });

  let ws;
  try {
    const target = await waitForTarget(port);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false });
    await sleep(2000); // first paint, plus the pen scan the app runs at startup

    for (const shot of SHOTS) {
      try {
        if (shot.nav !== undefined) {
          const ok = await evaluate(ws, `(() => { const n = document.querySelectorAll('.nav-item')[${NAV[shot.nav]}]; if (!n) return false; n.click(); return true; })()`);
          if (!ok.result.value) throw new Error(`no nav item for ${shot.nav}`);
          await sleep(900);
        }
        if (shot.host) HOST[shot.host](fixture);
        if (shot.click) {
          const text = buttonText(locale)[shot.click];
          if (!(await clickByText(ws, text))) throw new Error(`no enabled button saying "${text}"`);
        }
        if (shot.wait) await sleep(shot.wait);

        const file = path.join(outDir, `${shot.id}-${locale}.png`);
        await capture(ws, file, shot.scrollTo);
        results.captured.push({ shot: shot.id, locale, file, bytes: fs.statSync(file).size });
        console.log(`  ${path.basename(file)}`);
      } catch (err) {
        results.failed.push({ shot: shot.id, locale, why: err.message });
        console.error(`  ! ${shot.id} (${locale}): ${err.message}`);
      }
    }
  } catch (err) {
    for (const shot of SHOTS) {
      if (!results.captured.some((c) => c.shot === shot.id && c.locale === locale)) {
        results.failed.push({ shot: shot.id, locale, why: err.message });
      }
    }
    console.error(`  ! ${locale}: ${err.message}`);
  } finally {
    try {
      ws?.close();
    } catch {
      // already closed
    }
    child.kill();
    await sleep(800);
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const results = { captured: [], failed: [] };
  for (const locale of locales) {
    console.log(`\n${locale}`);
    await runLocale(locale, results);
  }
  fs.writeFileSync(path.join(outDir, 'capture-report.json'), `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\n${results.captured.length} captured, ${results.failed.length} failed`);
  fs.rmSync(workRoot, { recursive: true, force: true });
  // A missing Store screenshot is a missing deliverable, not a warning.
  process.exit(results.failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
