import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    build: {
      rollupOptions: {
        output: {
          // Sandboxed preload scripts (webPreferences.sandbox: true) are loaded through
          // Electron's own preload loader, which does NOT support ESM `import` syntax —
          // only CommonJS. package.json has "type": "module" (for the main process, which
          // runs unsandboxed and supports ESM fine), so a plain ".js" output here would
          // still be interpreted as ESM; force ".cjs" so Node/Electron parses it as CommonJS.
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer'),
      },
    },
    plugins: [react()],
  },
});
