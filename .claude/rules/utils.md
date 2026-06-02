---
paths: src/utils/**/*
---

# Utils rules (QPM-GR)

`src/utils/` contains cross-cutting helpers used anywhere in the repo, organized into purpose-based subfolders.

## Structure
```
src/utils/
├── scheduling/          # timerManager, scheduling, debounce, jobQueue
├── dom/                 # dom helpers, canvasHelpers, virtualScroll
├── game/                # catalogHelpers, cropMultipliers, weatherDetection, plantScales
├── restock/             # dataService, parser, types, accuracy
├── rendering/           # petCardRenderer, petMutationRenderer
├── storage.ts           # GM_* storage wrappers (root — imported everywhere)
├── logger.ts            # createLogger (root — imported everywhere)
├── formatters.ts        # formatCoins, formatNumber, formatDuration (root)
├── environment.ts       # Environment detection (root)
├── versionChecker.ts    # Version check (root)
└── helpers.ts           # Misc utilities (root)
```

## Structural rules
- Utils must not import from `src/features/` or `src/ui/`.
- One concept per file; split if it grows too large.
- No side effects in helper functions.
- Storage must go through `src/utils/storage.ts`.
- Group new utils into the appropriate subfolder. Only foundational helpers (storage, logger, formatters) stay at root.

## Utility inventory

### `scheduling/timerManager.ts`
Never use raw `setInterval` or `setTimeout` for recurring work. Use the rAF-based singleton:
- `visibleInterval(id, cb, ms)` — pauses when tab is hidden. Preferred for most features.
- `criticalInterval(id, cb, ms)` — keeps running when hidden. Use only for time-critical polling.
- `managedInterval(id, cb, ms, opts)` — low-level; accepts `priority` (critical/normal/low) and `runWhenHidden`.
- Cleanup: `timerManager.destroy(id)` in the feature's stop/destroy function.

### `scheduling/debounce.ts`
Three exports (prefer these over equivalents in `helpers.ts` or `scheduling.ts`):
- `debounce(fn, ms)` — trailing debounce.
- `throttle(fn, ms)` — leading + trailing throttle.
- `debounceCancelable(fn, ms)` — returns `{ fn, cancel }`. Call `.cancel()` in cleanup to prevent post-destroy fires.

### `dom/dom.ts`
- `waitFor(selector, opts?)` — waits for an `Element` matching a CSS selector.
  - **Not the same as `scheduling/scheduling.ts:waitFor`**, which polls a boolean predicate.
- `getGameHudRoot()` — returns the game's HUD root element.
- `onAdded(root, selector, cb)` / `onRemoved(root, selector, cb)` — MutationObserver helpers; both return a `DisconnectHandle` for cleanup.

### `scheduling/scheduling.ts`
- `waitFor(predicate, opts?)` — polls a boolean predicate until true (NOT a CSS selector lookup).
- `yieldToBrowser()` — async yield between heavy phases in `main.ts`.

### `formatters.ts` (root)
Always use these for consistent UI output; never format numbers inline:
- `formatCoins(n)` — coin value display.
- `formatNumber(n)` — K/M/B abbreviation.
- `formatDuration(ms)` — human-readable time (e.g. "2m 30s").
- `formatPercentage(n)` — percentage string.

### `game/catalogHelpers.ts`
Preferred over raw `gameCatalogs.ts` for UI code — returns safe fallbacks instead of throwing:
- `getPlantSpeciesSafe(key)` — returns `PlantSpecies | null`.
- `isValidMutation(name)` — boolean check.
- `getAbilityName(id)` — safe ability label lookup.
- `normalizeSpeciesKey(value)` — canonical key normalization (strips suffixes, whitespace, punctuation). Use for fuzzy species matching from user input or external strings.

### `storage.ts` (root)
- `storage.get(key)` / `storage.set(key, value)` / `storage.remove(key)`.
- `storage.clear()` — **destructive**: deletes all `qpm.*`, `quinoa*`, and `QPM_STORAGE_KEYS` entries. Only call on explicit user action.
- Register all new keys in the `QPM_STORAGE_KEYS` array at the top of `storage.ts`.

### `scheduling/jobQueue.ts`
For deferred/batched work with an 8ms per-tick budget:
- `getGlobalJobQueue()` — returns the singleton `JobQueue`.
- `startGlobalJobQueueTicker()` — starts the scheduler (called once from `main.ts`).
- `JobQueue.enqueue(job, priority?)` — adds a job with deduplication.

### `dom/virtualScroll.ts`
For lists with 100+ items; uses IntersectionObserver + scroll events:
- `new VirtualScroll(container, items, renderItem, opts)`.
- Always call `.destroy()` in the window's cleanup.

### `helpers.ts` (root)
General-purpose utilities. Key exports:
- `normalizeSpeciesKey(value)` — see catalogHelpers above.
- Miscellaneous array/object/string utilities.
- Note: contains a `debounce` implementation but prefer `scheduling/debounce.ts` exports for consistency.

### `logger.ts` (root)
- `createLogger(prefix)` — returns `{ log, warn, error }`.
- Use a feature-specific prefix (e.g. `[QPM:AutoFavorite]`). Do not use raw `console.log` in production paths.

## Common mistakes
- Using `setInterval`/`setTimeout` instead of `scheduling/timerManager`
- Confusing `dom/dom.ts:waitFor` (CSS selector) with `scheduling/scheduling.ts:waitFor` (boolean predicate)
- Calling `storage.clear()` without an explicit user trigger
- Formatting numbers or durations inline instead of using `formatters.ts`
- Using `debounce` from `helpers.ts` or `scheduling.ts` when `scheduling/debounce.ts` is preferred, especially for cleanup (`debounceCancelable`)
- Building large lists without `dom/virtualScroll` when items exceed ~100
