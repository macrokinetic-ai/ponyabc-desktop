import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        // The one line that decides what the Store build contains. Aliased to a file of
        // do-nothing exports unless this is the Internal build, so the demonstration
        // catalogue, testing mode, the developer switches and the by-hand firmware picker are
        // not merely switched off — they are not in the bundle, and neither are their names.
        '@internal': resolve(
          process.env.PONYABC_INTERNAL === '1' ? 'src/main/internal/index.ts' : 'src/main/internal/stub.ts',
        ),
      },
    },
    // Stamped into the build so a tester can tell one 0.3.17 from another. Both are empty
    // unless the build sets them, which is why the Microsoft Store build — built by the same
    // command without them — shows a plain version number. See formatBuildLabel.
    define: {
      __PONYABC_BUILD_TAG__: JSON.stringify(process.env.PONYABC_BUILD_TAG ?? ''),
      __PONYABC_BUILD_COMMIT__: JSON.stringify((process.env.PONYABC_BUILD_COMMIT ?? '').slice(0, 7)),
      // The literal that decides which of the two builds this is. Written as a literal so the
      // bundler removes the other build's code rather than shipping it switched off.
      __PONYABC_INTERNAL__: process.env.PONYABC_INTERNAL === '1' ? 'true' : 'false',
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
    define: {
      __PONYABC_INTERNAL__: process.env.PONYABC_INTERNAL === '1' ? 'true' : 'false',
    },
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@': resolve('src/renderer'),
        // Same switch as the main process: the Store build imports a file of components that
        // render nothing, so the testing screens and their words are not in its bundle.
        '@internal-ui': resolve(
          process.env.PONYABC_INTERNAL === '1'
            ? 'src/renderer/internal/index.tsx'
            : 'src/renderer/internal/stub.tsx',
        ),
      },
    },
    plugins: [react()],
  },
});
