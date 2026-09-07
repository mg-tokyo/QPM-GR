// vitest setup: minimal window stub so modules that read `window` at import
// time (pageContext.ts:11 and its transitive importers — logger, notifications,
// storage) load under the node environment used by pure-module tests.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
  (globalThis as unknown as { window: typeof globalThis }).window = globalThis;
}
