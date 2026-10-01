#!/usr/bin/env node
/**
 * Does any button wrap, and does any screen scroll sideways — in every language, at both window
 * sizes the owner cares about?
 *
 * Written because the alternative is eighty screenshots and a pair of eyes. A wrapped button has
 * a measurable signature: its rendered height is more than one line of text. Sideways scroll has
 * one too: scrollWidth greater than clientWidth. Both are asked of the real rendered page.
 *
 * Usage: node scripts/layout-check.mjs <app-exe> [--locales=en,...] [--out=<dir>]
 */

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The app path is optional: with none, the dev build in out/ is driven through the system
// Electron. Anything starting with -- is a flag, not a path.
const argv = process.argv.slice(2);
const appPathArg = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
const rest = argv.filter((a) => a !== appPathArg);
const argOf = (n, d) => {
  const hit = rest.find((a) => a.startsWith(`--${n}=`));
  return hit ? hit.split('=').slice(1).join('=') : d;
};
const locales = argOf('locales', 'en,zh-Hant,zh-Hans,es,fr,de,it,pt').split(',').map((s) => s.trim()).filter(Boolean);
const outDir = argOf('out', '');
const VIEWPORTS = [
  // 1280x800 is first because it is where the defect actually lives. The owner's rc5 screenshots
  // were taken at 1280 logical pixels, and at 1366 or wider the panes are roomy enough that the
  // buttons never get squeezed — so checking only the two sizes asked for would have reported a
  // clean bill of health for a layout that was visibly broken.
  { name: '1280x800', width: 1280, height: 800 },
  { name: '1366x768', width: 1366, height: 768 },
  { name: '1920x1080', width: 1920, height: 1080 },
];
const NAV = ['home', 'recordings', 'book', 'firmware', 'settings'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ponyabc-layout-'));

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
const evaluate = (ws, expr) => send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });

async function waitForTarget(port) {
  for (let i = 0; i < 60; i++) {
    try {
      const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  throw new Error('the app never opened a debuggable window');
}

/** A button is "wrapped" when it is taller than one line of its own text. */
const MEASURE = `(() => {
  const offences = [];
  const doc = document.documentElement;
  if (doc.scrollWidth > doc.clientWidth + 1) {
    offences.push({ kind: 'page-scrolls-sideways', detail: doc.scrollWidth + ' > ' + doc.clientWidth });
  }
  // .home-entry is a navigation CARD with a title and a paragraph — multi-line on purpose.
  for (const el of document.querySelectorAll('button, .button')) {
    if (el.classList.contains('home-entry') || el.closest('.home-entry')) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)
      + parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const lines = Math.round((r.height - padding) / line);
    const text = (el.textContent || '').trim().slice(0, 40);
    // Two kinds of button, two rules.
    //
    // A PILL is a short label in a row of actions — Play, Rename, 播放, 改名. It must never wrap:
    // Chinese has no spaces, so a wrapped pill breaks to one character per line and renders as a
    // circle, which is the thing being fixed.
    //
    // A SENTENCE LABEL is a whole phrase on a button, in the narrow column between the two
    // Advanced-tools panes or in a pane header. Those are allowed two lines, because
    // "Substituir o áudio deste autocolante…" does not fit on one at any sane column width.
    // Three or more is still a defect.
    const isPill = !!el.closest('.recordings-list, .pane__toolbar, .book-toolbar');
    const maxLines = isPill ? 1 : 2;
    if (lines > maxLines) {
      offences.push({
        kind: isPill ? 'pill-wraps' : 'label-wraps-too-far',
        detail: text + ' (' + lines + ' lines, max ' + maxLines + ', ' + Math.round(r.width) + 'x' + Math.round(r.height) + ')',
      });
    }
    if (el.scrollWidth > el.clientWidth + 1) offences.push({ kind: 'button-clipped', detail: text });
  }
  return offences;
})()`;

function buildFixture(dir, locale) {
  const r = spawnSync(process.execPath, [path.join(REPO_ROOT, 'scripts/make-demo-pen.mjs'), dir, `--locale=${locale}`], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`make-demo-pen failed: ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}

async function runLocale(locale, results) {
  const fixture = buildFixture(path.join(workRoot, locale), locale);
  const port = 9900 + Math.floor(Math.random() * 400);
  const electron = appPathArg || createRequire(import.meta.url)('electron');
  const args = appPathArg
    ? [`--remote-debugging-port=${port}`, `--user-data-dir=${fixture.userDataDir}`, '--disable-gpu']
    : [REPO_ROOT, `--remote-debugging-port=${port}`, `--user-data-dir=${fixture.userDataDir}`, '--disable-gpu'];
  const child = spawn(electron, args, {
    stdio: 'ignore',
    // PONYABC_TEST_VOLUMES_ROOT works on a dev build and is harmless on a Store one, where the
    // fixture is found through the saved pen path instead.
    env: { ...process.env, PONYABC_LOCALE: locale, PONYABC_TEST_VOLUMES_ROOT: fixture.volumesRoot },
  });

  let ws;
  try {
    const target = await waitForTarget(port);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    await sleep(2000);

    for (const vp of VIEWPORTS) {
      await send(ws, 'Emulation.setDeviceMetricsOverride', { width: vp.width, height: vp.height, deviceScaleFactor: 1, mobile: false });
      await sleep(400);
      for (let i = 0; i < NAV.length; i++) {
        await evaluate(ws, `(() => { const n = document.querySelectorAll('.nav-item')[${i}]; if (n) n.click(); return true; })()`);
        await sleep(650);
        const found = (await evaluate(ws, MEASURE)).result.value ?? [];
        if (process.env.LAYOUT_DEBUG) {
          const seen = (await evaluate(ws, "document.querySelectorAll('button, .button').length + '/' + document.querySelectorAll('.recordings-list .button').length")).result.value;
          console.log('    [' + NAV[i] + ' ' + vp.name + '] buttons all/in-list: ' + seen);
        }
        for (const o of found) {
          results.push({ locale, viewport: vp.name, screen: NAV[i], ...o });
          console.log(`  ✗ ${locale} ${vp.name} ${NAV[i]}: ${o.kind} — ${o.detail}`);
        }
        if (outDir && found.length > 0) {
          const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' });
          fs.mkdirSync(outDir, { recursive: true });
          fs.writeFileSync(path.join(outDir, `${locale}-${vp.name}-${NAV[i]}.png`), Buffer.from(data, 'base64'));
        }
      }
    }
  } finally {
    try {
      ws?.close();
    } catch {
      /* already closed */
    }
    child.kill();
    await sleep(500);
  }
}

const results = [];
for (const locale of locales) {
  console.log(locale);
  await runLocale(locale, results);
}
fs.rmSync(workRoot, { recursive: true, force: true });
console.log(`\n${locales.length} languages x ${VIEWPORTS.length} sizes x ${NAV.length} screens — ${results.length} layout problem(s)`);
process.exit(results.length > 0 ? 1 : 0);
