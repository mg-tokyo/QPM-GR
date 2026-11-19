/// <reference types="vite/client" />
import { describe, expect, it, vi } from 'vitest';
import { storage } from './storage';

// vite.config.ts builds one IIFE with inlineDynamicImports, so every module's top-level code runs
// before initializeStorage. A storage.get there gets the GM copy, which can be older than the
// mirror (plan 2026-11-18-gm-weavermod T10a). Load-time reads must move into a function.
const MODULES = import.meta.glob(['/src/**/*.ts', '!/src/**/*.test.ts', '!/src/**/*.d.ts', '!/src/main.ts', '!/src/test-setup.ts']);

// Shown harmless (T10a handoff): versionChecker.ts:64 seeds a display cache the first check replaces
// and never writes back; abilityValuation.ts:709 and mutationSummary.ts:253 only gate a read-only
// debug global.
const ALLOWED_KEYS = new Set(['qpm.versionCheck.v1', 'qpm.debug.globals.v1']);

describe('module load', () => {
  it('no module reads a storage key while it loads', async () => {
    vi.stubEnv('DEV', false); // isDebugGlobalsEnabled reads storage only outside dev builds
    vi.stubGlobal('document', { readyState: 'complete', hidden: false, visibilityState: 'visible', addEventListener: () => {}, removeEventListener: () => {} });
    const realGet = storage.get.bind(storage);
    let current = '';
    const reads: string[] = [];
    vi.spyOn(storage, 'get').mockImplementation(((key: string, fallback?: unknown) => {
      if (!ALLOWED_KEYS.has(key)) reads.push(`${current} → ${key}`);
      return realGet(key, fallback);
    }) as typeof storage.get);

    const failures: string[] = [];
    for (const [path, load] of Object.entries(MODULES)) {
      current = path;
      try { await load(); } catch (error) { failures.push(`${path}: ${String(error)}`); }
    }

    expect(Object.keys(MODULES).length).toBeGreaterThan(1000);
    expect(failures).toEqual([]);
    expect(reads).toEqual([]);
  }, 120_000);
});
