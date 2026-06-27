// src/features/standalone/textureSwapper/rive/rainbow-lite.ts
// Phase 4a — v8-correct sibling-Container scene graph for Rive rainbow.
// Extracted from riveAdapter.ts during PR #1 of the 2026-06-27 perf refactor.
//
// Original implementation added mask + overlay as children of the riveSprite
// itself. That broke in two ways:
//   1. PIXI v8 marks Sprite as a LEAF NODE — `sprite.addChild()` is "invalid
//      in v8" per the migration docs. Children get rendered but don't pick
//      up mask handling correctly.
//   2. PIXI v8 sprite masks use filters internally. The beta's OffscreenFilter
//      documents: "Works around a PixiJS v8 bug where spatial filters produce
//      position-dependent coordinates inside render groups." The Rive backing
//      IS a render group (RenderTexture). Result: mask never clips → user sees
//      the full rainbow rectangle.
//
// New approach: wrap mask + overlay in a Container, parent the Container as
// a SIBLING of the riveSprite. Container can have children per v8. Position
// the wrapper to match riveSprite each frame via app.ticker. Size mask +
// overlay via the SPRITE width/height setters so the gradient texture itself
// never needs to be rebuilt — fixing the zoom jump bug.

import { ctx, log } from '../types';
import { getPixiApp } from '../pixi-walk';
import {
  RAINBOW_COLORS,
  RAINBOW_ANGLE_DEG,
  RAINBOW_ALPHA,
  GRADIENT_REF_SIZE,
} from './constants';
import { getBasePixiSpriteCtor } from './detection';
import {
  type RainbowOverlayState,
  activeRiveSprites,
  activeRainbowSprites,
  rainbowOverlaysBySprite,
  rainbowTickerCallbackRef,
} from './state';
import {
  tryApplyOffscreenRainbow,
  clearRiveRainbowOffscreen,
} from './rainbow-offscreen';
import { maybeUpgradeRiveRainbow, rainbowFiltersBySprite } from './rainbow-filter';

/**
 * Build the rainbow gradient once at GRADIENT_REF_SIZE square. Direction uses
 * an isotropic distance (`size` for both dx and dy) so the on-screen angle
 * stays at RAINBOW_ANGLE_DEG regardless of how the sprite's later scale
 * stretches the texture to fit non-square display dimensions.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildRainbowGradient(ctors: { Texture: any }): any {
  const canvas = document.createElement('canvas');
  canvas.width = GRADIENT_REF_SIZE;
  canvas.height = GRADIENT_REF_SIZE;
  const c2 = canvas.getContext('2d');
  if (!c2) return null;
  const rad = (RAINBOW_ANGLE_DEG * Math.PI) / 180;
  const size = GRADIENT_REF_SIZE;
  // Isotropic direction — same magnitude in x and y → angle invariant.
  const dx = Math.cos(rad) * size;
  const dy = Math.sin(rad) * size;
  const cx = size / 2;
  const cy = size / 2;
  const grad = c2.createLinearGradient(cx - dx / 2, cy - dy / 2, cx + dx / 2, cy + dy / 2);
  RAINBOW_COLORS.forEach((c, i) => grad.addColorStop(i / (RAINBOW_COLORS.length - 1), c));
  c2.fillStyle = grad;
  c2.fillRect(0, 0, size, size);
  return ctors.Texture.from(canvas);
}

/**
 * Per-frame sync: position the wrapper Container to track riveSprite, and
 * resize mask + overlay to match riveSprite's display dimensions. Anchor
 * and scale sign copied from riveSprite so flipped sprites mirror correctly.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function syncRainbowState(sprite: any, state: RainbowOverlayState): void {
  if (!state.wrapper || !state.mask || !state.overlay) return;
  if (sprite.destroyed) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wrapper = state.wrapper as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mask = state.mask as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const overlay = state.overlay as any;

  // Re-parent wrapper if riveSprite moved to a different container.
  if (sprite.parent && wrapper.parent !== sprite.parent) {
    try { sprite.parent.addChild(wrapper); } catch { /* ignore */ }
  }

  try {
    wrapper.position?.set?.(sprite.position?.x ?? 0, sprite.position?.y ?? 0);
  } catch { /* ignore */ }

  const dw = Math.abs(sprite.width ?? 0);
  const dh = Math.abs(sprite.height ?? 0);
  const ax = sprite.anchor?.x ?? 0.5;
  const ay = sprite.anchor?.y ?? 0.5;
  const sx = (sprite.scale?.x ?? 1) < 0 ? -1 : 1;
  const sy = (sprite.scale?.y ?? 1) < 0 ? -1 : 1;
  if (dw <= 0 || dh <= 0) return;

  try {
    mask.anchor?.set?.(ax, ay);
    mask.width = dw * sx;
    mask.height = dh * sy;
  } catch { /* ignore */ }

  try {
    overlay.anchor?.set?.(ax, ay);
    overlay.width = dw * sx;
    overlay.height = dh * sy;
  } catch { /* ignore */ }

  // Track Rive backing texture swaps for the mask alpha source.
  if (state.lastTextureRef !== sprite.texture) {
    try { mask.texture = sprite.texture; } catch { /* ignore */ }
    state.lastTextureRef = sprite.texture;
  }
}

/**
 * Install a per-frame ticker callback that syncs every active Rainbow lite
 * overlay. Idempotent.
 */
function installRainbowTicker(): void {
  if (rainbowTickerCallbackRef.value) return;
  const app = getPixiApp();
  if (!app?.ticker) return;
  const cb = () => {
    // PR #5 task 24 — iterate ONLY the per-feature active set so scale-only
    // / mutation-only rules don't pay the per-frame walk cost here.
    for (const sprite of activeRainbowSprites) {
      const bySprite = rainbowOverlaysBySprite.get(sprite as object);
      if (!bySprite) continue;
      for (const state of bySprite.values()) {
        syncRainbowState(sprite, state);
      }
    }
  };
  try {
    app.ticker.add(cb);
    rainbowTickerCallbackRef.value = cb;
  } catch (e) {
    log('installRainbowTicker: failed', e);
    rainbowTickerCallbackRef.value = null;
  }
}

/** Remove the ticker callback. Called from the riveAdapter disposer. */
export function uninstallRainbowTicker(): void {
  if (!rainbowTickerCallbackRef.value) return;
  const app = getPixiApp();
  try { app?.ticker?.remove?.(rainbowTickerCallbackRef.value); } catch { /* ignore */ }
  rainbowTickerCallbackRef.value = null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRiveRainbowLite(sprite: any, ruleId: string): void {
  // Phase 4c (EXPERIMENTAL): try the OffscreenFilter pattern.
  if (tryApplyOffscreenRainbow(sprite, ruleId)) return;

  // Phase 4b upgrade attempt — gated for Rive sprites by maybeUpgradeRiveRainbow.
  if (maybeUpgradeRiveRainbow(sprite, ruleId)) return;

  const Sprite = getBasePixiSpriteCtor(sprite);
  const Container = ctx.currentSvc?.state.ctors?.Container;
  const Texture = ctx.currentSvc?.state.ctors?.Texture;
  if (!Sprite || !Container || !Texture) return;
  if (!sprite?.texture) return;

  const parent = sprite.parent;
  if (!parent) return; // riveSprite not in scene yet — Layer B retries

  let bySprite = rainbowOverlaysBySprite.get(sprite as object);
  if (!bySprite) {
    bySprite = new Map();
    rainbowOverlaysBySprite.set(sprite as object, bySprite);
  }

  let state = bySprite.get(ruleId);
  if (!state) {
    state = { wrapper: null, mask: null, overlay: null, gradTex: null, lastTextureRef: null };
    bySprite.set(ruleId, state);
  }

  // 1) Gradient: built ONCE per state, never rebuilt on zoom or texture swap.
  if (!state.gradTex) {
    state.gradTex = buildRainbowGradient({ Texture });
    if (!state.gradTex) return;
  }

  // 2) Wrapper Container — sibling of riveSprite. v8 leaf-node compliant.
  if (!state.wrapper) {
    try {
      const wrapper = new Container();
      (wrapper as { __qpmOverlay?: true; label?: string }).__qpmOverlay = true;
      (wrapper as { label?: string }).label = `qpmRiveRainbow:${ruleId}`;
      parent.addChild(wrapper);
      state.wrapper = wrapper;
    } catch (e) {
      log('applyRiveRainbowLite: failed to create wrapper', e);
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } else if ((state.wrapper as any).parent !== parent) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    try { parent.addChild(state.wrapper as any); } catch { /* ignore */ }
  }

  // 3) Mask — uses riveSprite.texture for alpha-shape clipping.
  if (!state.mask) {
    try {
      const mask = new Sprite(sprite.texture);
      (mask as { __qpmOverlay?: true }).__qpmOverlay = true;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (state.wrapper as any).addChild(mask);
      state.mask = mask;
    } catch (e) {
      log('applyRiveRainbowLite: failed to create mask', e);
      return;
    }
  }

  // 4) Overlay — fixed-size rainbow gradient texture, scaled via width/height.
  if (!state.overlay) {
    try {
      const overlay = new Sprite(state.gradTex);
      (overlay as { __qpmOverlay?: true }).__qpmOverlay = true;
      overlay.alpha = RAINBOW_ALPHA;
      try { (overlay as { blendMode?: string }).blendMode = 'color'; } catch { /* ignore */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (state.wrapper as any).addChild(overlay);
      overlay.mask = state.mask;
      state.overlay = overlay;
    } catch (e) {
      log('applyRiveRainbowLite: failed to create overlay', e);
      return;
    }
  }

  // Initial sync + ticker install for per-frame updates.
  syncRainbowState(sprite, state);
  installRainbowTicker();
  activeRiveSprites.add(sprite);
  activeRainbowSprites.add(sprite);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearRiveRainbow(sprite: any, ruleId: string): void {
  // Offscreen path (Phase 4c) — tear down first; restores original texture.
  clearRiveRainbowOffscreen(sprite, ruleId);

  // Filter path (Phase 4b).
  const byRule = rainbowFiltersBySprite.get(sprite as object);
  const filter = byRule?.get(ruleId);
  if (byRule && filter) {
    try {
      const current = Array.isArray(sprite.filters) ? sprite.filters : [];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const next = current.filter((f: any) => f !== filter);
      sprite.filters = next.length > 0 ? next : null;
    } catch { /* ignore */ }
    byRule.delete(ruleId);
    if (byRule.size === 0) rainbowFiltersBySprite.delete(sprite as object);
  }

  // Lite path (Phase 4a) — tear down wrapper Container + its mask/overlay children.
  const bySprite = rainbowOverlaysBySprite.get(sprite as object);
  if (!bySprite) return;
  const state = bySprite.get(ruleId);
  if (!state) return;
  try {
    if (state.overlay) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { (state.overlay as any).mask = null; } catch { /* ignore */ }
    }
    if (state.wrapper) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapper = state.wrapper as any;
      if (wrapper.parent) {
        try { wrapper.parent.removeChild(wrapper); } catch { /* ignore */ }
      }
      try { wrapper.destroy?.({ children: true, texture: false }); } catch { /* ignore */ }
    } else {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const overlay = state.overlay as any;
      if (overlay?.parent) {
        try { overlay.parent.removeChild(overlay); } catch { /* ignore */ }
      }
      try { overlay?.destroy?.({ children: false, texture: false }); } catch { /* ignore */ }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mask = state.mask as any;
      if (mask?.parent) {
        try { mask.parent.removeChild(mask); } catch { /* ignore */ }
      }
      try { mask?.destroy?.({ children: false, texture: false }); } catch { /* ignore */ }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (state.gradTex) (state.gradTex as any).destroy?.(true);
  } catch { /* ignore */ }
  bySprite.delete(ruleId);
  if (bySprite.size === 0) {
    rainbowOverlaysBySprite.delete(sprite as object);
    activeRainbowSprites.delete(sprite);
    // Auto-uninstall the ticker when no rainbow rules remain across any sprite.
    if (activeRainbowSprites.size === 0) uninstallRainbowTicker();
  }
}

/**
 * Per-frame steady-state sync (PR #4 task 20 / audit CRITICAL #4). The previous
 * implementation called applyRiveRainbowLite per (sprite, rule) per frame —
 * which re-ran the offscreen attempt, ctor capture, prototype walks, and Map
 * lookups every frame. This lightweight helper does ONLY the cheap per-frame
 * sync, assuming apply has already run; the rainbow ticker (installed by apply)
 * handles the visible animation, so per-frame "re-apply" is wasted work.
 *
 * Sprites whose rainbow state is missing here are silently skipped — the next
 * Layer B refresh tick that detects the rule will run apply for them.
 */
export function syncRiveRainbowsForActiveSprites(): void {
  // PR #5 task 24 — iterate the per-feature set, not the union activeRiveSprites.
  for (const sprite of activeRainbowSprites) {
    const bySprite = rainbowOverlaysBySprite.get(sprite as object);
    if (!bySprite) continue;
    for (const state of bySprite.values()) {
      // Skip if apply hasn't completed yet for this rule — wrapper/mask/overlay
      // are still being set up by applyRiveRainbowLite from a Layer B refresh.
      if (!state.wrapper || !state.mask || !state.overlay) continue;
      syncRainbowState(sprite, state);
    }
  }
}

/**
 * Tear down ONLY the Phase 4a lite state (wrapper Container + mask + overlay),
 * leaving the offscreen state intact. Called by tryApplyOffscreenRainbow when
 * upgrading a lite-path rule to offscreen mid-session.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearRiveRainbowLiteOnly(sprite: any, ruleId: string): void {
  const bySprite = rainbowOverlaysBySprite.get(sprite as object);
  const state = bySprite?.get(ruleId);
  if (!state) return;
  try {
    if (state.overlay) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      try { (state.overlay as any).mask = null; } catch { /* ignore */ }
    }
    if (state.wrapper) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wrapper = state.wrapper as any;
      if (wrapper.parent) {
        try { wrapper.parent.removeChild(wrapper); } catch { /* ignore */ }
      }
      try { wrapper.destroy?.({ children: true, texture: false }); } catch { /* ignore */ }
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (state.gradTex) (state.gradTex as any).destroy?.(true);
  } catch { /* ignore */ }
  bySprite?.delete(ruleId);
  if (bySprite && bySprite.size === 0) rainbowOverlaysBySprite.delete(sprite as object);
}
