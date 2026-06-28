import { ctx, log, type LayerBOriginalSnapshot, type TextureOverrideRule } from './types';
import { getFallbackTexture, getPixiApp, isTextureRenderable } from './pixi-walk';
import { clearRiveMutations } from './riveAdapter';
import { getBasePixiSpriteCtor } from './rive/detection';

// ---------------------------------------------------------------------------
// Layer B — per-sprite overlay subsystem
//
// Owns the original-snapshot save/restore path AND the child-sprite overlay
// used by live-overlay (tint/scale/alpha) rules. Pure tint math (hex→PIXI int
// conversion + per-channel lerp) lives here too since it's only ever called
// from the overlay path.
// ---------------------------------------------------------------------------

export function restoreSpriteSnapshot(sprite: any, snapshot: LayerBOriginalSnapshot | undefined): void {
  const restoreTexture = snapshot && isTextureRenderable(snapshot.texture) ? snapshot.texture : null;
  if (restoreTexture) {
    sprite.texture = restoreTexture;
  } else if (!isTextureRenderable(sprite?.texture)) {
    const fallback = getFallbackTexture();
    if (fallback) sprite.texture = fallback;
  }
  // Restore AnimatedSprite frame textures before scale/alpha so PIXI's
  // texture-setter side-effects (auto-rescale) see the original texture.
  if (snapshot?.animFrameTextures) {
    const textures = sprite?.textures;
    if (Array.isArray(textures)) {
      const saved = snapshot.animFrameTextures;
      for (let i = 0; i < saved.length && i < textures.length; i++) {
        const s = saved[i];
        if (s && typeof s === 'object' && 'texture' in s && textures[i] && typeof textures[i] === 'object' && 'texture' in textures[i]) {
          textures[i].texture = s.texture;
        } else {
          textures[i] = s;
        }
      }
    }
  }
  if (snapshot) {
    try { sprite.scale?.set(snapshot.scaleX, snapshot.scaleY); } catch {}
    sprite.alpha = snapshot.alpha;
    if (typeof snapshot.tint === 'number') {
      try { sprite.tint = snapshot.tint; } catch {}
    }
  }
  // Drop scale re-asserter tracking when restoring — without this the asserter
  // would keep multiplying the re-applied snapshot scale every frame.
  unregisterScaleTarget(sprite);
  // Restore original filters array if we recorded one (kept for backwards
  // compatibility with any code paths that still appended a filter).
  if (ctx.layerBOriginalFilters.has(sprite)) {
    const orig = ctx.layerBOriginalFilters.get(sprite);
    try { sprite.filters = orig ?? null; } catch {}
    ctx.layerBOriginalFilters.delete(sprite);
  }
  // Remove our overlay child sprite if we added one — keeps the scene graph
  // clean on revert / disable / delete.
  destroySpriteOverlay(sprite);
  // Remove any Rive-mutation overlay children (Phase 3+).
  clearRiveMutations(sprite);
}

// ---------------------------------------------------------------------------
// Per-frame scale re-asserter
//
// The game's tile renderer re-sizes sprites every ~16-100ms by setting
// sprite.width/height directly, which PIXI v8's setter translates back into
// scale = width/textureWidth — clobbering anything we set in PASS 2. We
// confirmed live (2026-06-27): setting scale.x=1.45 on a LegendaryEgg holds
// for one frame, then snaps back to 1.
//
// Solution: a single app.ticker callback (priority -10, between game logic
// and the renderer) walks the active set of tracked sprites and re-asserts
// the rule's target scale magnitude. Sign is read from the live sprite each
// tick so any game-applied flip (e.g. MarbleKnight's `scale.x = -1` mirror)
// survives.
//
// Cost: O(active sprites) per frame. For a typical workload (a few size
// rules each matching a few dozen sprites) this is negligible.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerScaleTarget(sprite: any, sx: number, sy: number): void {
  if (!sprite || typeof sprite !== 'object') return;
  ctx.scaledSpriteTargets.set(sprite as object, { sx: Math.abs(sx), sy: Math.abs(sy) });
  ctx.scaledSpritesActive.add(sprite as object);
  installScaleAsserter();
}

export function unregisterScaleTarget(sprite: unknown): void {
  if (!sprite || typeof sprite !== 'object') return;
  ctx.scaledSpritesActive.delete(sprite as object);
  ctx.scaledSpriteTargets.delete(sprite as object);
  if (ctx.scaledSpritesActive.size === 0) uninstallScaleAsserter();
}

function installScaleAsserter(): void {
  if (ctx.scaleAsserterCallback) return;
  const app = getPixiApp();
  if (!app?.ticker) return;
  const cb = (): void => {
    if (ctx.scaledSpritesActive.size === 0) return;
    for (const obj of ctx.scaledSpritesActive) {
      const target = ctx.scaledSpriteTargets.get(obj);
      if (!target) continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sprite = obj as any;
      const sc = sprite.scale;
      if (!sc) continue;
      // Preserve any game-applied flip: read the live sign and multiply our
      // magnitude by it. MarbleKnight uses scale.x = -1 to mirror; this keeps
      // mirrored knights mirrored after a scale rule fires.
      const signX = (sc.x < 0 || (sc.x === 0 && Object.is(sc.x, -0))) ? -1 : 1;
      const signY = (sc.y < 0 || (sc.y === 0 && Object.is(sc.y, -0))) ? -1 : 1;
      const wantX = target.sx * signX;
      const wantY = target.sy * signY;
      if (sc.x !== wantX || sc.y !== wantY) {
        try { sc.set(wantX, wantY); } catch { /* ignore */ }
      }
    }
  };
  try {
    app.ticker.add(cb, null, -10);
    ctx.scaleAsserterCallback = cb;
  } catch (e) {
    log('installScaleAsserter: failed', e);
    ctx.scaleAsserterCallback = null;
  }
}

export function uninstallScaleAsserter(): void {
  if (!ctx.scaleAsserterCallback) return;
  const app = getPixiApp();
  try { app?.ticker?.remove?.(ctx.scaleAsserterCallback); } catch { /* ignore */ }
  ctx.scaleAsserterCallback = null;
}

/**
 * #rrggbb → 0xRRGGBB integer for PIXI's sprite.tint property. Invalid input
 * falls back to 0xFFFFFF (no tint).
 */
export function hexToPixiTint(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return 0xffffff;
  return parseInt(m[1]!, 16);
}

/**
 * Linear-interpolate between two RGB integers per channel. strength=0 returns
 * `from`, strength=1 returns `to`. Used to scale the picked tint by the
 * strength slider while keeping PIXI's multiply blend in sprite.tint.
 */
export function lerpTint(from: number, to: number, strength: number): number {
  const s = Math.max(0, Math.min(1, strength));
  const fr = (from >> 16) & 0xff, fg = (from >> 8) & 0xff, fb = from & 0xff;
  const tr = (to >> 16) & 0xff, tg = (to >> 8) & 0xff, tb = to & 0xff;
  const r = Math.round(fr + (tr - fr) * s);
  const g = Math.round(fg + (tg - fg) * s);
  const b = Math.round(fb + (tb - fb) * s);
  return (r << 16) | (g << 8) | b;
}

/**
 * True for advanced-only rules that don't replace pixels — tint/scale/alpha
 * only. Layer A is a no-op for these; Layer B applies the effect via
 * sprite.filters / sprite.scale / sprite.alpha so the original texture
 * (including mutation overlays) renders unchanged underneath.
 */
export function isLiveOverlayRule(rule: TextureOverrideRule): boolean {
  if (rule.source.librarySpriteKey || rule.source.uploadAssetId) return false;
  if (rule.cosmeticMutations?.length) return false;
  return true;
}

/**
 * Build (or reuse) a per-sprite overlay child sprite that draws the parent's
 * texture again, tinted to the rule's colour at the rule's alpha. Because
 * the overlay shares the parent's texture, its visible pixels exactly mask
 * to the parent's shape — alpha-blended tint with mutation overlays showing
 * through, no shader needed. Returns null when the runtime can't construct a
 * Sprite (extremely unlikely; falls back to sprite.tint multiply).
 */
export function getOrCreateSpriteOverlay(sprite: any, rule: TextureOverrideRule): any | null {
  const Sprite = getBasePixiSpriteCtor(sprite);
  if (!Sprite) return null;
  if (!rule.params.tintColor) return null;
  if (!sprite?.texture) return null;

  let overlay = ctx.layerBOverlaySprites.get(sprite);
  if (overlay) {
    // Reattach if the game tore down the child for any reason.
    if (overlay.parent !== sprite) {
      try { sprite.addChild?.(overlay); } catch { /* parent may be gone */ }
    }
    // Keep the overlay's texture aligned with the parent (in case the game
    // swapped textures during a growth-stage transition).
    if (overlay.texture !== sprite.texture) {
      overlay.texture = sprite.texture;
    }
  } else {
    try {
      overlay = new Sprite(sprite.texture);
      // Marker: lets `applyAllLayerB`'s walker callback skip our own overlay
      // sprites. Without this, the walker's `for...of` over live `children`
      // visits the just-added overlay, matches it via the same rule (overlay
      // shares the parent's texture/hints), spawns ANOTHER overlay inside it,
      // and recurses to MAX_WALK_DEPTH — producing 13–17× match inflation per
      // matched sprite (24 crops → 319 hintId matches in the field log).
      (overlay as { __qpmOverlay?: true }).__qpmOverlay = true;
      if (overlay.anchor && sprite.anchor) {
        // copyFrom is the PIXI v8 method; fall back to manual copy if missing.
        if (typeof overlay.anchor.copyFrom === 'function') {
          overlay.anchor.copyFrom(sprite.anchor);
        } else {
          overlay.anchor.set?.(sprite.anchor.x ?? 0, sprite.anchor.y ?? 0);
        }
      }
      sprite.addChild?.(overlay);
      ctx.layerBOverlaySprites.set(sprite, overlay);
    } catch (e) {
      log('Failed to create overlay child sprite', e);
      return null;
    }
  }

  const colorInt = hexToPixiTint(rule.params.tintColor);
  const strength = Math.max(0, Math.min(1, rule.params.tintAlpha ?? 0.5));
  try { overlay.tint = colorInt; } catch {}
  try { overlay.alpha = strength; } catch {}
  return overlay;
}

/** Remove and destroy this sprite's overlay child sprite, if any. */
export function destroySpriteOverlay(sprite: any): void {
  const overlay = ctx.layerBOverlaySprites.get(sprite);
  if (!overlay) return;
  try {
    if (overlay.parent && typeof overlay.parent.removeChild === 'function') {
      overlay.parent.removeChild(overlay);
    }
    overlay.destroy?.({ children: false, texture: false, baseTexture: false });
  } catch {}
  ctx.layerBOverlaySprites.delete(sprite);
}

/**
 * Tear down all overlay children for sprites currently tracked by Layer B.
 * Called on rule deletion: any sprite that had this rule's overlay is
 * cleaned up. (Only one tint rule applies per sprite in the current UX, so
 * we don't need per-rule tagging.)
 */
export function destroyAllSpriteOverlays(): void {
  for (const sprite of ctx.layerBModified) {
    destroySpriteOverlay(sprite);
  }
}
