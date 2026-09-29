#!/usr/bin/env node
/**
 * Every screen in the parent manual, photographed from the real app, in each language.
 *
 * One Electron launch per state — a state is a fixture plus an environment — then a short
 * scripted walk to the screen and a full-page capture. The app is pointed at a throwaway pen
 * folder (scripts/make-demo-pen.mjs) via PONYABC_TEST_VOLUMES_ROOT, so a real pen plugged into
 * the same machine is invisible to it and can neither be read nor written.
 *
 * Steps are written against class names rather than button text, so the same walk works in
 * every language.
 *
 * Usage:
 *   node scripts/capture-manual-screenshots.mjs <out-dir> [--locales=en,zh-Hant] [--only=03,04]
 *
 * The app executable defaults to this repo's dev build (out/ + the system Electron binary);
 * pass --app=<path> to photograph a packaged build instead.
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const [outDirArg, ...rest] = process.argv.slice(2);
if (!outDirArg) {
  console.error('Usage: node scripts/capture-manual-screenshots.mjs <out-dir> [--locales=en,zh-Hant] [--only=03]');
  process.exit(2);
}
const outDir = path.resolve(outDirArg);
const argOf = (name, fallback) => {
  const hit = rest.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : fallback;
};
const locales = argOf('locales', 'en,zh-Hant').split(',').map((l) => l.trim()).filter(Boolean);
const only = argOf('only', '').split(',').map((s) => s.trim()).filter(Boolean);
const appPath = argOf('app', '');
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-manual-'));

const NAV = { home: 0, recordings: 1, book: 2, firmware: 3, settings: 4 };

/* --------------------------------------------------------------------- the screens ---- */
/** `shot` numbers are the manual's own order; the capture order below is whatever needs the
 *  fewest app launches. */
const GROUPS = [
  {
    id: 'home',
    fixture: {},
    steps: [
      { nav: 'home' },
      { shot: '01-home', wait: 900 },
    ],
  },
  {
    id: 'home-no-pen',
    fixture: { noPen: true },
    steps: [
      { nav: 'home' },
      { shot: '02-home-no-pen', wait: 900 },
    ],
  },
  {
    id: 'books-summary',
    fixture: {},
    env: { PONYABC_DEMO_DATA: 'summary' },
    steps: [
      { nav: 'book' },
      { shot: '03-books-summary', wait: 900 },
      // The same screen with the plain-words legend opened.
      { js: `document.querySelector('details.status-legend').open = true` },
      { shot: '09-books-legend', wait: 400 },
    ],
  },
  {
    id: 'books-up-to-date',
    fixture: {},
    env: { PONYABC_DEMO_DATA: 'uptodate' },
    steps: [
      { nav: 'book' },
      { shot: '04-books-up-to-date', wait: 900 },
    ],
  },
  {
    id: 'books-no-space',
    fixture: {},
    env: { PONYABC_DEMO_DATA: 'nospace' },
    steps: [
      { nav: 'book' },
      { wait: 700 },
      { click: '.book-summary__actions .button--primary' },
      { shot: '05-books-not-enough-space', wait: 900 },
    ],
  },
  {
    id: 'books-space-unknown',
    fixture: {},
    env: { PONYABC_DEMO_DATA: 'nospace-unknown' },
    steps: [
      { nav: 'book' },
      { wait: 700 },
      { click: '.book-summary__actions .button--primary' },
      { shot: '06-books-space-unknown', wait: 900 },
    ],
  },
  {
    id: 'books-synced',
    fixture: {},
    env: { PONYABC_DEMO_DATA: 'summary' },
    steps: [
      { nav: 'book' },
      { wait: 700 },
      { click: '.book-summary__actions .button--primary' },
      { shot: '07-books-sync-finished', wait: 2500 },
    ],
  },
  {
    id: 'books-fix-list',
    fixture: { staleIndex: true },
    env: { PONYABC_DEMO_DATA: 'uptodate' },
    steps: [
      { nav: 'book' },
      { shot: '08-books-fix-list', wait: 1200 },
    ],
  },
  {
    id: 'recordings',
    fixture: {},
    steps: [
      { nav: 'recordings' },
      { shot: '10-recordings', wait: 1200 },

      // Give a recording a name.
      { click: '.recordings-v2 .recordings-list__row:first-child .recordings-list__detail-actions .button:nth-child(2)' },
      { type: { sel: '.recordings-v2 .recordings-list__row:first-child input[type="text"]', text: 'Bedtime story' } },
      { shot: '14-recordings-label', wait: 400 },
      { click: '.recordings-v2 .recordings-list__row:first-child .recordings-list__detail .button:nth-child(2)' },

      // Move it to a different sticker.
      { click: '.recordings-v2 .recordings-list__row:first-child .recordings-list__detail-actions .button:nth-child(3)' },
      { type: { sel: '.recordings-v2 .recordings-list__row:first-child input[inputmode="numeric"]', text: '0460' } },
      { shot: '13-recordings-sticker', wait: 400 },
      { click: '.recordings-v2 .recordings-list__row:first-child .recordings-list__detail .button:nth-child(2)' },

      // Keep a copy.
      { click: '.recordings-v2 .pane:first-child .pane__header .button--primary' },
      { shot: '11-recordings-backed-up', wait: 2000 },

      // Make one recording on the pen differ from the backup, so putting the backup back has
      // something real to ask about.
      { host: 'divergeRecording' },
      { click: '.recordings-v2 .pane:nth-child(2) .pane__footer .button--primary' },
      { shot: '12-recordings-restore', wait: 2000 },
    ],
  },
  {
    id: 'firmware-success',
    windowsOnly: true,
    fixture: { firmwarePackage: true },
    env: { PONYABC_DEMO_FIRMWARE: 'success' },
    steps: [
      { nav: 'firmware' },
      { shot: '15-firmware-prepare', wait: 1200 },
      // The first step's Next sits directly in its section; every later one is in the
      // wizard's own action row.
      { click: 'section > .button--primary' },
      { shot: '16-firmware-package', wait: 800 },
      { click: '.collapsible__toggle[aria-expanded="false"]' },
      { click: '.collapsible__content .button' },
      { wait: 700 },
      { click: '.firmware-wizard__actions .button--primary' },
      { shot: '17-firmware-confirm', wait: 700 },
      { click: '.firmware-wizard__actions .button--primary' },
      { shot: '18-firmware-finished', wait: 2500 },
    ],
  },
  {
    id: 'firmware-not-started',
    windowsOnly: true,
    fixture: { firmwarePackage: true },
    env: { PONYABC_DEMO_FIRMWARE: 'not-started' },
    steps: [
      { nav: 'firmware' },
      { wait: 1000 },
      { click: 'section > .button--primary' },
      { wait: 600 },
      { click: '.collapsible__toggle[aria-expanded="false"]' },
      { click: '.collapsible__content .button' },
      { wait: 700 },
      { click: '.firmware-wizard__actions .button--primary' },
      { wait: 600 },
      { click: '.firmware-wizard__actions .button--primary' },
      { shot: '19-firmware-not-started', wait: 2500 },
    ],
  },
];

/* ------------------------------------------------------------------------- plumbing ---- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function buildFixture(dir, { locale, noPen, staleIndex, firmwarePackage }) {
  const args = [path.join(REPO_ROOT, 'scripts', 'make-demo-pen.mjs'), dir, `--locale=${locale}`];
  if (noPen) args.push('--no-pen');
  if (staleIndex) args.push('--stale-index');
  const res = spawnSync(process.execPath, args, { encoding: 'utf-8' });
  if (res.status !== 0) throw new Error(`fixture failed: ${res.stderr || res.stdout}`);
  const fixture = JSON.parse(res.stdout.trim().split('\n').pop());

  if (firmwarePackage) {
    // Only a path for the screen to show — the demo firmware path never reads it (see
    // src/main/services/demoFirmware.ts), and no vendor package or firmware image is involved.
    fixture.firmwarePackageDir = 'C:\\Users\\PonyABC\\Downloads\\P5-firmware-V1.26';
  }
  return fixture;
}

/** Host-side changes made part-way through a walk, where the point of the screen is that
 *  something on the pen changed behind the app's back. */
const HOST_ACTIONS = {
  divergeRecording(fixture) {
    const target = path.join(fixture.diyDir, '0451.mp3');
    const buf = fs.readFileSync(target);
    fs.writeFileSync(target, Buffer.concat([buf, buf.subarray(0, 40_000)]));
  },
};

function send(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1_000_000);
    const timer = setTimeout(() => reject(new Error(`CDP ${method} timed out`)), 20_000);
    function onMessage(event) {
      const msg = JSON.parse(event.data.toString());
      if (msg.id !== id) return;
      clearTimeout(timer);
      ws.removeEventListener('message', onMessage);
      if (msg.error) reject(new Error(`CDP ${method}: ${JSON.stringify(msg.error)}`));
      else resolve(msg.result);
    }
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const evaluate = (ws, expression) => send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });

async function waitForTarget(port) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json`);
      if (res.ok) {
        const page = (await res.json()).find((t) => t.type === 'page' && t.url.includes('index.html'));
        if (page) return page;
      }
    } catch {
      // not up yet
    }
    await sleep(500);
  }
  throw new Error('the app window never appeared');
}

async function capture(ws, file) {
  // The page is as tall as the window; the content usually is not. Measure the content and
  // crop to it, so the manual never carries half a page of empty background.
  const height = (
    await evaluate(
      ws,
      `(() => {
         const el = document.querySelector('.screen') || document.body;
         // The screen fills the window, so measure its last visible child instead.
         const kids = [...el.children].filter((c) => c.getBoundingClientRect().height > 0);
         const last = kids.length > 0 ? Math.max(...kids.map((c) => c.getBoundingClientRect().bottom)) : el.getBoundingClientRect().bottom;
         const bottom = Math.ceil(last + window.scrollY) + 28;
         return Math.max(560, Math.min(bottom, 2600));
       })()`,
    )
  ).result.value;
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1280, height, deviceScaleFactor: 2, mobile: false });
  await sleep(250);
  const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false });
  return file;
}

async function runGroup(group, locale, results) {
  const wanted = group.steps.filter((s) => s.shot).map((s) => s.shot);
  if (only.length > 0 && !wanted.some((s) => only.some((o) => s.startsWith(o)))) return;

  if (group.windowsOnly && process.platform !== 'win32') {
    for (const shot of wanted) results.skipped.push({ shot, locale, why: 'the firmware wizard only runs on Windows' });
    return;
  }

  const dir = path.join(workRoot, `${group.id}-${locale}`);
  const fixture = buildFixture(dir, { locale, ...(group.fixture ?? {}) });

  const port = 9400 + Math.floor(Math.random() * 500);
  // The electron package exports the real executable's path — never the .bin shim, which on
  // Windows is a .cmd that recent Node refuses to spawn without a shell.
  const electron = appPath || createRequire(import.meta.url)('electron');
  const args = appPath
    ? [`--remote-debugging-port=${port}`, `--user-data-dir=${fixture.userDataDir}`, '--disable-gpu']
    : [REPO_ROOT, `--remote-debugging-port=${port}`, `--user-data-dir=${fixture.userDataDir}`, '--disable-gpu'];

  const child = spawn(electron, args, {
    stdio: 'ignore',
    env: {
      ...process.env,
      ...(group.env ?? {}),
      PONYABC_LOCALE: locale,
      PONYABC_TEST_VOLUMES_ROOT: fixture.volumesRoot,
      ...(fixture.firmwarePackageDir ? { PONYABC_DEMO_FIRMWARE_DIR: fixture.firmwarePackageDir } : {}),
    },
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
    await sleep(1200); // first paint + the pen scan the app runs at startup

    for (const step of group.steps) {
      if (step.nav !== undefined) {
        const ok = await evaluate(ws, `(() => { const n = document.querySelectorAll('.nav-item')[${NAV[step.nav]}]; if (!n) return false; n.click(); return true; })()`);
        if (!ok.result.value) throw new Error(`no nav item for ${step.nav}`);
        await sleep(700);
      }
      if (step.click) {
        const ok = await evaluate(ws, `(() => { const el = document.querySelector(${JSON.stringify(step.click)}); if (!el) return false; el.click(); return true; })()`);
        if (!ok.result.value) throw new Error(`nothing matched ${step.click}`);
        await sleep(450);
      }
      if (step.type) {
        const ok = await evaluate(
          ws,
          `(() => {
             const el = document.querySelector(${JSON.stringify(step.type.sel)});
             if (!el) return false;
             const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
             setter.call(el, ${JSON.stringify(step.type.text)});
             el.dispatchEvent(new Event('input', { bubbles: true }));
             return true;
           })()`,
        );
        if (!ok.result.value) throw new Error(`no input matched ${step.type.sel}`);
        await sleep(250);
      }
      if (step.js) await evaluate(ws, step.js);
      if (step.host) HOST_ACTIONS[step.host](fixture);
      if (step.wait) await sleep(step.wait);
      if (step.shot) {
        const file = path.join(outDir, `${step.shot}-${locale}.png`);
        await capture(ws, file);
        results.captured.push({ shot: step.shot, locale, file, bytes: fs.statSync(file).size });
        console.log(`  ${path.basename(file)}`);
      }
    }
  } catch (err) {
    for (const shot of wanted) {
      if (!results.captured.some((c) => c.shot === shot && c.locale === locale)) {
        results.failed.push({ shot, locale, why: err.message });
      }
    }
    console.error(`  ! ${group.id} (${locale}): ${err.message}`);
  } finally {
    try {
      ws?.close();
    } catch {
      // already closed
    }
    child.kill();
    await sleep(600);
  }
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const results = { captured: [], skipped: [], failed: [] };

  for (const locale of locales) {
    console.log(`\n${locale}`);
    for (const group of GROUPS) await runGroup(group, locale, results);
  }

  fs.writeFileSync(path.join(outDir, 'capture-report.json'), JSON.stringify(results, null, 2));
  console.log(`\n${results.captured.length} captured, ${results.skipped.length} skipped, ${results.failed.length} failed`);
  for (const f of results.failed) console.log(`  FAILED ${f.shot}-${f.locale}: ${f.why}`);
  for (const s of results.skipped) console.log(`  SKIPPED ${s.shot}-${s.locale}: ${s.why}`);
  if (results.failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
