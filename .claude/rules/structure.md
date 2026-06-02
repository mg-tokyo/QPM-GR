# Structure rules (QPM-GR)

Rules for the domain-grouped directory layout.

## Domain naming
- Domain names must match across `features/` and `ui/` — e.g., `features/pets/` pairs with `ui/pets/`.
- Naming convention: singular for systems (`garden`, `shop`), plural for collections (`pets`, `mutations`).
- Not every domain needs both a `features/` and `ui/` folder — some are logic-only or UI-only.

## When to create a domain folder
- 3+ tightly-coupled files that share a concept → group into a domain.
- A single file stays in `standalone/` (features) or `sections/` (UI).

## Data co-location
- Domain-specific static data lives in `src/features/<domain>/data/` — e.g., `features/pets/data/petAbilities.ts`.
- Shared game constants stay in `src/data/` (gameInfo, weatherEvents).

## Utils organization
- Utils are grouped by purpose, not by domain: `scheduling/`, `dom/`, `game/`, `restock/`, `rendering/`.
- Foundational helpers (storage, logger, formatters, environment, versionChecker) stay at `src/utils/` root.
- New utils should go into an existing subfolder or create a new one if the purpose is distinct.

## Store stays flat
- `src/store/` remains a flat directory — no domain grouping.
- Store modules are shared infrastructure, not domain-specific.

## Subfolder threshold
- When a feature within a domain grows beyond 3 internal modules, create a subfolder with `index.ts` as the only public entry point.
- Examples: `features/pets/optimizer/`, `features/shop/enhancer/`, `features/input/controller/`
