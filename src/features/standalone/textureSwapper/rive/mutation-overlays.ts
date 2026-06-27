// src/features/standalone/textureSwapper/rive/mutation-overlays.ts
// Single-color mutation overlays for Rive sprites (Phase 3 of the original).
// Extracted from riveAdapter.ts during PR #1.

import { log } from '../types';
import { getMutationColor } from '../mutationColors';
import { hexToPixiTint } from '../layerB-overlay';
import { getBasePixiSpriteCtor } from './detection';
import { syncRivePetOverlays } from '../rivePetOverlay';
import {
  mutationOverlaysBySprite,
  lastRiveTexture,
  activeRiveSprites,
  rainbowOverlaysBySprite,
} from './state';
import { clearRiveRainbow, syncRiveRainbowsForActiveSprites } from './rainbow-lite';
import { clearRiveMutationBadges } from './mutation-badges';

/**
 * Create-or-update a single-color overlay child sprite for the given mutation
 * on the given Rive sprite. Uses sprite.tint multiply (same mechanism as
 * getOrCreateSpriteOverlay) but with a hardcoded color/alpha from the
 * mutation colors table.
 *
 * Idempotent: calling repeatedly with the same (sprite, mutationName) updates
 * the existing overlay's tint/alpha in place.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRiveColorMutation(sprite: any, mutationName: string, _ruleId: string): void {
  const color = getMutationColor(mutationName);
  if (!color) return;
  // Use the base PIXI.Sprite, not the captured ctors.Sprite (which may be a
  // Rive subclass that fails to construct without acquired backing).
  const Sprite = getBasePixiSpriteCtor(sprite);
  if (!Sprite) return;
  if (!sprite?.texture) return;

  let overlays = mutationOverlaysBySprite.get(sprite as object);
  if (!overlays) {
    overlays = new Map();
    mutationOverlaysBySprite.set(sprite as object, overlays);
  }

  let overlay = overlays.get(mutationName);
  if (overlay) {
    // Update existing — keep texture in sync with parent (Rive backing may
    // have reallocated since last apply).
    if (overlay.texture !== sprite.texture) overlay.texture = sprite.texture;
  } else {
    try {
      overlay = new Sprite(sprite.texture);
      (overlay as { __qpmOverlay?: true }).__qpmOverlay = true;
      if (overlay.anchor && sprite.anchor) {
        if (typeof overlay.anchor.copyFrom === 'function') {
          overlay.anchor.copyFrom(sprite.anchor);
        } else {
          overlay.anchor.set?.(sprite.anchor.x ?? 0, sprite.anchor.y ?? 0);
        }
      }
      sprite.addChild?.(overlay);
      overlays.set(mutationName, overlay);
    } catch (e) {
      log('applyRiveColorMutation: failed to create overlay', e);
      return;
    }
  }

  try { overlay.tint = hexToPixiTint(rgbStringToHex(color.color)); } catch { /* ignore */ }
  try { overlay.alpha = color.alpha; } catch { /* ignore */ }

  activeRiveSprites.add(sprite);
  lastRiveTexture.set(sprite as object, sprite.texture);
}

/** Remove ALL mutation overlays from this sprite. Called on rule revert. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearRiveMutations(sprite: any): void {
  const overlays = mutationOverlaysBySprite.get(sprite as object);
  if (overlays) {
    for (const overlay of overlays.values()) {
      try {
        if (overlay.parent && typeof overlay.parent.removeChild === 'function') {
          overlay.parent.removeChild(overlay);
        }
        overlay.destroy?.({ children: false, texture: false, baseTexture: false });
      } catch { /* ignore */ }
    }
    mutationOverlaysBySprite.delete(sprite as object);
  }
  const rainbows = rainbowOverlaysBySprite.get(sprite as object);
  if (rainbows) {
    for (const ruleId of [...rainbows.keys()]) clearRiveRainbow(sprite, ruleId);
  }
  clearRiveMutationBadges(sprite);
  lastRiveTexture.delete(sprite as object);
  activeRiveSprites.delete(sprite);
}

/**
 * Per-frame texture sync. Rive reallocates its render target on zoom
 * (verified by snippet J — SharedRiveBacking.ts:49-62 calls
 * `this.sprite.riveRenderSize = ...` which mutates the Texture in place).
 * Overlay children hold the OLD texture reference; we reassign each frame
 * when the parent's texture has changed.
 *
 * Called from layerB-apply.ts's walker pass after each refresh tick.
 */
export function syncRiveMutationsForActiveSprites(): void {
  for (const sprite of activeRiveSprites) {
    if (!sprite?.texture) continue;
    const last = lastRiveTexture.get(sprite as object);
    if (last === sprite.texture) continue;
    lastRiveTexture.set(sprite as object, sprite.texture);
    const overlays = mutationOverlaysBySprite.get(sprite as object);
    if (!overlays) continue;
    for (const overlay of overlays.values()) {
      try { overlay.texture = sprite.texture; } catch { /* ignore */ }
    }
  }
  syncRiveRainbowsForActiveSprites();
  // Pet-overlay sync — these track position/scale of each pet's sibling
  // Sprite. Cheap; iterates only sprites with active overlays.
  try { syncRivePetOverlays(); } catch { /* ignore */ }
}

/** Parse `rgb(r, g, b)` to `#rrggbb` for hexToPixiTint. */
function rgbStringToHex(rgb: string): string {
  const m = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(rgb);
  if (!m) return '#ffffff';
  const r = Number(m[1]).toString(16).padStart(2, '0');
  const g = Number(m[2]).toString(16).padStart(2, '0');
  const b = Number(m[3]).toString(16).padStart(2, '0');
  return `#${r}${g}${b}`;
}
