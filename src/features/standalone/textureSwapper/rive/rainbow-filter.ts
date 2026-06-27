// src/features/standalone/textureSwapper/rive/rainbow-filter.ts
// Phase 4b — Lazy PIXI Filter capture + proper Rainbow upgrade for non-Rive
// sprites. After PR #5 task 21+22 of the 2026-06-27 perf plan, this file no
// longer carries duplicate shader source or ctor capture machinery — it
// delegates to riveFilters.ts which is the single canonical home.
//
// Why this file still exists: maybeUpgradeRiveRainbow is the Rive-specific
// upgrade path that decides whether to swap a lite-overlay rainbow for the
// shader-based filter. The decision is Rive-aware (see isRiveSprite gate),
// which keeps it inside the rive/ subfolder rather than in riveFilters.ts.

import { log } from '../types';
import {
  buildRainbowFilterProper,
  hasFilterCtors,
  tryCaptureFilterCtors,
} from '../riveFilters';
import { isRiveSprite } from './detection';
import { rainbowFiltersBySprite, activeRiveSprites } from './state';

// Re-export the per-sprite filter map so consumers (rainbow-lite's
// clearRiveRainbow) can read it without importing from state directly.
export { rainbowFiltersBySprite } from './state';

/**
 * Are the PIXI filter ctors captured? Wraps riveFilters.hasFilterCtors so
 * callers in the rive/ subfolder don't have to import across modules.
 */
export function tryCaptureFilterClasses(): boolean {
  return tryCaptureFilterCtors();
}

/**
 * Build the proper RainbowFilter. Delegates to riveFilters.buildRainbowFilterProper
 * with the canonical pet artboard defaults. Returns null when ctors haven't
 * been captured.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildRainbowFilter(): any | null {
  return buildRainbowFilterProper({});
}

/**
 * Upgrade an active Rainbow-lite overlay to the proper Filter path when the
 * Filter classes become available. Idempotent.
 *
 * Option B gate: PIXI v8 has a render-group filter coordinate bug. Direct
 * `sprite.filters = [f]` on a SharedRiveSprite renders with wrong UVs. The
 * Phase 4c OffscreenFilter port (rainbow-offscreen.ts) handles Rive properly
 * when available, and the Phase 4a lite path is the safe fallback either way.
 * Effectively dead code for Rive but kept for non-Rive future use.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function maybeUpgradeRiveRainbow(sprite: any, ruleId: string): boolean {
  if (isRiveSprite(sprite)) return false;
  if (!hasFilterCtors() && !tryCaptureFilterCtors()) return false;

  const existing = rainbowFiltersBySprite.get(sprite as object)?.get(ruleId);
  if (existing) {
    return true;
  }
  const filter = buildRainbowFilterProper({});
  if (!filter) return false;
  // Install the filter alongside any existing sprite.filters.
  const prev = Array.isArray(sprite.filters) ? sprite.filters : [];
  try {
    sprite.filters = [...prev, filter];
  } catch (e) {
    log('maybeUpgradeRiveRainbow: failed to set filters', e);
    return false;
  }
  let byRule = rainbowFiltersBySprite.get(sprite as object);
  if (!byRule) {
    byRule = new Map();
    rainbowFiltersBySprite.set(sprite as object, byRule);
  }
  byRule.set(ruleId, filter);
  activeRiveSprites.add(sprite);
  log(`riveAdapter: upgraded Rainbow rule ${ruleId} to proper Filter on Rive sprite`);
  return true;
}
