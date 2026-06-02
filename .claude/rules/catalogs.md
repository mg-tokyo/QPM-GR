# Catalogs rules (QPM-GR)

These rules govern runtime game data capture and typed access in `src/catalogs/`.

## Purpose
QPM does not ship hardcoded game data. Instead, it captures runtime catalogs from the game's bundle and exposes them via typed helpers. This keeps the mod resilient to game updates.

## Structure
```
src/catalogs/
|-- catalogLoader.ts   # Runtime capture logic (Object.* hook)
|-- gameCatalogs.ts    # Typed access layer for catalogs
|-- types.ts           # Catalog typings
```

## 1) Capture boundaries
- Capture logic MUST stay in `catalogLoader.ts`.
- Do NOT mix UI or feature logic into catalogs.
- Capture must be safe to call multiple times and should not break game initialization.

## 2) Typed access only
- Features should import from `gameCatalogs.ts` rather than reading raw captured objects.
- Types in `types.ts` should be the single source of truth for catalog shapes.

Example:
```ts
import { getPetCatalog, getPetSpecies } from '../catalogs/gameCatalogs';

const pets = getPetCatalog();
const turtle = getPetSpecies('Turtle');
```

## 3) Readiness and fallbacks
- Always check `areCatalogsReady()` before accessing data when timing is uncertain.
- Provide sensible fallbacks (empty arrays/objects) if catalogs are not ready.

Example:
```ts
import { areCatalogsReady, getAllPlantSpecies } from '../catalogs/gameCatalogs';

const species = areCatalogsReady() ? getAllPlantSpecies() : [];
```

## 4) No hardcoded game data
- If you find yourself adding a plant/pet name constant, stop and look for it in catalogs.
- Use catalogs as the source of truth, even if it means waiting for capture.

## 5) Diagnostics
- Use `logCatalogStatus()` and `diagnoseCatalogs()` for debugging capture timing.
- Do not keep permanent debug prints in production code.

## 6) Safe catalog helpers (`src/utils/game/catalogHelpers.ts`)
For UI code that must never throw, prefer the safe wrappers in `catalogHelpers.ts` over calling `gameCatalogs.ts` directly. These return `null` or sensible fallbacks instead of throwing when data is absent:

```ts
import { getPlantSpeciesSafe, isValidMutation, getAbilityName, normalizeSpeciesKey } from '../utils/game/catalogHelpers';

const species = getPlantSpeciesSafe('Rose');    // PlantSpecies | null
const valid = isValidMutation('Wet');           // boolean
const label = getAbilityName('ability_001');    // string (fallback: ID itself)
const key = normalizeSpeciesKey('Rose Plant'); // 'Rose' — canonical key
```

Use `gameCatalogs.ts` directly only in store and catalog-layer code where error handling is explicit.

## Common mistakes
- Reading `getCatalogs()` directly instead of typed helpers
- Assuming catalogs are ready at startup without checking
- Adding new static data in `src/data/` when it should come from catalogs
- Using `gameCatalogs.ts` in UI code instead of `catalogHelpers.ts` safe wrappers
