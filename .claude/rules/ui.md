# UI rules (QPM-GR)

QPM UI is window-based and rendered from `src/ui/`. UI files are organized by domain, mirroring `src/features/`. Shared infrastructure lives in `src/ui/core/`.

## Structure
```
src/ui/
|-- core/               # Shared: modalWindow, lazyWindow, panelHelpers, panelState, panelStyles, originalPanel
|-- hub/                # Main hub window (tab host)
|-- components/         # Shared UI components (searchInput, etc.)
|-- pets/               # Pet windows: hubWindow, hutchWindow, petsWindow/, optimizerWindow/, floatingCard/, pickerModal/, xpTracker/
|-- shop/               # Shop windows: restockWindow, restockAlerts/, itemRestockDetailWindow
|-- garden/             # Garden UI: gardenFiltersSection
|-- economy/            # Economy windows: cropCalculatorWindow, valueFloatingCard, storageValueWindow/Overlay
|-- locker/             # Locker UI: lockerSection, lockerTabPanels, lockerPrimitives, etc.
|-- stats/              # Stats windows: statsHubWindow/, trackerWindow, abilityAnalysis, statsSection, etc.
|-- standalone/         # Standalone UI: textureSwapperWindow, publicRoomsWindow/
|-- mutations/          # Mutation UI: mutationValueSection
|-- sections/           # Cross-cutting sections: controllerSection, activityLogSection, dashboardModules, etc.
|-- panel/              # Panel sub-components
|-- inject/             # Game UI injection features
|-- journalChecker/     # Journal checker UI
```

## 1) UI lives in src/ui
- All QPM-rendered DOM must live in `src/ui/`.
- Avoid DOM creation in `src/features/` unless explicitly an injection feature.

## 2) Window lifecycle
- Each window should support init/build and destroy/cleanup.
- Use the window system from `src/ui/core/modalWindow.ts` or `src/ui/core/lazyWindow.ts`.
- Ensure multiple toggles do not duplicate DOM nodes.

### `modalWindow.ts` — full API
- `toggleWindow(id, title, render, maxWidth?, maxHeight?)` — open/close toggle (most common).
- `openWindow(id, title, render, opts?)` — open explicitly.
- `closeWindow(id)` — close by ID.
- `closeAllWindows()` — close everything.
- `destroyWindow(id)` — close + remove from registry.
- `isWindowOpen(id)` — boolean check.
- `toggleMinimize(id)` — minimize/restore.
- Window positions are persisted under `qpm-window-pos-{id}` keys — these are **not** in `QPM_STORAGE_KEYS` (managed internally by modalWindow).

### `lazyWindow.ts` — deferred rendering
Use for hub tabs or any window with heavy rendering that should only build when first opened:
- `registerLazyWindow(id, title, render, opts?)` — registers but does not build.
- `toggleLazyWindow(id)` — open/close; builds content on first open.
- `invalidateWindow(id)` — marks the window stale so content rebuilds on next open (use after data changes).

## 3) Styles
- Scope styles to a unique container class or id.
- Avoid global selectors (e.g., `button { ... }`) which can leak into the game UI.
- Prefer minimal CSS and keep styling close to the UI file.

## 4) Responsiveness
- Avoid hardcoding absolute positions where possible.
- Constrain window sizes to viewport bounds (`max-height`, `max-width`).
- Ensure scrollable content for long lists.

## 5) Cleanup discipline
- Every event listener, observer, interval, or timeout created for UI must be removed.
- Track cleanups in an array and run all on destroy.

Example:
```ts
const cleanups: Array<() => void> = [];

function build(root: HTMLElement): void {
  const onResize = () => updateLayout();
  window.addEventListener('resize', onResize);
  cleanups.push(() => window.removeEventListener('resize', onResize));
}

function destroy(): void {
  cleanups.forEach(fn => fn());
  cleanups.length = 0;
  root.remove();
}
```

## 6) Injection vs QPM UI
- If you are patching the game's UI, use a dedicated inject feature (see `ui.inject` rules).
- Do not render QPM panels inside game-owned DOM trees.

## 7) DOM-heavy UI
- For lists exceeding ~100 items, use `VirtualScroll` from `src/utils/dom/virtualScroll.ts`. Always call `.destroy()` in cleanup.

## 8) Hub window pattern
- Aggregator windows that host multiple tabs/sub-windows live in their domain folder.
- Examples: `src/ui/hub/`, `src/ui/stats/statsHubWindow/`, `src/ui/pets/hubWindow.ts`
- Use `lazyWindow.ts` for deferred rendering of heavy tab content.
- Still follow the same lifecycle rules: idempotent build, cleanup on destroy, no duplicate DOM.

## Common mistakes
- Using `toggleWindow` when `lazyWindow` is more appropriate for heavy tab content
- Forgetting to call `invalidateWindow` after the underlying data changes
- Not calling `VirtualScroll.destroy()` in window cleanup
- Attaching styles to `document.head` without scoping
- Creating window DOM from a feature module
- Leaving observers or intervals running after the window closes
