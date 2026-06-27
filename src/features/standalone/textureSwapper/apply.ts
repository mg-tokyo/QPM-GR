import { ctx } from './types';
import {
  revertLayerA,
  flushPendingTextureDestroy,
} from './layerA';
import { revertAllLayerB } from './layerB-apply';
import { destroyAllSpriteOverlays } from './layerB-overlay';
import { clearAllRuleVariantTextures } from './layerB-variants';
import { invalidateLayerBRuleIndexCache } from './layerB-prepare';

// ---------------------------------------------------------------------------
// Texture-swap apply orchestrator
//
// This file is the public surface for the apply subsystem. Implementation
// lives in:
//   layerA.ts          — QPM UI texture override (svc.state.tex swap)
//   layerB-apply.ts    — live PIXI stage matching + texture/overlay apply
//   layerB-overlay.ts  — per-sprite snapshot + child overlay sprite
//   layerB-variants.ts — variant texture cache + stage signature
//   layerB-schedule.ts — burst-of-timers refresh scheduler
//   pixi-walk.ts       — low-level PIXI scene-graph + texture utilities
//
// `revertAll` is the only function still defined here — it's the orchestrator
// that tears down both layers + their caches in a single call. Everything
// else is re-exported below so consumers keep importing from './apply'.
// ---------------------------------------------------------------------------

// Public re-exports — keep `./apply` as the import path for index.ts and
// every other consumer. Splitting the implementation should not require any
// of those files to change their imports.
export {
  applyLayerA,
  revertLayerA,
  applyAllLayerA,
  getStoredOriginalForKey,
  disposeRuleOverlayFilter,
  flushPendingTextureDestroy,
} from './layerA';
export {
  refreshLayerBNow,
  clearLayerBRefreshTimers,
  scheduleLayerBRefreshBurst,
  cancelPendingRefresh,
  initStageChildAddedHook,
} from './layerB-schedule';
export {
  clearAllRuleVariantTextures,
  bumpRuleRevision,
} from './layerB-variants';
export { applyAllLayerB } from './layerB-apply';

export function revertAll(): void {
  revertAllLayerB();
  const svc = ctx.currentSvc;
  if (svc) {
    for (const rule of ctx.activeRules) {
      revertLayerA(rule, svc);
    }
  }
  clearAllRuleVariantTextures();
  invalidateLayerBRuleIndexCache();
  destroyAllSpriteOverlays();
  flushPendingTextureDestroy();
}
