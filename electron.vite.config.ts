import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: { alias: { '@shared': resolve('src/shared') } },
    // Stamped into the build so a tester can tell one 0.3.17 from another. Both are empty
    // unless the build sets them, which is why the Microsoft Store build — built by the same
    // command without them — shows a plain version number. See formatBuildLabel.
    define: {
      __PONYABC_BUILD_TAG__: JSON.stringify(process.env.PONYABC_BUILD_TAG ?? ''),
      __PONYABC_BUILD_COMMIT__: JSON.stringify((process.env.PONYABC_BUILD_COMMIT ?? '').slice(0, 7)),
    },
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
