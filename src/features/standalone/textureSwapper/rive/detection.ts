// src/features/standalone/textureSwapper/rive/detection.ts
// Identification helpers for Rive sprites. Extracted from riveAdapter.ts
// during PR #1 of the 2026-06-27 perf refactor.
//
// Detection criteria (matching console probe A's confirmed shape):
//   - Sprite-subclass instance (has texture, addChild, scale, anchor, etc.).
//   - Visible in the scene graph.
//   - Texture label is empty string (render-target, not atlas-backed).
//   - Own label matches a known Rive decor name (case-insensitive match
//     against the configured RIVE_DECOR_IDS) — OR has the rive `draw(timeMs)`
//     signature (covers pets / non-decor Rive instances).

import { ctx } from '../types';
import { RIVE_DECOR_LOWER } from './constants';
import {
  cachedBasePixiSpriteRef,
  capturedRiveSpriteCtors,
  capturedRiveSpriteCtorRef,
} from './state';

/**
 * Get a constructable base PIXI.Sprite constructor for our own overlay sprites.
 * Walks from the captured Rive subclass to its parent prototype (PIXI.Sprite);
 * falls back to walking a live Rive instance's prototype chain, then to
 * ctors.Sprite as a last resort.
 *
 * `ctx.currentSvc.state.ctors.Sprite` is captured by sprite-v2 via a scene-
 * graph walk and can return a Rive subclass (SharedRiveSprite). `new
 * SharedRiveSprite(tex)` fails inside the game's Rive backing acquisition with
 * `Cannot read properties of undefined (reading 'advance')` — verified live in
 * the Rive Rainbow lite mask creation path. Walking up to the PIXI base class
 * gives us a constructable Sprite for our own overlay/mask sprites.
 *
 * @param riveInstance Optional live Rive sprite — used to derive the base
 *   class when the captured ctor ref hasn't been set yet.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getBasePixiSpriteCtor(riveInstance?: any): any | null {
  if (cachedBasePixiSpriteRef.value) return cachedBasePixiSpriteRef.value;
  if (capturedRiveSpriteCtorRef.value) {
    const candidate = Object.getPrototypeOf(capturedRiveSpriteCtorRef.value.prototype)?.constructor;
    if (candidate && candidate !== Object) {
      cachedBasePixiSpriteRef.value = candidate;
      return candidate;
    }
  }
  // Walk a live Rive instance's prototype chain when the ctor ref isn't
  // captured yet. SharedRiveSprite → PIXI.Sprite → Container → ...
  if (riveInstance && typeof riveInstance === 'object') {
    try {
      const riveProto = Object.getPrototypeOf(riveInstance);
      const baseProto = riveProto ? Object.getPrototypeOf(riveProto) : null;
      const candidate = baseProto?.constructor;
      if (candidate && candidate !== Object) {
        cachedBasePixiSpriteRef.value = candidate;
        return candidate;
      }
    } catch { /* ignore */ }
  }
  return ctx.currentSvc?.state.ctors?.Sprite ?? null;
}

/**
 * Brand stamped on every Rive sprite the first time we observe it. Read by
 * isInstanceOfCapturedRive's hot path to skip the Set iteration on the
 * thousands of non-Rive sprites that hit the width/height setter patches
 * every frame (audit CRITICAL #22 / PR #5 task 23).
 */
const RIVE_BRAND_KEY = '__qpmIsRive';

/**
 * Mark a sprite (and every later instance constructed from its prototype
 * chain) as Rive-detected. The brand is also stamped on the constructor
 * prototype so future instances inherit it without another check.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function brandRiveSprite(sprite: any): void {
  if (!sprite || typeof sprite !== 'object') return;
  try { sprite[RIVE_BRAND_KEY] = true; } catch { /* ignore */ }
  const ctor = sprite.constructor;
  const proto = ctor?.prototype;
  if (proto && proto[RIVE_BRAND_KEY] !== true) {
    try { proto[RIVE_BRAND_KEY] = true; } catch { /* ignore */ }
  }
}

/**
 * True when sprite is `instanceof` any captured Rive class. Fast path: read
 * the `__qpmIsRive` brand stamped at capture time. Slow path (legacy
 * fallback for sprites that haven't been branded yet): walk the captured
 * ctor set. After the first frame the brand path covers every Rive sprite
 * in scene.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isInstanceOfCapturedRive(sprite: any): boolean {
  if (sprite && sprite[RIVE_BRAND_KEY] === true) return true;
  for (const ctor of capturedRiveSpriteCtors) {
    if (sprite instanceof ctor) {
      // Stamp the brand so future calls hit the fast path.
      try { sprite[RIVE_BRAND_KEY] = true; } catch { /* ignore */ }
      return true;
    }
  }
  return false;
}

/**
 * True when the sprite is an instance of the captured SharedRiveSprite class,
 * OR (pre-capture) matches the Rive-sprite shape heuristic. The heuristic now
 * covers both Rive decor (matched by name) and Rive pets (matched by the
 * `draw(timeMs)` method signature, which is specific to SharedRiveSprite /
 * RiveSprite and absent from plain PIXI.Sprite / PIXI.Container). Without the
 * pet branch, Rive pets fell through to the non-Rive path: `sprite.scale.set`
 * gets clobbered every frame by the Rive renderer, and texture swaps render
 * the atlas-trim coords on a canvas-backed source (the "poorly cropped zoomed
 * in" pet symptom).
 */
export function isRiveSprite(sprite: unknown): boolean {
  if (!sprite || typeof sprite !== 'object') return false;
  if (isInstanceOfCapturedRive(sprite)) return true;
  // Pre-capture heuristic — matches the shape confirmed by console probe A.
  const s = sprite as {
    label?: unknown;
    texture?: { label?: unknown };
    visible?: unknown;
    addChild?: unknown;
    draw?: unknown;
  };
  if (typeof s.addChild !== 'function') return false;
  if (s.visible !== true) return false;
  const ownLabel = typeof s.label === 'string' ? s.label : '';
  const texLabel = (s.texture && typeof s.texture.label === 'string') ? s.texture.label : '';
  // 1) Rive decor — own label includes a known Rive decor id, texture label empty.
  if (ownLabel && texLabel === '') {
    const lower = ownLabel.toLowerCase();
    for (const id of RIVE_DECOR_LOWER) {
      if (lower.includes(id)) return true;
    }
  }
  // 2) Rive pets (and any other Rive-backed sprite type) — they all define
  //    `draw(timeMs)`. PIXI.Sprite / PIXI.Container have no `draw` method.
  //    Method names survive minification in the game bundle (verified by the
  //    Phase 7 draw hook successfully patching `proto.draw`).
  const draw = (s as { draw?: unknown }).draw;
  if (typeof draw === 'function' && (draw as { length: number }).length === 1) {
    return true;
  }
  return false;
}

/**
 * Distinguish a Rive DECOR sprite (SharedRiveSprite — texture is a backing
 * RenderTexture) from a Rive PET sprite (RiveSprite — texture is a plain
 * default texture). Heuristic uses RenderTexture's `.resize(w, h)` method,
 * which plain PIXI Texture lacks. Used by layerB-apply to route swap/mutation
 * rules to the right code path.
 */
export function isRiveDecorSprite(sprite: unknown): boolean {
  if (!isRiveSprite(sprite)) return false;
  const tex = (sprite as { texture?: { resize?: unknown } })?.texture;
  return !!tex && typeof tex.resize === 'function';
}

/** Inverse: true for Rive pet sprites (or any Rive sprite without a RenderTexture). */
export function isRivePetSprite(sprite: unknown): boolean {
  return isRiveSprite(sprite) && !isRiveDecorSprite(sprite);
}

/**
 * Find the underlying HTMLCanvasElement (or canvas-like) backing a Texture.
 * PIXI v8 stores it differently across source types:
 *   - CanvasSource (from `Texture.from(canvas)`): canvas at `source.resource` directly.
 *   - ImageSource (atlas-loaded): one level deeper at `source.resource.source` or `.element`.
 * Walks all known paths and returns the first canvas-shaped value.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractCanvasFromTexture(tex: any): HTMLCanvasElement | null {
  if (!tex) return null;
  const src = tex.source ?? tex._source ?? tex._baseTexture ?? null;
  if (!src) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const candidates: any[] = [
    src.resource,
    src.resource?.source,
    src.resource?.element,
    src.canvas,
    src._canvas,
    src.source,
  ];
  for (const c of candidates) {
    if (!c) continue;
    // Direct HTMLCanvasElement (or OffscreenCanvas).
    if (typeof HTMLCanvasElement !== 'undefined' && c instanceof HTMLCanvasElement && c.width > 0) {
      return c;
    }
    // Canvas-like duck check (OffscreenCanvas, custom wrappers).
    if (typeof c === 'object' && typeof c.getContext === 'function' && (c.width ?? 0) > 0) {
      return c as HTMLCanvasElement;
    }
  }
  return null;
}
