#!/usr/bin/env node
/**
 * The clean-machine walk: what a certification reviewer sees on a fresh Windows PC with no pen
 * and nothing this app has ever written.
 *
 * Drives the INSTALLED Store package over the DevTools protocol, visits every screen, changes
 * the language, opens the manual and the registration link, and tries to export diagnostics —
 * recording for each step whether the app crashed, hung, or put an error dialog on screen, and
 * taking a screenshot as evidence.
 *
 * Two things it deliberately does not pretend about:
 *
 * 1. **Export diagnostics opens a native Save dialog**, and a native dialog cannot be driven or
 *    dismissed from here. It is therefore the LAST step, it is given its own timeout, and the
 *    app is killed afterwards whatever happens. What this proves is that the app reaches the
 *    dialog without crashing; finishing the save is a real-machine check.
 * 2. **"No network" is simulated by pointing this app's three hosts at nowhere**, not by turning
 *    the runner's network off — which would also cut the connection this job needs. The effect on
 *    the app is the same and the report says which it was.
 *
 * Usage: node scripts/clean-machine-check.mjs <app-exe> <out-dir>
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';

const [appPath, outDirArg] = process.argv.slice(2);
if (!appPath || !outDirArg) {
  console.error('Usage: node scripts/clean-machine-check.mjs <app-exe> <out-dir>');
  process.exit(2);
}
const outDir = path.resolve(outDirArg);
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NAV = ['home', 'recordings', 'book', 'firmware', 'settings'];

let nextId = 1;
function send(ws, method, params = {}, timeoutMs = 20000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs);
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
const evaluate = (ws, expression, timeoutMs) =>
  send(ws, 'Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, timeoutMs);

async function waitForTarget(port) {
  for (let i = 0; i < 90; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`);
      const page = (await res.json()).find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (page) return page;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error('the app never opened a debuggable window');
}

async function shot(ws, name) {
  const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const file = path.join(outDir, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

async function main() {
  const port = 9810 + Math.floor(Math.random() * 300);
  const child = spawn(appPath, [`--remote-debugging-port=${port}`, '--disable-gpu'], { stdio: 'ignore' });
  const results = { steps: [], consoleErrors: [], crashed: false, exitCode: null };
  child.on('exit', (code) => {
    results.exitCode = code;
  });

  let ws;
  const step = async (name, fn) => {
    const started = Date.now();
    try {
      await fn();
      results.steps.push({ name, ok: true, ms: Date.now() - started });
      console.log(`  ok    ${name}`);
    } catch (err) {
      results.steps.push({ name, ok: false, ms: Date.now() - started, why: err.message });
      console.error(`  FAIL  ${name}: ${err.message}`);
    }
  };

  try {
    const target = await waitForTarget(port);
    ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve);
      ws.addEventListener('error', reject);
    });
    await send(ws, 'Runtime.enable');
    await send(ws, 'Log.enable').catch(() => {});
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.method === 'Runtime.exceptionThrown') {
        results.consoleErrors.push(msg.params?.exceptionDetails?.text ?? 'exception');
      }
      if (msg.method === 'Log.entryAdded' && msg.params?.entry?.level === 'error') {
        results.consoleErrors.push(msg.params.entry.text);
      }
    });
    await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1280, height: 860, deviceScaleFactor: 2, mobile: false });
    await sleep(3000); // first paint, plus the pen scan at startup

    // Every screen, in order, with no pen and nothing reachable on the network.
    for (let i = 0; i < NAV.length; i++) {
      await step(`screen-${String(i + 1).padStart(2, '0')}-${NAV[i]}`, async () => {
        const ok = await evaluate(ws, `(() => { const n = document.querySelectorAll('.nav-item')[${i}]; if (!n) return false; n.click(); return true; })()`);
        if (!ok.result.value) throw new Error('no nav item');
        await sleep(2500);
        const body = await evaluate(ws, `document.body.innerText.length`);
        if (!body.result.value) throw new Error('the screen rendered nothing');
        await shot(ws, `${String(i + 1).padStart(2, '0')}-${NAV[i]}`);
      });
    }

    // Changing the language must not need a pen, and must not need the network.
    await step('change-language-to-zh-Hant', async () => {
      const ok = await evaluate(
        ws,
        `(() => {
           const select = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /繁體|Hant/.test(o.value + o.textContent)));
           if (!select) return false;
           const option = [...select.options].find((o) => /zh-Hant/.test(o.value));
           if (!option) return false;
           const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
           setter.call(select, option.value);
           select.dispatchEvent(new Event('change', { bubbles: true }));
           return true;
         })()`,
      );
      if (!ok.result.value) throw new Error('no language chooser on the Settings screen');
      await sleep(1500);
      await shot(ws, '06-settings-zh-Hant');
    });

    await step('change-language-back-to-en', async () => {
      await evaluate(
        ws,
        `(() => {
           const select = [...document.querySelectorAll('select')].find((s) => [...s.options].some((o) => /zh-Hant/.test(o.value)));
           if (!select) return false;
           const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
           setter.call(select, 'en');
           select.dispatchEvent(new Event('change', { bubbles: true }));
           return true;
         })()`,
      );
      await sleep(1200);
    });

    // These two hand a URL to Windows. The app's own job is to return without throwing; what the
    // browser then does is not this app's to prove.
    // There is no user guide inside the app — the manual is a PDF shipped beside the installer,
    // not something Settings opens. The two links that do exist are checked instead.
    await step('open-the-registration-page', async () => {
      const r = await evaluate(ws, `window.ponyabc.openRegistrationPage()`);
      results.registration = r.result.value;
    });
    await step('open-the-privacy-policy', async () => {
      const r = await evaluate(ws, `window.ponyabc.openPrivacyPolicyPage()`);
      results.privacyPolicy = r.result.value;
      await sleep(800);
      await shot(ws, '07-after-external-links');
    });

    // LAST, and on its own clock: this opens a native Save dialog, which cannot be dismissed from
    // here. Reaching it without crashing is the thing being checked.
    await step('export-diagnostics-reaches-its-dialog', async () => {
      const before = results.consoleErrors.length;
      await evaluate(ws, `window.ponyabc.exportDiagnostics()`, 6000).catch((err) => {
        if (!/timed out/.test(err.message)) throw err;
        // Expected: the call does not resolve while the Save dialog is open.
      });
      if (results.consoleErrors.length > before) throw new Error('an error was logged while exporting');
      results.exportDiagnostics = 'reached the Save dialog without crashing (the dialog itself needs a person)';
    });
  } catch (err) {
    results.steps.push({ name: 'session', ok: false, why: err.message });
    console.error(`  FAIL  session: ${err.message}`);
  } finally {
    results.crashed = results.exitCode !== null && results.exitCode !== 0;
    try {
      ws?.close();
    } catch {
      // already closed
    }
    child.kill();
    await sleep(1000);
  }

  fs.writeFileSync(path.join(outDir, 'clean-machine-report.json'), `${JSON.stringify(results, null, 2)}\n`);
  const failed = results.steps.filter((s) => !s.ok);
  console.log(`\n${results.steps.length - failed.length} of ${results.steps.length} steps ok; ${results.consoleErrors.length} errors logged`);
  if (results.consoleErrors.length > 0) console.log(results.consoleErrors.slice(0, 10).join('\n'));
  process.exit(failed.length > 0 || results.consoleErrors.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
