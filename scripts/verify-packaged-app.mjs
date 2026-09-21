#!/usr/bin/env node
// Drives a packaged build of the app via the Chrome DevTools Protocol and asserts the
// renderer actually rendered the real UI (not a blank/failed screen). This exists because
// "the process launched and printed nothing for 5 seconds" is NOT sufficient verification —
// a white-screened renderer (e.g. from a broken preload) produces exactly that same silence.
//
// Usage: node scripts/verify-packaged-app.mjs "/path/to/PonyABC Desktop.app/Contents/MacOS/PonyABC Desktop"

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// The global WebSocket is only unconditionally available from Node 22+ — this repo's CI pins
// Node 20 (build-windows.yml), where it's undefined (confirmed by a real CI failure in the
// sibling capture-screenshots.mjs script, which shares this exact pattern). Importing the `ws`
// package directly works identically on every Node version this project actually runs on.
import WebSocket from 'ws';

const appPath = process.argv[2];
if (!appPath) {
  console.error('Usage: node scripts/verify-packaged-app.mjs <path-to-app-executable>');
  process.exit(2);
}

const DEBUG_PORT = 9333;
const logPath = path.join(os.tmpdir(), `ponyabc-verify-${Date.now()}.log`);
const logStream = fs.createWriteStream(logPath);

const child = spawn(appPath, [`--remote-debugging-port=${DEBUG_PORT}`, '--disable-gpu'], {
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.pipe(logStream);
child.stderr.pipe(logStream);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForTarget() {
  for (let attempt = 0; attempt < 20; attempt++) {
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

function evaluateInPage(webSocketDebuggerUrl, expression) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(webSocketDebuggerUrl);
    const id = 1;
    const timeout = setTimeout(() => {
      ws.close();
      reject(new Error('CDP Runtime.evaluate timed out'));
    }, 8000);

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
    });
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data.toString());
      if (msg.id === id) {
        clearTimeout(timeout);
        ws.close();
        if (msg.result?.exceptionDetails) {
          reject(new Error(`Page evaluation threw: ${JSON.stringify(msg.result.exceptionDetails)}`));
        } else {
          resolve(msg.result.result.value);
        }
      }
    });
    ws.addEventListener('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

async function main() {
  await sleep(1500); // let the app process spin up before polling CDP
  const target = await waitForTarget();
  console.log(`[verify] found renderer target: ${target.url}`);

  const probe = `(() => JSON.stringify({
    title: document.title,
    navButtonCount: document.querySelectorAll('.nav-item').length,
    navLabels: Array.from(document.querySelectorAll('.nav-item')).map(el => el.textContent),
    hasPonyAbcApi: typeof window.ponyabc !== 'undefined',
    bodyTextSample: document.body.innerText.slice(0, 300),
    startupFailureVisible: document.body.innerText.includes('failed to start'),
  }))()`;

  const raw = await evaluateInPage(target.webSocketDebuggerUrl, probe);
  const result = JSON.parse(raw);
  console.log('[verify] page state:', JSON.stringify(result, null, 2));

  const ok = result.hasPonyAbcApi === true && result.navButtonCount === 5 && !result.startupFailureVisible;

  if (!ok) {
    console.error('[verify] FAILED — packaged renderer did not show the expected 5-tab UI with a working preload bridge.');
    console.error(`[verify] main/renderer process log: ${logPath}`);
    console.error(fs.readFileSync(logPath, 'utf-8'));
    child.kill('SIGTERM');
    process.exit(1);
  }

  console.log('[verify] PASSED — 5 nav tabs rendered, window.ponyabc is defined, no startup-failure screen.');
  child.kill('SIGTERM');
  process.exit(0);
}

main().catch((err) => {
  console.error('[verify] ERROR:', err);
  try {
    console.error(`[verify] main/renderer process log: ${logPath}`);
    console.error(fs.readFileSync(logPath, 'utf-8'));
  } catch {
    // log file may not exist yet
  }
  child.kill('SIGTERM');
  process.exit(1);
});
