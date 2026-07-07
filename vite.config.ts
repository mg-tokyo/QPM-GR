import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: {
      entry: 'src/main.ts',
      name: 'QuinoaPetManager',
      fileName: 'quinoa-pet-manager',
      formats: ['iife']
    },
    outDir: 'dist',
    // Opt-in inline sourcemap for perf retrace builds. Default off — the
    // ~10 MB base64 map inflates dist/QPM.user.js to ~12 MB, which is slow
    // enough for Tampermonkey to inject at document-start that QPM's early
    // GM_xmlhttpRequest / atom-probe timeouts fire before init completes
    // (manifest.json, pet slot discovery, catalog enrichment). Enable only
    // for one-off diagnostic builds via `SOURCEMAP=inline npm run build`.
    sourcemap: process.env.SOURCEMAP === 'inline' ? 'inline' : false,
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true
      },
      // keep_fnames + keep_classnames: name-only attribution insurance policy.
      // Even if DevTools fails to attach the inline map on chrome-extension://
      // origins, hot functions (tick, processVariantJobs, guardTick, …) and
      // classes (TimerManager, AtomPoller, JobQueue) still surface with
      // readable names in the flame chart.
      mangle: {
        keep_fnames: true,
        keep_classnames: true
      },
      keep_fnames: true,
      keep_classnames: true,
      format: {
        comments: false
      }
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true
      }
    }
  },
  define: {
    'process.env.NODE_ENV': '"production"'
  }
});
