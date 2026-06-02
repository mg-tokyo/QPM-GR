---
paths: src/ui/**/*
---

# UI Sections rules (QPM-GR)

QPM uses window-based panels rather than a formal tab/section registry, but some windows act like sections (e.g., Pet Hub tabs inside `src/ui/pets/hubWindow.ts`). If you introduce a reusable section pattern, follow this guidance.

## Structure (recommended if you add sections)
```
src/ui/sections/<SectionName>/
|-- index.ts          # Public exports only
|-- section.ts        # build/destroy lifecycle
|-- state.ts          # JSON-serializable state
|-- styles.css.ts     # Optional scoped styles
|-- parts/            # Optional sub-features
```

## Required lifecycle
- `build(container)` must be idempotent (no duplicate DOM).
- `destroy()` must remove all listeners, observers, and DOM nodes.
- Sections should not depend on other sections.

Example:
```ts
let root: HTMLElement | null = null;
const cleanups: Array<() => void> = [];

export function build(container: HTMLElement): void {
  if (root) return;
  root = document.createElement('div');
  root.className = 'qpm-section';

  const onResize = () => { /* ... */ };
  window.addEventListener('resize', onResize);
  cleanups.push(() => window.removeEventListener('resize', onResize));

  container.appendChild(root);
}

export function destroy(): void {
  cleanups.forEach(fn => fn());
  cleanups.length = 0;
  root?.remove();
  root = null;
}
```

## State rules
- Section state must be JSON-serializable.
- Use a stable ID for persistence (e.g., `tab-pet-hub`).
- Bump version when state shape changes.

## Real-world example
See `src/ui/sections/controllerSection.ts` — a production section that renders controller configuration inside the Utility Hub. It uses the `build/destroy` lifecycle with a cleanup array, guards against duplicate DOM, and avoids storing DOM references in state.

## Common mistakes
- Building twice without guarding against existing DOM
- Forgetting to clean up window listeners on destroy
- Storing DOM nodes or functions in state
