// src/features/standalone/textureSwapper/rive/pet-filters.ts
// Pet mutation filters (sprite.filters via shader port — beta-accurate path).
// Extracted from riveAdapter.ts during PR #1 of the 2026-06-27 perf refactor.

import { log } from '../types';
import { buildColorOverlayFilter, buildRainbowFilterProper } from '../riveFilters';
import { petFiltersBySprite, activeRiveSprites } from './state';

/**
 * Apply a Gold/single-color mutation to a Rive PET sprite via sprite.filters —
 * matches game's PetView.applyMutationFilters (PetView.ts:456-459). Falls back
 * to the child-overlay approach when PIXI Filter ctors haven't been captured
 * yet. Returns true when the filter path was installed (caller should skip the
 * child-overlay fallback).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRivePetGoldFilter(sprite: any, color: string, alpha: number, ruleId: string): boolean {
  const filter = buildColorOverlayFilter(color, alpha);
  if (!filter) return false;
  installPetFilter(sprite, ruleId, filter);
  log(`applyRivePetGoldFilter: installed ColorOverlayFilter for rule ${ruleId} color=${color} alpha=${alpha}`);
  return true;
}

/**
 * Apply the proper RainbowFilter to a Rive PET sprite via sprite.filters.
 * Beta uses OffscreenFilter wrapping RainbowFilter because of the v8
 * render-group filter bug — but that bug fires on RenderTexture-backed
 * sprites, which RiveSprite (pet) is not. Direct sprite.filters on pets
 * works because the rive batch renderer respects filters when submitting
 * the artboard for render. Returns true on success.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRivePetRainbowFilter(sprite: any, ruleId: string): boolean {
  const filter = buildRainbowFilterProper({});
  if (!filter) return false;
  installPetFilter(sprite, ruleId, filter);
  log(`applyRivePetRainbowFilter: installed RainbowFilter for rule ${ruleId}`);
  return true;
}

/**
 * Per-sprite reusable filter array — avoids the per-call `[...filtered, filter]`
 * allocation that thrashed PIXI's filter rebuild during refresh ticks
 * (audit HIGH #26 / PR #5 task 26). PIXI v8 detects content changes via
 * internal version counters but still needs a setter assignment to pick up
 * the change, so we mutate the cached array in place AND reassign.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const filterArrayBySprite = new WeakMap<object, any[]>();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installPetFilter(sprite: any, ruleId: string, filter: any): void {
  let byRule = petFiltersBySprite.get(sprite as object);
  if (!byRule) {
    byRule = new Map();
    petFiltersBySprite.set(sprite as object, byRule);
  }
  // Tear down any previous filter we installed for this rule.
  const prev = byRule.get(ruleId);
  byRule.set(ruleId, [filter]);
  try {
    // Reuse a per-sprite array. On first install we seed from sprite.filters
    // so any game-applied filters that were there first are preserved.
    let arr = filterArrayBySprite.get(sprite as object);
    if (!arr) {
      arr = Array.isArray(sprite.filters) ? [...sprite.filters] : [];
      filterArrayBySprite.set(sprite as object, arr);
    }
    if (prev) {
      // Remove the previous filter for this rule in place.
      for (let i = arr.length - 1; i >= 0; i--) {
        if (prev.includes(arr[i])) arr.splice(i, 1);
      }
    }
    if (!arr.includes(filter)) arr.push(filter);
    // Reassign to trigger PIXI's filter rebuild path even when the array
    // identity is the same — PIXI compares against its own snapshot.
    sprite.filters = arr;
  } catch (e) {
    log('installPetFilter: failed to set filters', e);
  }
  activeRiveSprites.add(sprite);
}

/**
 * Remove every filter we installed for this rule on this pet sprite. Other
 * filters (game-applied or rules we haven't touched) are left intact.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearRivePetFilter(sprite: any, ruleId: string): void {
  const byRule = petFiltersBySprite.get(sprite as object);
  if (!byRule) return;
  const ours = byRule.get(ruleId);
  if (!ours) return;
  try {
    // Mutate the cached array in place where possible (PR #5 task 26).
    const arr = filterArrayBySprite.get(sprite as object);
    if (arr) {
      for (let i = arr.length - 1; i >= 0; i--) {
        if (ours.includes(arr[i])) arr.splice(i, 1);
      }
      sprite.filters = arr.length > 0 ? arr : null;
      if (arr.length === 0) filterArrayBySprite.delete(sprite as object);
    } else {
      const current = Array.isArray(sprite.filters) ? sprite.filters : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const next = current.filter((f: any) => !ours.includes(f));
      sprite.filters = next.length > 0 ? next : null;
    }
  } catch { /* ignore */ }
  byRule.delete(ruleId);
  if (byRule.size === 0) petFiltersBySprite.delete(sprite as object);
}

/** Clear every QPM-installed pet filter across every tracked pet. */
export function clearAllRivePetFilters(): void {
  // No central registry of filtered pets — they're registered in
  // activeRiveSprites and we walk that. The petFiltersBySprite WeakMap
  // ensures we only touch sprites we actually filtered.
  for (const sprite of activeRiveSprites) {
    const byRule = petFiltersBySprite.get(sprite as object);
    if (!byRule) continue;
    for (const ruleId of [...byRule.keys()]) {
      clearRivePetFilter(sprite, ruleId);
    }
  }
}
