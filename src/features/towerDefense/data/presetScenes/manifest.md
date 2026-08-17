# Tower Defense preset scenes — tracker

Bundled `.mgscene.json` designs auto-loaded by `manifest.ts` and seeded into the
custom-designs library at init. Anything missing here falls back to the vanilla
tower sprite until the file is added and referenced in `manifest.ts`.

## Slot conventions

Filename is `<towerId>_<slot>.mgscene.json` where `<slot>` matches the
`UpgradeSlot` enum in `src/features/towerDefense/data/tierSlots.ts`:

| Slot     | (upgA, upgB)      | Notes |
|----------|-------------------|-------|
| `base`   | (0/1, 0/1)        | No preset for any tower yet — vanilla sprite is fine |
| `t2a`    | (2, 0/1)          | |
| `t2b`    | (0/1, 2)          | |
| `t2a2b`  | (2, 2)            | |
| `t3a`    | (3, 0/1)          | |
| `t3a2b`  | (3, 2)            | |
| `t3b`    | (0/1, 3)          | |
| `t3b2a`  | (2, 3)            | |
| `t4a`    | (4, 0/1)          | |
| `t4a2b`  | (4, 2)            | |
| `t4b`    | (0/1, 4)          | |
| `t4b2a`  | (2, 4)            | |

## Coverage grid

Legend: ✅ present · ❌ missing (falls back to vanilla) · ➖ intentionally skipped

| Tower           | base | t2a | t2b | t2a2b | t3a | t3a2b | t3b | t3b2a | t4a | t4a2b | t4b | t4b2a |
|-----------------|:----:|:---:|:---:|:-----:|:---:|:-----:|:---:|:-----:|:---:|:-----:|:---:|:-----:|
| sproutSlinger   | ➖   | ✅  | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    |
| witchsCauldron  | ➖   | ✅  | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    |
| frostWizard     | ➖   | ✅  | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    |
| marbleKnight    | ➖   | ✅  | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    | ✅  | ✅    |
| strawScarecrow  | ➖   | ❌  | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    |
| bananaGrove     | ➖   | ❌  | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    |
| owlPerch        | ➖   | ❌  | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    |
| gnomeAlchemist  | ➖   | ❌  | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    | ❌  | ❌    |

## What's done

- **witchsCauldron**: complete (11/11 crosspath combos).
- **marbleKnight**: complete (11/11 crosspath combos; `t2b` and `t3a2b` refreshed by user 2026-08-17).
- **frostWizard**: complete (11/11 crosspath combos; `t2a2b` and `t3a` added by user 2026-08-17).
- **sproutSlinger**: complete (11/11 crosspath combos; `t3a`, `t3b`, `t4a`, `t4b` added by user 2026-08-17).

## What's left

Priority order (each is a full set of 11):

1. `strawScarecrow_*.mgscene.json`
2. `bananaGrove_*.mgscene.json`
3. `owlPerch_*.mgscene.json`
4. `gnomeAlchemist_*.mgscene.json`

## How to add a new preset

1. Export the scene from MG-Sprite-Customiser-V2 as `.mgscene.json`.
2. Drop it in this folder named `<towerId>_<slot>.mgscene.json` (canonical
   `TowerId` from `src/features/towerDefense/types.ts:1-9`; canonical
   `UpgradeSlot` from `tierSlots.ts`).
3. Add the import + `PRESET_SCENES` row in `manifest.ts`.
4. Flip its cell in the coverage grid above.
5. `npm run typecheck && npm run build`.
