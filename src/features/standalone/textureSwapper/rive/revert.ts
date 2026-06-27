// src/features/standalone/textureSwapper/rive/revert.ts
// Revert all Rive-sprite overlays + scale multipliers + texture overrides +
// static fallbacks + alpha in one pass. Extracted from riveAdapter.ts:457-475
// during PR #1 of the 2026-06-27 perf refactor.
//
// Rive sprites bypass Layer B's standard snapshot/restore loop because setting
// sprite.texture on a SharedRiveSprite with a stale snapshot triggers the
// game's _setWidth override to read a null internal field (verified live by
// TypeError: Cannot read properties of null reading 'x'). This call replaces
// that loop for Rive sprites: it tears down every override we may have
// installed so the next apply pass starts clean.
//
// Safe to call even when activeRiveSprites is empty — the snapshot iteration
// is bounded by the set's current size.

import { activeRiveSprites, riveAlphaSnapshots } from './state';
import { clearRiveMutations } from './mutation-overlays';
import { clearRiveTextureOverride } from './scale-alpha-textureOverride';
import { setRiveSpriteScale } from './scale-alpha-textureOverride';
import { setRiveStaticFallback } from './static-fallback';
import { clearAllRivePetFilters } from './pet-filters';
import { clearAllRivePetSwaps } from '../rivePetOverlay';

export function revertAllRiveOverlays(): void {
  const snapshot = [...activeRiveSprites];
  for (const sprite of snapshot) {
    try { clearRiveMutations(sprite); } catch { /* ignore */ }
    try { clearRiveTextureOverride(sprite); } catch { /* ignore */ }
    try { setRiveSpriteScale(sprite, 1, 1); } catch { /* ignore */ }
    try { setRiveStaticFallback(sprite, false); } catch { /* ignore */ }
    const origAlpha = riveAlphaSnapshots.get(sprite as object);
    if (origAlpha !== undefined) {
      try { sprite.alpha = origAlpha; } catch { /* ignore */ }
      riveAlphaSnapshots.delete(sprite as object);
    }
  }
  // Pet-specific teardown — has its own registry separate from activeRiveSprites
  // so we call it after the main loop runs through scale/alpha resets above.
  try { clearAllRivePetFilters(); } catch { /* ignore */ }
  try { clearAllRivePetSwaps(); } catch { /* ignore */ }
  activeRiveSprites.clear();
}
