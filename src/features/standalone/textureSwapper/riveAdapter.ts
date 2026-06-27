// src/features/standalone/textureSwapper/riveAdapter.ts
// Barrel — re-exports every public symbol from the rive/* subfolder so callers
// don't change imports. Per .claude/rules/refactoring.md: every existing export
// must remain importable from its original path.
//
// Split history: PR #1 of docs/superpowers/plans/2026-06-27-texture-swapper-perf.md
// extracted this 1822-line file into rive/<concern>.ts modules:
//   - state.ts                          (cross-cutting module-scope state)
//   - constants.ts                      (RIVE_DECOR_IDS, RAINBOW_* constants)
//   - detection.ts                      (isRiveSprite family, getBasePixiSpriteCtor)
//   - scale-alpha-textureOverride.ts    (per-sprite scale, alpha, texture override)
//   - sprite-patching.ts                (prototype patches: width/height setters, draw)
//   - mutation-overlays.ts              (Phase 3: single-color mutation overlays)
//   - mutation-badges.ts                (Phase 5: badge icons on Rive decor)
//   - rainbow-lite.ts                   (Phase 4a: sibling-Container rainbow)
//   - rainbow-filter.ts                 (Phase 4b: lazy Filter capture)
//   - rainbow-offscreen.ts              (Phase 4c: OffscreenFilter port)
//   - pet-filters.ts                    (sprite.filters for Gold/Rainbow on pets)
//   - pet-swap.ts                       (public wrappers around rivePetOverlay)
//   - static-fallback.ts                (Phase 6: visibility toggle)
//   - revert.ts                         (revertAllRiveOverlays)
//
// Internal helpers (getRiveSpriteScale, installPetFilter, syncRainbowState,
// buildRainbowFilter, etc.) are NOT re-exported and must be imported by
// sibling rive/* files via relative paths within the subfolder.

export {
  isRiveSprite,
  isRiveDecorSprite,
  isRivePetSprite,
} from './rive/detection';

export {
  setRiveSpriteScale,
  applyRiveAlpha,
  setRiveTextureOverride,
  clearRiveTextureOverride,
  getOrBuildRiveOverrideTexture,
  clearRiveOverrideTextureCache,
} from './rive/scale-alpha-textureOverride';

export {
  captureFromScene,
  installRiveAdapter,
} from './rive/sprite-patching';

export {
  applyRiveColorMutation,
  clearRiveMutations,
  syncRiveMutationsForActiveSprites,
} from './rive/mutation-overlays';

export {
  applyRiveMutationBadge,
  clearRiveMutationBadges,
} from './rive/mutation-badges';

export {
  applyRiveRainbowLite,
  clearRiveRainbow,
  clearRiveRainbowLiteOnly,
  syncRiveRainbowsForActiveSprites,
} from './rive/rainbow-lite';

export {
  tryApplyOffscreenRainbow,
  clearRiveRainbowOffscreen,
} from './rive/rainbow-offscreen';

export {
  applyRivePetGoldFilter,
  applyRivePetRainbowFilter,
  clearRivePetFilter,
} from './rive/pet-filters';

export {
  applyRivePetSwap,
  clearRivePetSwap,
} from './rive/pet-swap';

export {
  findStaticSpriteForRive,
  setRiveStaticFallback,
} from './rive/static-fallback';

export { revertAllRiveOverlays } from './rive/revert';
