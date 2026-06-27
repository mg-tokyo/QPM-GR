import { log, ctx } from './types';
import { getPixiApp } from './pixi-walk';

// ---------------------------------------------------------------------------
// Pet swap sibling-overlay
//
// Why this exists: Rive PETS (RiveSprite class, not SharedRiveSprite) render
// via `batchRenderer.markForRender(this)` — the visible image comes from the
// rive batch renderer reading the artboard directly, not from sprite.texture.
// The Phase 7 draw hook (sprite.texture = override) is therefore a no-op for
// pets. To replace a pet's appearance we have to draw something else.
//
// Strategy: hide the rive pet sprite (renderable=false) and add a sibling
// PIXI Sprite to the same parent containing our custom texture. Sync the
// sibling's position / anchor / scale to the rive pet every frame so it
// tracks pet movement and zoom. Same approach as Phase 4a Rainbow lite's
// wrapper Container, which works reliably on decor.
//
// Public API:
//   applyRivePetSwap(sprite, ruleId, customTex)
//   clearRivePetSwap(sprite, ruleId)
//   syncRivePetOverlays()  — called by riveAdapter's per-frame sync
//
// Detection of "this Rive sprite is a pet, not a decor" lives in riveAdapter
// (isRiveDecorSprite). layerB-apply routes pet swap rules here based on that
// signal.
// ---------------------------------------------------------------------------

type PetOverlayState = {
  wrapper: any;
  sprite: any;
  texture: any;
  prevRenderable: boolean;
};

const petOverlaysBySprite = new WeakMap<object, Map<string, PetOverlayState>>();
const activePetSprites = new Set<any>();

let petOverlayTickerCallback: (() => void) | null = null;

/**
 * Install or update the sibling-overlay for this rule on a Rive pet sprite.
 * Idempotent — repeating with the same texture re-syncs only; with a different
 * texture, updates the sprite's texture in place.
 */
export function applyRivePetSwap(
  rivePet: any,
  ruleId: string,
  customTex: any,
  SpriteCtor: any,
  ContainerCtor: any,
): void {
  if (!rivePet || !customTex || !SpriteCtor || !ContainerCtor) return;
  const parent = rivePet.parent;
  if (!parent) return; // pet not in scene yet — layer B retries on next tick

  let bySprite = petOverlaysBySprite.get(rivePet as object);
  if (!bySprite) {
    bySprite = new Map();
    petOverlaysBySprite.set(rivePet as object, bySprite);
  }

  let state = bySprite.get(ruleId);
  if (!state) {
    try {
      const wrapper = new ContainerCtor();
      (wrapper as { __qpmOverlay?: true; label?: string }).__qpmOverlay = true;
      (wrapper as { label?: string }).label = `qpmPetSwap:${ruleId}`;
      parent.addChild(wrapper);

      const overlaySprite = new SpriteCtor(customTex);
      (overlaySprite as { __qpmOverlay?: true }).__qpmOverlay = true;
      wrapper.addChild(overlaySprite);

      state = {
        wrapper,
        sprite: overlaySprite,
        texture: customTex,
        prevRenderable: rivePet.renderable !== false,
      };
      bySprite.set(ruleId, state);

      // Hide the rive pet underneath. We use renderable=false (not visible=false)
      // so the rive pet's children — if any — stay rendered AND its draw() still
      // runs so the artboard advances normally. Setting visible=false skips draw
      // entirely which would stop the rive animation timer and produce a stale
      // pet on the next un-hide.
      rivePet.renderable = false;

      log(
        `applyRivePetSwap: overlay created for rule ${ruleId} on pet `
        + `parent=${(parent as { label?: string }).label ?? '(unlabeled)'}, `
        + `pet position=(${rivePet.position?.x ?? '?'}, ${rivePet.position?.y ?? '?'}), `
        + `prevRenderable=${state.prevRenderable}`,
      );
    } catch (e) {
      log('applyRivePetSwap: setup failed', e);
      return;
    }
  } else if (state.texture !== customTex) {
    try {
      state.sprite.texture = customTex;
      state.texture = customTex;
    } catch (e) {
      log('applyRivePetSwap: texture update failed', e);
    }
  } else if (state.wrapper && state.wrapper.parent !== parent) {
    // Parent changed (rare — game re-parents pets on container swap).
    try { parent.addChild(state.wrapper); } catch {}
  }

  // Always re-assert hidden state — game render code may flip renderable back.
  if (rivePet.renderable !== false) {
    rivePet.renderable = false;
  }

  syncPetOverlayPositionAndScale(rivePet, state);
  activePetSprites.add(rivePet);
  installPetOverlayTicker();
}

/**
 * Tear down a rule's sibling overlay for this pet. Restores the rive pet's
 * renderable flag so the original artboard renders again.
 */
export function clearRivePetSwap(rivePet: any, ruleId: string): void {
  const bySprite = petOverlaysBySprite.get(rivePet as object);
  if (!bySprite) return;
  const state = bySprite.get(ruleId);
  if (!state) return;
  try {
    if (state.wrapper) {
      if (state.wrapper.parent) {
        try { state.wrapper.parent.removeChild(state.wrapper); } catch {}
      }
      try { state.wrapper.destroy?.({ children: true, texture: false }); } catch {}
    }
    if (!rivePet.destroyed) {
      rivePet.renderable = state.prevRenderable;
    }
  } catch (e) {
    log('clearRivePetSwap: teardown error', e);
  }
  bySprite.delete(ruleId);
  if (bySprite.size === 0) {
    petOverlaysBySprite.delete(rivePet as object);
    activePetSprites.delete(rivePet);
    // PR #5 task 25 — uninstall the per-frame ticker when no pets remain.
    // Without this, rule churn (apply → clear → apply) leaks an idle ticker
    // every cycle since installPetOverlayTicker is idempotent but uninstall
    // was only called from the adapter disposer.
    if (activePetSprites.size === 0) uninstallPetOverlayTicker();
  }
}

/** True when this pet has at least one active swap overlay tracked here. */
export function hasRivePetOverlay(rivePet: any): boolean {
  return activePetSprites.has(rivePet);
}

/** Tear down every overlay for every tracked pet. Called from revertAllRiveOverlays. */
export function clearAllRivePetSwaps(): void {
  const snapshot = [...activePetSprites];
  for (const rivePet of snapshot) {
    const bySprite = petOverlaysBySprite.get(rivePet as object);
    if (!bySprite) continue;
    for (const ruleId of [...bySprite.keys()]) {
      clearRivePetSwap(rivePet, ruleId);
    }
  }
  activePetSprites.clear();
}

// ---------------------------------------------------------------------------
// Per-frame sync
// ---------------------------------------------------------------------------

let driftWarnedAt = 0;

function syncPetOverlayPositionAndScale(rivePet: any, state: PetOverlayState): void {
  if (!state.wrapper || !state.sprite || rivePet.destroyed) return;
  try {
    state.wrapper.position?.set?.(rivePet.position?.x ?? 0, rivePet.position?.y ?? 0);
  } catch {}

  const dw = Math.abs(rivePet.width ?? 0);
  const dh = Math.abs(rivePet.height ?? 0);
  const ax = rivePet.anchor?.x ?? 0.5;
  const ay = rivePet.anchor?.y ?? 1.0; // pets anchor at bottom-center per createPetRiveSprite.ts:129
  const sx = (rivePet.scale?.x ?? 1) < 0 ? -1 : 1;
  const sy = (rivePet.scale?.y ?? 1) < 0 ? -1 : 1;
  if (dw <= 0 || dh <= 0) {
    // Drift diagnostic — emit at most once per second to avoid spam.
    const now = performance.now?.() ?? 0;
    if (now - driftWarnedAt > 1000) {
      driftWarnedAt = now;
      log(`syncPetOverlay: rive pet has zero display dims (${rivePet.width}, ${rivePet.height}) — overlay will be invisible until pet renders`);
    }
    return;
  }

  try {
    state.sprite.anchor?.set?.(ax, ay);
    const tw = state.sprite.texture?.orig?.width ?? state.sprite.texture?.frame?.width ?? 0;
    const th = state.sprite.texture?.orig?.height ?? state.sprite.texture?.frame?.height ?? 0;
    if (tw > 0 && th > 0) {
      // Uniform scale preserves aspect — pet canvas may be 465×831 (tall)
      // while rive pet display box might be near-square; uniform scale fits
      // the canvas into the pet's box without stretch.
      const uniform = Math.min(dw / tw, dh / th);
      state.sprite.scale?.set?.(sx * uniform, sy * uniform);
    } else {
      state.sprite.width = dw * sx;
      state.sprite.height = dh * sy;
    }
  } catch (e) {
    log('syncPetOverlay: dim update failed', e);
  }

  // Defense in depth — if game render code flipped renderable back, hide again.
  if (rivePet.renderable !== false) {
    rivePet.renderable = false;
    const now = performance.now?.() ?? 0;
    if (now - driftWarnedAt > 1000) {
      driftWarnedAt = now;
      log('syncPetOverlay: rive pet renderable flipped back to true — re-hiding');
    }
  }
}

/**
 * Iterate every tracked pet and re-sync their overlays. Cheap: WeakMap lookup
 * plus a handful of property writes per active pet.
 */
export function syncRivePetOverlays(): void {
  for (const rivePet of activePetSprites) {
    const bySprite = petOverlaysBySprite.get(rivePet as object);
    if (!bySprite) continue;
    for (const state of bySprite.values()) {
      syncPetOverlayPositionAndScale(rivePet, state);
    }
  }
}

function installPetOverlayTicker(): void {
  if (petOverlayTickerCallback) return;
  const app = getPixiApp();
  if (!app?.ticker) return;
  petOverlayTickerCallback = () => syncRivePetOverlays();
  try { app.ticker.add(petOverlayTickerCallback); } catch (e) {
    log('installPetOverlayTicker: failed', e);
    petOverlayTickerCallback = null;
  }
}

export function uninstallPetOverlayTicker(): void {
  if (!petOverlayTickerCallback) return;
  const app = getPixiApp();
  try { app?.ticker?.remove?.(petOverlayTickerCallback); } catch {}
  petOverlayTickerCallback = null;
}

// ctx kept import-side for parity with riveAdapter helpers if needed later.
void ctx;
