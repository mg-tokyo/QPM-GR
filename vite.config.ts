import { defineConfig } from 'vite';

const PROFILE_BUILD = process.env.PROFILE === '1';

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
        drop_debugger: true,
        passes: 2
      },
      // keep_fnames + keep_classnames are gated on PROFILE=1. Release builds
      // mangle names (~224 KB raw / ~38 KB gzip win); user bug-report stack
      // traces show mangled names. To retrace hot functions/classes on a
      // flame chart (tick, processVariantJobs, guardTick, TimerManager, …),
      // rebuild with `PROFILE=1 SOURCEMAP=inline npm run build`.
      mangle: {
        keep_fnames: PROFILE_BUILD,
        keep_classnames: PROFILE_BUILD
      },
      keep_fnames: PROFILE_BUILD,
      keep_classnames: PROFILE_BUILD,
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
