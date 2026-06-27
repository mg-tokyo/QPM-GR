// src/features/standalone/textureSwapper/rive/sprite-patching.ts
// Prototype patches on PIXI Sprite for Rive instances: width/height setters
// (apply per-instance scale multiplier) and draw method (re-apply per-instance
// texture override after Rive's syncTextureFromBacking). Extracted from
// riveAdapter.ts during PR #1 of the 2026-06-27 perf refactor.
//
// PIXI v8 isn't directly importable from the bundle (verified by snippet Q —
// 46 chunks tried, no module exports `Filter` or `GlProgram`). We reach PIXI
// internals through scene-graph capture: walk for the first SharedRiveSprite-
// shaped instance to get its constructor + prototype, walk up to find PIXI's
// Sprite owner of the width/height setters, then monkey-patch at the setter
// level. Idempotent.

import { log } from '../types';
import { walkSpriteTree, getPixiApp } from '../pixi-walk';
import { uninstallPetOverlayTicker } from '../rivePetOverlay';
import { clearCapturedFilterCtors } from '../riveFilters';
import {
  isRiveSprite,
  isInstanceOfCapturedRive,
  brandRiveSprite,
} from './detection';
import { getRiveSpriteScale } from './scale-alpha-textureOverride';
import { uninstallRainbowTicker } from './rainbow-lite';
import { uninstallOffscreenTicker } from './rainbow-offscreen';
import {
  capturedRiveSpriteCtors,
  capturedRiveSpriteCtorRef,
  capturedRendererProtoRef,
  capturedDrawsByCtor,
  riveTextureOverrides,
} from './state';

/**
 * Locate a SharedRiveWorldRenderer-adjacent prototype reachable from a Rive
 * sprite. Previously this function early-returned unless `riveSprite.onRender`
 * was set — that property is only set by SharedRiveWorldRenderer on Rive DECOR
 * (SharedRiveSprite). Rive PETS (RiveSprite class) have no onRender, so when
 * a pet was the first Rive sprite the walker found, the function bailed
 * before installing the width/height setter patch → MarbleFountain scale
 * multiplier was stored but never applied. The width-setter patch works for
 * any Rive sprite because PIXI.Sprite.prototype owns the setter, so we just
 * walk to its owner without the onRender gate.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function captureRendererPrototype(riveSprite: any): any | null {
  // Capture this Rive subclass. Both RiveSprite (pets) and SharedRiveSprite
  // (decor) extend PIXI.Sprite as siblings — we accumulate every Rive ctor we
  // observe so the instanceof check covers both.
  const ctor = riveSprite.constructor;
  capturedRiveSpriteCtors.add(ctor);
  if (!capturedRiveSpriteCtorRef.value) capturedRiveSpriteCtorRef.value = ctor;
  // PR #5 task 23: stamp the __qpmIsRive brand on the instance + its
  // prototype so future instances inherit it. Speeds up the
  // isInstanceOfCapturedRive call on the width/height setter hot path —
  // previously a Set walk for every PIXI sprite in the game on every frame.
  brandRiveSprite(riveSprite);

  // Direct prototype patch approach: patch SharedRiveSprite.prototype to
  // intercept `width`/`height` setters, multiplying by the per-instance
  // factor before forwarding to the original setter. This bypasses
  // SharedRiveWorldRenderer entirely — we just scale up the value the
  // renderer wrote, every frame, before PIXI sees it.
  const proto = Object.getPrototypeOf(riveSprite);
  const widthDesc = Object.getOwnPropertyDescriptor(proto, 'width')
    ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), 'width');
  const heightDesc = Object.getOwnPropertyDescriptor(proto, 'height')
    ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(proto), 'height');
  if (!widthDesc?.set || !heightDesc?.set) {
    log('riveAdapter: width/height setters not found on Sprite prototype');
    return null;
  }
  // Find the prototype that owns the setter — typically PIXI.Sprite or Container.
  let widthOwner = proto;
  while (widthOwner && !Object.getOwnPropertyDescriptor(widthOwner, 'width')?.set) {
    widthOwner = Object.getPrototypeOf(widthOwner);
    if (!widthOwner || widthOwner === Object.prototype) return null;
  }
  let heightOwner = proto;
  while (heightOwner && !Object.getOwnPropertyDescriptor(heightOwner, 'height')?.set) {
    heightOwner = Object.getPrototypeOf(heightOwner);
    if (!heightOwner || heightOwner === Object.prototype) return null;
  }
  capturedRendererProtoRef.value = { widthOwner, heightOwner, widthDesc, heightDesc };
  return capturedRendererProtoRef.value;
}

/**
 * One-time install. Patches the width/height setters on the PIXI Sprite
 * prototype (the one used by SharedRiveSprite) to multiply incoming values
 * by the per-instance scale multiplier. The renderer's syncDisplaySize sets
 * width/height every render frame — by intercepting at the setter level we
 * apply our multiplier inline without fighting the renderer.
 *
 * Returns a disposer that restores the original setters.
 */
export function installRiveAdapter(): () => void {
  // Walk the stage once to find any Rive sprite and capture its prototype.
  // If none present, the next Layer B apply pass will trigger captureFromScene.
  captureFromScene();
  return () => {
    // Tear down the Rainbow lite per-frame sync ticker if installed.
    uninstallRainbowTicker();
    // Tear down the Phase 4c offscreen ticker if installed.
    uninstallOffscreenTicker();
    // Tear down the Phase 7 texture override hook on draw.
    uninstallRiveTextureHook();
    // Tear down the pet-overlay sync ticker if installed.
    uninstallPetOverlayTicker();
    // Drop cached PIXI Filter / GlProgram references.
    clearCapturedFilterCtors();
    // Restore captured prototype setters.
    if (capturedRendererProtoRef.value) {
      const { widthOwner, heightOwner, widthDesc, heightDesc } = capturedRendererProtoRef.value;
      try { Object.defineProperty(widthOwner, 'width', widthDesc); } catch { /* ignore */ }
      try { Object.defineProperty(heightOwner, 'height', heightDesc); } catch { /* ignore */ }
      capturedRendererProtoRef.value = null;
      capturedRiveSpriteCtorRef.value = null;
      capturedRiveSpriteCtors.clear();
    }
  };
}

/**
 * Walk the live stage for a Rive sprite and apply the prototype patch.
 * Idempotent: returns early if patch already installed. Called both from
 * `installRiveAdapter` and lazily from `layerB-apply.ts` per-sprite loop the
 * first time a Rive sprite is observed (handles the case where no Rive
 * decor is present at QPM startup).
 */
export function captureFromScene(): void {
  // Always walk for additional Rive ctors even when the width-setter patch is
  // installed — the game has TWO sibling Rive classes (RiveSprite + SharedRiveSprite),
  // and the first call captures whichever appeared first; later calls pick up
  // the other once it materializes (e.g. a pet spawned after decor).
  const app = getPixiApp();
  if (!app?.stage) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let target: any = null;
  walkSpriteTree(app.stage, (sprite) => {
    if (!isRiveSprite(sprite)) return;
    // Stamp the brand on every Rive sprite the walker sees — covers sprites
    // whose class was already captured but the instance is fresh.
    brandRiveSprite(sprite);
    const ctor = sprite.constructor;
    if (!capturedRiveSpriteCtors.has(ctor)) {
      capturedRiveSpriteCtors.add(ctor);
      if (!capturedRiveSpriteCtorRef.value) capturedRiveSpriteCtorRef.value = ctor;
      // Install the per-class draw hook the first time we see this class.
      installRiveTextureHookOnCtor(ctor);
    }
    if (!target) target = sprite;
  });
  if (capturedRendererProtoRef.value) return; // width setter already patched
  if (!target) return;
  const proto = captureRendererPrototype(target);
  if (!proto) return;

  // Patch width setter.
  const { widthOwner, heightOwner, widthDesc, heightDesc } = proto;
  const origWidthSet = widthDesc.set;
  const origHeightSet = heightDesc.set;
  if (!origWidthSet || !origHeightSet) return;

  Object.defineProperty(widthOwner, 'width', {
    ...widthDesc,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set(this: any, value: number) {
      if (isInstanceOfCapturedRive(this)) {
        const { x } = getRiveSpriteScale(this);
        origWidthSet.call(this, value * x);
      } else {
        origWidthSet.call(this, value);
      }
    },
  });
  Object.defineProperty(heightOwner, 'height', {
    ...heightDesc,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    set(this: any, value: number) {
      if (isInstanceOfCapturedRive(this)) {
        const { y } = getRiveSpriteScale(this);
        origHeightSet.call(this, value * y);
      } else {
        origHeightSet.call(this, value);
      }
    },
  });

  log('riveAdapter: installed width/height setter patch on Rive sprite prototype');

  // Phase 7 — texture override hook. Patches SharedRiveSprite.prototype.draw
  // so that any sprite with a registered texture override gets that override
  // re-applied after the original draw runs syncTextureFromBacking and resets
  // sprite.texture to the rive backing. Required for pet swaps (which have
  // no static atlas sibling to fall back to) and for Rive-decor swaps without
  // useStaticFallback.
  installRiveTextureHook();
}

function installRiveTextureHook(): void {
  // Compatibility entry — install on the primary captured ctor. Per-class
  // installation happens via installRiveTextureHookOnCtor as new Rive ctors
  // are discovered (pets vs decor are sibling classes, each with their own
  // prototype.draw).
  if (capturedRiveSpriteCtorRef.value) installRiveTextureHookOnCtor(capturedRiveSpriteCtorRef.value);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function installRiveTextureHookOnCtor(ctor: any): void {
  if (!ctor || capturedDrawsByCtor.has(ctor)) return;
  const proto = ctor.prototype;
  const origDraw = proto?.draw;
  if (typeof origDraw !== 'function') {
    log('installRiveTextureHookOnCtor: draw not found on prototype');
    return;
  }
  capturedDrawsByCtor.set(ctor, origDraw);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  proto.draw = function patchedDraw(this: any, timeMs: number): void {
    origDraw.call(this, timeMs);
    const override = riveTextureOverrides.get(this as object);
    if (!override) return;
    if (this.texture === override) return;
    // Re-apply override after syncTextureFromBacking restored the backing.
    // Preserve display via UNIFORM scale, not independent width/height —
    // the override texture's natural aspect (e.g. pet/WhiteCaribou canvas is
    // 465×831, very tall) rarely matches the rive backing's aspect. Setting
    // width=dw and height=dh independently stretches the override to fill
    // the backing's box, producing a squashed-looking pet. Uniform scale
    // fits the override into the backing's box at its native aspect.
    const dw = this.width;
    const dh = this.height;
    try {
      this.texture = override;
      const oW = override?.orig?.width ?? override?.frame?.width ?? 0;
      const oH = override?.orig?.height ?? override?.frame?.height ?? 0;
      if (oW > 0 && oH > 0 && dw > 0 && dh > 0) {
        // Preserve sign for flipped sprites (game may render some pets mirrored).
        const sx = (this.scale?.x ?? 1) < 0 ? -1 : 1;
        const sy = (this.scale?.y ?? 1) < 0 ? -1 : 1;
        const uniform = Math.min(dw / oW, dh / oH);
        this.scale?.set?.(sx * uniform, sy * uniform);
      } else {
        this.width = dw;
        this.height = dh;
      }
    } catch (e) {
      log('patchedDraw: texture override failed', e);
    }
  };
  log('riveAdapter: installed texture override hook on Rive sprite draw');
}

function uninstallRiveTextureHook(): void {
  for (const [ctor, origDraw] of capturedDrawsByCtor) {
    try { ctor.prototype.draw = origDraw; } catch { /* ignore */ }
  }
  capturedDrawsByCtor.clear();
}
