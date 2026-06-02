# Core rules (QPM-GR)

These rules apply everywhere in the repo.

## 1) Game compatibility (non-negotiable)
- Avoid hardcoding game data (plants/items/pets/shops/mutations/etc.).
  - Prefer runtime catalogs from `src/catalogs/*` or Jotai atoms where appropriate.
- Sprite rendering must go through the sprite system (see `src/sprite-v2/*`).
  - Do not manually fetch atlas frames or bake sprite lists.

## 2) Boundaries (keep the repo sane)
- UI rendering lives in `src/ui/` only.
- DOM patching for game UI should be isolated and reversible (see UI Inject rules).
- State access should go through store helpers in `src/store/*` or Jotai bridge (`src/core/jotaiBridge.ts`).
- Avoid ad-hoc globals as a second source of truth.

## 3) Side effects & cleanup (no leaks)
- No side effects on import (no listeners, intervals, patches, WS sends, etc.).
- Every subscription/listener/interval must have cleanup and be idempotent.
- Replace `setInterval`/`setTimeout` for recurring work with `timerManager` (`src/utils/scheduling/timerManager.ts`):
  - `visibleInterval(id, cb, ms)` — pauses when tab is hidden. Use for most features.
  - `criticalInterval(id, cb, ms)` — continues running when hidden. Use only for time-sensitive polling.
  - Always call `timerManager.destroy(id)` in feature cleanup.
- For user-facing alerts, use `src/core/notifications.ts` — not custom DOM toasts:
  - `notify({ feature, level, message })` — broadcasts to all registered listeners.
  - `onNotifications(cb)` — registers a listener and returns an unsubscribe function (add to cleanups).
- For cross-feature signaling, use `CustomEvent` with `qpm:` prefix.
- For cross-realm CustomEvents (firing in both userscript sandbox and page), use `dispatchCustomEventAll` from `src/core/pageContext.ts` instead of `window.dispatchEvent`.

## 4) Storage
- Use `src/utils/storage.ts` (GM_* wrappers + localStorage fallback).
- Keys should be prefixed consistently (`qpm.` or `quinoa`).
- Centralize keys in `src/utils/storage.ts`.
- **`storage.clear()` is destructive** — it deletes all keys matching `QPM_STORAGE_KEYS` + `qpm.*` + `quinoa*`. Only call on an explicit user action (e.g. "Reset all settings"), never automatically.

## 5) Code quality
- **File size limits (enforced)**:
  - **500 lines**: soft limit. Flag files approaching this and suggest splitting.
  - **750 lines**: hard limit. Files exceeding this MUST be split before adding more code.
  - When splitting, use the subfolder pattern: `src/features/<domain>/<name>/` with `index.ts` as the only public entry point.
- Keep functions small and single-purpose.
- Prefer explicit naming and early returns.
- Avoid magic numbers/strings; define constants.

## 6) TypeScript hygiene
- Avoid `any`; prefer `unknown` + narrowing.
- Keep public APIs minimal and stable.

## 7) Release version sync (automated)
- The **only** file you need to edit is `src/ui/sections/changelog-data.ts` — bump the version in `CHANGELOG[0]` and add notes.
- `npm run build` (or `npm run sync-version`) automatically syncs the version to `package.json`, `src/utils/versionChecker.ts`, and `scripts/build-userscript.js`.
- `npm run build:userscript` still validates all files match and fails on mismatch as a safety net.
