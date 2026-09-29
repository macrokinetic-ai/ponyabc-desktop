#!/usr/bin/env node
// Drives a running build of the app via the Chrome DevTools Protocol (same low-level pattern as
// scripts/verify-packaged-app.mjs) and captures a real PNG screenshot of each main nav section —
// for Store listing screenshots, never hand-drawn mockups. Platform-agnostic: point it at any
// launchable app executable (a dev `out/` build via the system Electron binary, a packaged .app,
// or a packaged Windows .exe) with `--remote-debugging-port`.
//
// Usage: node scripts/capture-screenshots.mjs <path-to-app-executable> <output-dir> [--label=macos]

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
// The global WebSocket is only unconditionally available from Node 22+ — this repo's CI pins
// Node 20 (build-windows.yml), where it's undefined, confirmed by a real CI failure
// ("ReferenceError: WebSocket is not defined"), not assumed. Importing the `ws` package directly
// works identically on every Node version this project actually runs on.
import WebSocket from 'ws';

const [appPath, outDir, ...rest] = process.argv.slice(2);
if (!appPath || !outDir) {
  console.error('Usage: node scripts/capture-screenshots.mjs <path-to-app-executable> <output-dir> [--label=macos]');
  process.exit(2);
}
const labelArg = rest.find((a) => a.startsWith('--label='));
const label = labelArg ? labelArg.split('=')[1] : 'app';

const DEBUG_PORT = 9334;
fs.mkdirSync(outDir, { recursive: true });

// When launching the bare Electron binary (a dev `out/` build) rather than a packaged app,
// Electron needs the project directory (containing package.json's "main") as its first
// positional argument — otherwise it opens its own built-in default app instead of ours.
const electronAppDir = process.env.ELECTRON_APP_DIR;
const spawnArgs = electronAppDir
  ? [electronAppDir, `--remote-debugging-port=${DEBUG_PORT}`, '--disable-gpu']
  : [`--remote-debugging-port=${DEBUG_PORT}`, '--disable-gpu'];

const child = spawn(appPath, spawnArgs, {
  stdio: 'ignore',
});

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
      if (res.ok) {
        const targets = await res.json();
        const page = targets.find((t) => t.type === 'page' && t.url.includes('index.html'));
        if (page) return page;
      }
    } catch {
      // CDP endpoint not up yet.
    }
    await sleep(500);
  }
  throw new Error('CDP target for index.html never appeared within timeout');
}

function sendCommand(ws, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 1_000_000);
    const timeout = setTimeout(() => reject(new Error(`CDP ${method} timed out`)), 10_000);
    function onMessage(event) {
      const msg = JSON.parse(event.data.toString());
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.removeEventListener('message', onMessage);
        if (msg.error) reject(new Error(`CDP ${method} error: ${JSON.stringify(msg.error)}`));
        else resolve(msg.result);
      }
    }
    ws.addEventListener('message', onMessage);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

const SECTIONS = [
  { index: 0, name: 'home' },
  { index: 1, name: 'my-recordings' },
  { index: 2, name: 'book-library' },
  { index: 3, name: 'firmware' },
  { index: 4, name: 'settings' },
];

async function main() {
  const target = await waitForTarget();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });

  // A real screenshot needs the actual rendered viewport, not the default headless-ish size.
  await sendCommand(ws, 'Emulation.setDeviceMetricsOverride', {
    width: 1280,
    height: 860,
    deviceScaleFactor: 2,
    mobile: false,
  });

  for (const section of SECTIONS) {
    const clickResult = await sendCommand(ws, 'Runtime.evaluate', {
      expression: `(() => {
        const items = document.querySelectorAll('.nav-item');
        if (items[${section.index}]) { items[${section.index}].click(); return true; }
        return false;
      })()`,
      returnByValue: true,
    });
    if (!clickResult.result?.value) {
      console.warn(`Could not find nav item ${section.index} (${section.name}) — skipping`);
      continue;
    }
    await sleep(700); // allow the section to render (async data fetches, transitions)

    const { data } = await sendCommand(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    const outPath = path.join(outDir, `${label}-${section.name}.png`);
    fs.writeFileSync(outPath, Buffer.from(data, 'base64'));
    console.log(`Captured ${outPath}`);
  }

  ws.close();
  child.kill();
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    child.kill();
    process.exit(1);
  });
