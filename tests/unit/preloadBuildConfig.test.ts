import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import config from '../../electron.vite.config';

// Regression guard for the exact bug that shipped a blank window: the preload script was
// built as ESM (import/export) but loaded into a sandboxed BrowserWindow (webPreferences.sandbox:
// true), which only supports CommonJS preload scripts — contextBridge never ran, window.ponyabc
// was undefined, and the renderer's bootstrap threw before ever rendering the app shell.
describe('preload build must produce sandbox-compatible CommonJS', () => {
  it('electron.vite.config.ts forces cjs output with a .cjs extension for the preload build', () => {
    const output = config.preload?.build?.rollupOptions?.output as { format?: string; entryFileNames?: string } | undefined;
    expect(output?.format).toBe('cjs');
    // Must be .cjs, not .js — package.json has "type": "module", so a plain ".js" file would
    // still be parsed as ESM regardless of its actual (CommonJS) content.
    expect(output?.entryFileNames).toBe('[name].cjs');
  });

  it('src/main/window.ts loads the preload script from the same path the build actually emits', () => {
    const windowSource = fs.readFileSync(path.resolve(__dirname, '../../src/main/window.ts'), 'utf-8');
    expect(windowSource).toContain("'../preload/index.cjs'");
    expect(windowSource).not.toContain('index.mjs');
    expect(windowSource).not.toContain("preload/index.js'");
  });

  it('sandbox stays enabled — the fix must not disable it to work around the ESM restriction', () => {
    const windowSource = fs.readFileSync(path.resolve(__dirname, '../../src/main/window.ts'), 'utf-8');
    expect(windowSource).toMatch(/sandbox:\s*true/);
    expect(windowSource).toMatch(/contextIsolation:\s*true/);
    expect(windowSource).toMatch(/nodeIntegration:\s*false/);
  });
});
