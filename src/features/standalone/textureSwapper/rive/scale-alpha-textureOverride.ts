// src/features/standalone/textureSwapper/rive/scale-alpha-textureOverride.ts
// Per-Rive-sprite scale multiplier, alpha snapshot, and texture override
// machinery. Extracted from riveAdapter.ts during PR #1 of the 2026-06-27
// perf refactor.

import { ctx, log } from '../types';
import { extractCanvasFromTexture } from './detection';
import {
  scaleMultipliers,
  riveAlphaSnapshots,
  riveTextureOverrides,
  riveOverrideTexCache,
  activeRiveSprites,
} from './state';

/** Per-instance scale multiplier — applied by the patched syncDisplaySize. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setRiveSpriteScale(sprite: any, factorX: number, factorY: number): void {
  if (!sprite || typeof sprite !== 'object') return;
  if (factorX === 1 && factorY === 1) {
    scaleMultipliers.delete(sprite as object);
    return;
  }
  scaleMultipliers.set(sprite as object, { x: factorX, y: factorY });
  // Register so revertAllRiveOverlays sees this sprite on reset — without
  // this, a scale-only Rive rule (no mutation/swap/alpha) leaves activeRiveSprites
  // empty and Reset All Rules can't clear the multiplier.
  activeRiveSprites.add(sprite);
}

/** Read the current multiplier for a sprite. Default (1, 1) when unset. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getRiveSpriteScale(sprite: any): { x: number; y: number } {
  return scaleMultipliers.get(sprite as object) ?? { x: 1, y: 1 };
}

/**
 * Set alpha on a Rive sprite, snapshotting the pre-rule value the first time
 * so revertAllRiveOverlays can restore it. Calling with the same value is a
 * no-op past the initial snapshot.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRiveAlpha(sprite: any, alpha: number): void {
  if (!sprite || typeof sprite !== 'object') return;
  if (!riveAlphaSnapshots.has(sprite as object)) {
    const cur = typeof sprite.alpha === 'number' ? sprite.alpha : 1;
    riveAlphaSnapshots.set(sprite as object, cur);
  }
  try { sprite.alpha = alpha; } catch { /* ignore */ }
  activeRiveSprites.add(sprite);
}

/**
 * Install a per-instance texture override on a Rive sprite. The patched draw
 * hook re-applies this texture every frame after the original syncTextureFromBacking
 * tries to restore the rive backing — without that hook the swap reverts on the
 * very next render tick. Use for pet rules and Rive-decor swap rules that don't
 * opt into static fallback.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setRiveTextureOverride(sprite: any, texture: any): void {
  if (!sprite || !texture) return;
  riveTextureOverrides.set(sprite as object, texture);
  activeRiveSprites.add(sprite);
}

/** Remove a per-instance texture override. The rive sprite's next draw will re-sync to the backing. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearRiveTextureOverride(sprite: any): void {
  riveTextureOverrides.delete(sprite as object);
}

/**
 * Get-or-build a clean Rive override texture for a rule. Extracts the canvas
 * from the rule's standard customTex.source and re-wraps with `Texture.from`,
 * skipping the trim transfer. Cached per ruleId; clear via
 * `clearRiveOverrideTextureCache` on rule update/delete.
 *
 * Why clean geometry: the standard `entry.customTex` has atlas-relative frame
 * coords baked in by `canvas.ts.transferTrimGeometry`, which point to a region
 * INSIDE the canvas-backed source (the original atlas slot in the spritesheet).
 * Using that customTex directly on a Rive sprite override makes PIXI read pixels
 * from those atlas coords inside our canvas, producing a tiny crop of the
 * wrong region — the "poorly cropped zoomed in" symptom. This cache holds
 * a parallel texture with clean geometry for the Rive draw hook.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getOrBuildRiveOverrideTexture(ruleId: string, customTex: any): any | null {
  const cached = riveOverrideTexCache.get(ruleId);
  if (cached) return cached;
  const Texture = ctx.currentSvc?.state.ctors?.Texture;
  if (!Texture || !customTex) return null;
  const canvas = extractCanvasFromTexture(customTex);
  if (!canvas) {
    log('getOrBuildRiveOverrideTexture: no canvas in customTex.source');
    return null;
  }
  try {
    const clean = Texture.from(canvas);
    riveOverrideTexCache.set(ruleId, clean);
    return clean;
  } catch (e) {
    log('getOrBuildRiveOverrideTexture: build failed', e);
    return null;
  }
}

/**
 * Drop the cached clean override(s). Pass a ruleId to clear one rule; pass
 * nothing to clear all. Called from `revertLayerA` / `clearAllRules` so a
 * rule update rebuilds with the fresh customTex.
 */
export function clearRiveOverrideTextureCache(ruleId?: string): void {
  if (ruleId) {
    const tex = riveOverrideTexCache.get(ruleId);
    if (tex) {
      try { tex.destroy?.(false); } catch { /* ignore */ }
      riveOverrideTexCache.delete(ruleId);
    }
    return;
  }
  for (const tex of riveOverrideTexCache.values()) {
    try { tex.destroy?.(false); } catch { /* ignore */ }
  }
  riveOverrideTexCache.clear();
}
