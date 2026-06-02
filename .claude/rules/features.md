---
paths: src/features/**/*
---

# Features rules (QPM-GR)

Features are optional or toggleable functionality located in `src/features/`.

## 1) Feature structure
Features are organized by domain under `src/features/<domain>/`:
- `src/features/<domain>/<feature>.ts` — e.g., `src/features/pets/swap.ts`
- Each feature should export an explicit init/start function and a stop/destroy if it allocates resources.
- Domain-specific data lives in `src/features/<domain>/data/` — e.g., `src/features/pets/data/petAbilities.ts`

Current domains: `activity/`, `dawn/`, `economy/`, `garden/`, `input/`, `journal/`, `locker/`, `mutations/`, `pets/`, `shop/`, `standalone/`

## 2) Toggle requirement
- If a feature is user-facing, it must be configurable (`enabled: boolean`).
- Config should live in storage and be loaded via `src/utils/storage.ts`.

## 3) Independence
- Features must not depend on other features (cross-domain imports are forbidden).
- Features can depend on core systems: catalogs, sprite-v2, store, and jotai bridge.

## 4) Side effects & cleanup
- No side effects on import.
- Every listener/observer/interval must be tracked and cleaned up.

## 5) Public API
- Expose minimal, user-facing functions only.
- Avoid exporting internal helpers or raw config objects.

## 6) Subfolder pattern
When a feature grows beyond 3 internal modules, create a subfolder with `index.ts` as the **only** public entry point:
- `src/features/<domain>/<name>/index.ts`
- Internal files are not exported outside the subfolder
- Examples: `src/features/input/controller/` (9 files), `src/features/pets/optimizer/`, `src/features/shop/enhancer/`
