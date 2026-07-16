// src/features/standalone/textureSwapper/rive/mutation-badges.ts
// Phase 5 — Mutation badge icons on Rive decor. Extracted from riveAdapter.ts
// during PR #1.
//
// Mirrors src/sprite-v2/renderer.ts:540-557 iconPipeline + iconLayout calc.
// Position the badge as a child sprite anchored at the Rive sprite's
// (basePos + iconLayout.offset). Texture loaded from svc.state.tex by the
// canonical mutation ui sprite-key from mutationColors.getMutationIconSpriteKey.

import { ctx, log, warnFeature } from '../types';
import { getMutationIconSpriteKey } from '../mutationColors';
import { getBasePixiSpriteCtor } from './detection';
import { badgesBySprite, activeRiveSprites } from './state';

/**
 * Compute the badge icon position within the Rive sprite's bounds, mirroring
 * iconLayout from src/sprite-v2/renderer.ts:411-462. For Rive decor we
 * simplify: anchor center horizontally at the sprite anchor, place the badge
 * at 30% from the top vertically.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function computeBadgePosition(sprite: any): { x: number; y: number; scale: number } {
  const w = sprite.texture?.frame?.width ?? sprite.texture?.orig?.width ?? 100;
  const h = sprite.texture?.frame?.height ?? sprite.texture?.orig?.height ?? 100;
  const anchorX = sprite.anchor?.x ?? 0.5;
  const anchorY = sprite.anchor?.y ?? 0.5;
  // basePos = anchor in local-pixel coords.
  const basePosX = w * anchorX;
  const basePosY = h * anchorY;
  // Place icon at upper-right of the body relative to anchor.
  const offsetX = w * 0.15;
  const offsetY = -h * 0.4; // above the anchor
  return {
    x: basePosX + offsetX,
    y: basePosY + offsetY,
    scale: Math.min(0.4, Math.min(w, h) / 100), // size relative to sprite footprint
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function applyRiveMutationBadge(sprite: any, mutationName: string, ruleId: string): void {
  const iconKey = getMutationIconSpriteKey(mutationName);
  if (!iconKey) return; // Gold/Rainbow have no badge
  const Sprite = getBasePixiSpriteCtor(sprite);
  if (!Sprite) return;
  const iconTex = ctx.currentSvc?.state.tex.get(iconKey);
  if (!iconTex) {
    log(`applyRiveMutationBadge: no texture for ${iconKey}`);
    return;
  }

  const badgeKey = `${ruleId}|${mutationName}`;
  let byBadge = badgesBySprite.get(sprite as object);
  if (!byBadge) {
    byBadge = new Map();
    badgesBySprite.set(sprite as object, byBadge);
  }

  let badge = byBadge.get(badgeKey);
  const pos = computeBadgePosition(sprite);

  if (!badge) {
    try {
      badge = new Sprite(iconTex);
      (badge as { __qpmOverlay?: true }).__qpmOverlay = true;
      badge.anchor?.set?.(0.5, 0.5);
      badge.scale?.set?.(pos.scale, pos.scale);
      badge.position?.set?.(pos.x - (sprite.anchor?.x ?? 0.5) * (sprite.texture?.frame?.width ?? 0),
                            pos.y - (sprite.anchor?.y ?? 0.5) * (sprite.texture?.frame?.height ?? 0));
      sprite.addChild?.(badge);
      byBadge.set(badgeKey, badge);
    } catch (e) {
      log('applyRiveMutationBadge: failed to create badge', e);
      warnFeature('QPM-TEXTURESWAP-001', { what: 'mutationBadge:create' }, e);
      return;
    }
  } else {
    // Update position on each apply in case the Rive sprite was resized.
    badge.scale?.set?.(pos.scale, pos.scale);
  }

  activeRiveSprites.add(sprite);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function clearRiveMutationBadges(sprite: any): void {
  const byBadge = badgesBySprite.get(sprite as object);
  if (!byBadge) return;
  for (const badge of byBadge.values()) {
    try {
      if (badge.parent) badge.parent.removeChild(badge);
      badge.destroy?.({ children: false, texture: false, baseTexture: false });
    } catch { /* ignore */ }
  }
  badgesBySprite.delete(sprite as object);
}
