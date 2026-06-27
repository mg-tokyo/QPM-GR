import {
  log,
  ctx,
  LAYER_B_REFRESH_DELAYS_MS,
} from './types';
import type { TextureOverrideRule } from './types';
import { getPixiApp } from './pixi-walk';
import { applyAllLayerB, revertAllLayerB } from './layerB-apply';
import { buildLayerBApplyToken } from './layerB-variants';
import { revertAllRiveOverlays } from './riveAdapter';

// ---------------------------------------------------------------------------
// Layer B — refresh scheduling
//
// Owns the burst-of-timers pattern that drives Layer B re-applies as the game
// stage settles after a rule edit, world load, or webgl-context restore.
// `maybeApplyLayerB` short-circuits when the stage signature hasn't changed
// since the last apply.
// ---------------------------------------------------------------------------

function maybeApplyLayerB(rules: TextureOverrideRule[], force = false): void {
  if (rules.length === 0) {
    if (ctx.layerBModified.length > 0) {
      revertAllLayerB();
    } else {
      // Rive sprites are never in layerBModified (they bypass the standard
      // snapshot/restore loop), so revertAllLayerB wouldn't be called above
      // when only Rive state is dirty. Call directly so Reset All Rules
      // clears Rive scale multipliers / overlays even with no non-Rive
      // modifications to revert.
      revertAllRiveOverlays();
    }
    ctx.lastLayerBApplyToken = `empty|${ctx.ruleRevision}`;
    return;
  }

  const app = getPixiApp();
  if (!app?.stage) {
    const noStageToken = `nostage|${ctx.ruleRevision}`;
    if (ctx.lastLayerBApplyToken !== noStageToken) {
      ctx.lastLayerBApplyToken = noStageToken;
      if (force) applyAllLayerB(rules);
    }
    return;
  }

  const beforeToken = buildLayerBApplyToken(rules, app.stage);
  if (!force && beforeToken && beforeToken === ctx.lastLayerBApplyToken) return;

  applyAllLayerB(rules);
  const afterToken = buildLayerBApplyToken(rules, app.stage);
  ctx.lastLayerBApplyToken = afterToken ?? beforeToken ?? `${ctx.ruleRevision}|unknown`;
}

export function clearLayerBRefreshTimers(): void {
  for (const id of ctx.layerBRefreshTimers) {
    clearTimeout(id);
  }
  ctx.layerBRefreshTimers.clear();
}

export function scheduleLayerBRefreshBurst(forceFirst = false): void {
  const runId = ++ctx.layerBRefreshRunId;
  clearLayerBRefreshTimers();

  for (const delay of LAYER_B_REFRESH_DELAYS_MS) {
    const run = () => {
      if (runId !== ctx.layerBRefreshRunId) return;
      try {
        maybeApplyLayerB(ctx.activeRules, forceFirst && delay === 0);
      } catch (e) {
        log('scheduleLayerBRefreshBurst tick failed', e);
      }
    };

    if (delay === 0) {
      run();
      continue;
    }

    const timerId = setTimeout(() => {
      ctx.layerBRefreshTimers.delete(timerId as unknown as number);
      run();
    }, delay) as unknown as number;
    ctx.layerBRefreshTimers.add(timerId);
  }
}

let pendingRaf = 0;

export function refreshLayerBNow(): void {
  if (pendingRaf) return;
  pendingRaf = requestAnimationFrame(() => {
    pendingRaf = 0;
    try {
      maybeApplyLayerB(ctx.activeRules, false);
    } catch (e) {
      log('refreshLayerBNow rAF tick failed', e);
    }
  });
}

export function cancelPendingRefresh(): void {
  if (pendingRaf) { cancelAnimationFrame(pendingRaf); pendingRaf = 0; }
}

// ---------------------------------------------------------------------------
// Stage childAdded hook — catches late-arriving sprites
// ---------------------------------------------------------------------------

let stageHookCleanup: (() => void) | null = null;

export function initStageChildAddedHook(): () => void {
  if (stageHookCleanup) return stageHookCleanup;
  const app = getPixiApp();
  if (!app?.stage) return () => {};
  const onChildAdded = (): void => { refreshLayerBNow(); };
  app.stage.on?.('childAdded', onChildAdded);
  stageHookCleanup = () => {
    app.stage.off?.('childAdded', onChildAdded);
    stageHookCleanup = null;
  };
  return stageHookCleanup;
}
