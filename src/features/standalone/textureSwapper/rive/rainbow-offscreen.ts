// src/features/standalone/textureSwapper/rive/rainbow-offscreen.ts
// Phase 4c — OffscreenFilter port for proper Rainbow on Rive sprites.
// Extracted from riveAdapter.ts during PR #1 of the 2026-06-27 perf refactor.
//
// Ports the beta game's OffscreenFilter pattern verbatim:
//   scraped-data/BetaGameSourceFiles/Thundershop/.../pixi/filters/OffscreenFilter.ts
//
// PIXI v8's render-group filter coords bug means `sprite.filters = [filter]`
// doesn't render correctly on Rive sprites (whose textures are RenderTextures
// = render groups). The beta's workaround: render the rive sprite's texture
// through the filter into a scratch RenderTexture, then assign that scratch
// to riveSprite.texture. PIXI sees a normal Texture (no render group) and
// composites correctly.
//
// Timing: app.ticker callback at priority -10 — between game-logic NORMAL (0)
// and PIXI's renderer LOW (-25). This is the best approximation of the beta's
// post-flush callback hook without access to the game's batch renderer.

import { ctx, log, warnFeature } from '../types';
import { getPixiApp } from '../pixi-walk';
import { getBasePixiSpriteCtor } from './detection';
import {
  type OffscreenRainbowState,
  scaleMultipliers,
  activeRiveSprites,
  activeOffscreenSprites,
  capturedRenderTextureCtorRef,
  offscreenRainbowsBySprite,
  offscreenTickerCallbackRef,
} from './state';
import { hasFilterCtors, tryCaptureFilterCtors } from '../riveFilters';
import { buildRainbowFilter } from './rainbow-filter';
import { clearRiveRainbowLiteOnly } from './rainbow-lite';

/**
 * Try to capture RenderTexture by walking the prototype chain of the rive
 * backing texture. The Rive backing IS a RenderTexture in v8, so this is
 * the most reliable capture path.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function tryCaptureRenderTexture(sample: any): any | null {
  if (capturedRenderTextureCtorRef.value) return capturedRenderTextureCtorRef.value;
  if (!sample) return null;
  let p = sample.constructor;
  while (p && p !== Function.prototype) {
    if (p.name === 'RenderTexture' && typeof p.create === 'function') {
      capturedRenderTextureCtorRef.value = p;
      log('riveAdapter: captured RenderTexture constructor');
      return p;
    }
    p = Object.getPrototypeOf(p);
  }
  return null;
}

/**
 * Per-frame: render the rive backing through the rainbow filter into the
 * scratch RenderTexture, then assign scratch to riveSprite.texture.
 *
 * Width/height restoration: setting sprite.texture changes the effective
 * width (texture.W * scale.x). To preserve the display dimensions, we read
 * width/height BEFORE the swap and re-assign AFTER. The Phase 2 patched
 * width setter multiplies by the per-instance scale rule's multiplier, so
 * we divide by the multiplier first to compensate (the patch re-multiplies
 * to land at the same final value).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function renderOffscreenRainbow(sprite: any, state: OffscreenRainbowState, renderer: any): void {
  if (sprite.destroyed) return;

  // If sprite's texture is NOT our scratch, Rive just synced the backing.
  // Save it as the new source.
  if (sprite.texture !== state.scratchTexture) {
    state.sourceTexture = sprite.texture;
  }

  const src = state.sourceTexture;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!src || !(src as any).frame) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const srcAny = src as any;
  const w = Math.round(srcAny.frame.width ?? 0);
  const h = Math.round(srcAny.frame.height ?? 0);
  if (w <= 0 || h <= 0) return;

  // PR #4 task 19 dirty-gate was REVERTED 2026-06-27 — Rive reuses the same
  // RenderTexture instance and updates its contents in place each frame.
  // Identity-checking source froze the rainbow on the first rendered frame.
  // The audit's CRITICAL #5 finding stands but needs a different invariant
  // (e.g. a Rive-side frame counter); revisit in a future PR.

  if (w !== state.lastWidth || h !== state.lastHeight) {
    state.lastWidth = w;
    state.lastHeight = h;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scratch = state.scratchTexture as any;
      scratch.resize?.(w, h);
      // resize() updates source but not frame/orig — set manually per beta
      // OffscreenFilter.ts:152-156.
      if (scratch.frame) {
        scratch.frame.width = w;
        scratch.frame.height = h;
      }
      if (scratch.orig) {
        scratch.orig.width = w;
        scratch.orig.height = h;
      }
      scratch.update?.();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (state.offscreenSprite as any).width = w;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (state.offscreenSprite as any).height = h;
    } catch (e) {
      log('renderOffscreenRainbow: resize failed', e);
      return;
    }
  }

  // Snapshot display dims before texture swap (scratch has different orig).
  const dw = sprite.width;
  const dh = sprite.height;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (state.offscreenSprite as any).texture = src;

  try {
    renderer.render({
      container: state.offscreenContainer,
      target: state.scratchTexture,
      clear: true,
    });
    sprite.texture = state.scratchTexture;

    // Restore display dimensions. Phase 2 patched setter multiplies by the
    // per-instance scale multiplier — divide by it here so the patch's
    // re-multiplication lands at the exact original display width.
    const m = scaleMultipliers.get(sprite as object) ?? { x: 1, y: 1 };
    sprite.width = dw / m.x;
    sprite.height = dh / m.y;
  } catch (e) {
    log('renderOffscreenRainbow: render failed', e);
  }
}

/**
 * Install a per-frame ticker that runs after game logic (NORMAL=0) and before
 * PIXI's renderer (LOW=-25). Priority -10 is the best approximation without
 * access to the beta's batchRenderer pre/post-flush hooks.
 */
function installOffscreenTicker(): void {
  if (offscreenTickerCallbackRef.value) return;
  const app = getPixiApp();
  if (!app?.ticker || !app.renderer) return;
  const cb = () => {
    const renderer = app.renderer;
    // PR #5 task 24 — only walk pets/decor with active offscreen state.
    for (const sprite of activeOffscreenSprites) {
      const bySprite = offscreenRainbowsBySprite.get(sprite as object);
      if (!bySprite) continue;
      for (const state of bySprite.values()) {
        renderOffscreenRainbow(sprite, state, renderer);
      }
    }
  };
  try {
    app.ticker.add(cb, null, -10);
    offscreenTickerCallbackRef.value = cb;
    log('riveAdapter: installed offscreen rainbow ticker (priority -10)');
  } catch (e) {
    warnFeature('QPM-TEXTURESWAP-001', { what: 'offscreenTicker:install' }, e);
    offscreenTickerCallbackRef.value = null;
  }
}

export function uninstallOffscreenTicker(): void {
  if (!offscreenTickerCallbackRef.value) return;
  const app = getPixiApp();
  try { app?.ticker?.remove?.(offscreenTickerCallbackRef.value); } catch { /* ignore */ }
  offscreenTickerCallbackRef.value = null;
}

/**
 * Attempt to set up the OffscreenFilter path for this Rive sprite + rule.
 * Returns true on success (caller skips Phase 4a lite); false on any failure
 * (caller falls through to Phase 4a lite).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function tryApplyOffscreenRainbow(sprite: any, ruleId: string): boolean {
  const Sprite = getBasePixiSpriteCtor(sprite);
  const Container = ctx.currentSvc?.state.ctors?.Container;
  if (!Sprite || !Container) return false;

  // Need Filter + GlProgram (Phase 4b machinery) for the RainbowFilter.
  if (!tryCaptureFilterCtors()) return false;
  if (!hasFilterCtors()) return false;

  // Need RenderTexture for the scratch buffer.
  const RT = tryCaptureRenderTexture(sprite.texture);
  if (!RT) return false;

  const app = getPixiApp();
  if (!app?.renderer) return false;

  let bySprite = offscreenRainbowsBySprite.get(sprite as object);
  if (!bySprite) {
    bySprite = new Map();
    offscreenRainbowsBySprite.set(sprite as object, bySprite);
  }

  let state = bySprite.get(ruleId);
  if (state) {
    // Already set up. Just ensure ticker is running.
    installOffscreenTicker();
    activeRiveSprites.add(sprite);
    activeOffscreenSprites.add(sprite);
    return true;
  }

  try {
    const filter = buildRainbowFilter();
    if (!filter) return false;

    const offscreenContainer = new Container();
    (offscreenContainer as { label?: string }).label = `qpmOffscreenRainbow:${ruleId}`;

    const offscreenSprite = new Sprite();
    offscreenSprite.filters = [filter];
    offscreenContainer.addChild(offscreenSprite);

    // Scratch RenderTexture, resized in renderOffscreenRainbow on first tick.
    const scratchTexture = RT.create({ width: 1, height: 1 });

    state = {
      filter,
      offscreenContainer,
      offscreenSprite,
      scratchTexture,
      sourceTexture: null,
      lastWidth: 0,
      lastHeight: 0,
      // PR #4 task 19 dirty-gate fields retained for future use but unused now.
      lastRenderedSourceIdentity: null,
      dirty: true,
    };
    bySprite.set(ruleId, state);

    // If Phase 4a lite was already set up for this rule, tear it down — the
    // offscreen path replaces it.
    clearRiveRainbowLiteOnly(sprite, ruleId);

    installOffscreenTicker();
    activeRiveSprites.add(sprite);
    log(`riveAdapter: phase 4c OffscreenFilter active for rule ${ruleId}`);
    return true;
  } catch (e) {
    warnFeature('QPM-TEXTURESWAP-001', { what: 'offscreenSetup:apply', ruleId }, e);
    return false;
  }
}

/**
 * Tear down the offscreen rainbow state for one rule. Called from
 * clearRiveRainbow. INTENTIONAL LEAK on scratchTexture per the beta's
 * OffscreenFilter.ts:104-112 — PIXI v8 caches render-group instructions
 * across frames and destroying the scratch GL source mid-flight crashes
 * the batcher with `Cannot read properties of null (reading 'addressModeU')`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearRiveRainbowOffscreen(sprite: any, ruleId: string): void {
  const bySprite = offscreenRainbowsBySprite.get(sprite as object);
  if (!bySprite) return;
  const state = bySprite.get(ruleId);
  if (!state) return;
  try {
    // Restore original rive backing texture so the sprite goes back to its
    // un-filtered self when the rule is reverted.
    if (state.sourceTexture && !sprite.destroyed) {
      try {
        sprite.texture = state.sourceTexture;
      } catch { /* ignore */ }
    }
    // Destroy the offscreen container + child sprite. Do NOT destroy scratch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { (state.offscreenContainer as any)?.destroy?.({ children: true, texture: false }); } catch { /* ignore */ }
  } catch { /* ignore */ }
  bySprite.delete(ruleId);
  if (bySprite.size === 0) {
    offscreenRainbowsBySprite.delete(sprite as object);
    activeOffscreenSprites.delete(sprite);
    if (activeOffscreenSprites.size === 0) uninstallOffscreenTicker();
  }
}
