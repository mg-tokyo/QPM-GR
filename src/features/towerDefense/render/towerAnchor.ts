import type { TowerId, UpgradeTier } from '../types';
import type { SpriteRef } from '../data/towerDefs';
import { getTowerDef } from '../data/towerDefs';
import { getTierSlotSprite, resolveUpgradeSlot } from '../data/tierSlots';
import { getTextureAnchor } from '../../../sprite-v2/compat';

// spriteByTier overrides the slot pipeline. Ties (a === b) favor A; walk the
// primary path down from current tier to 1, then the other path, then fall
// through to the slot system. Lets defs supply partial maps without holes.
function resolveFromSpriteByTier(kind: TowerId, upgradesA: number, upgradesB: number): SpriteRef | null {
  const def = getTowerDef(kind);
  const map = def.spriteByTier;
  if (!map) return null;
  const primary: 'a' | 'b' = upgradesA >= upgradesB ? 'a' : 'b';
  const other: 'a' | 'b' = primary === 'a' ? 'b' : 'a';
  const primaryTier = primary === 'a' ? upgradesA : upgradesB;
  const otherTier = other === 'a' ? upgradesA : upgradesB;
  for (let tier = primaryTier; tier >= 1; tier--) {
    const s = (primary === 'a' ? map.pathA : map.pathB)?.[tier as UpgradeTier];
    if (s) return s;
  }
  for (let tier = otherTier; tier >= 1; tier--) {
    const s = (other === 'a' ? map.pathA : map.pathB)?.[tier as UpgradeTier];
    if (s) return s;
  }
  return null;
}

export function resolveTowerSprite(kind: TowerId, upgradesA: number, upgradesB: number): SpriteRef {
  const tierSprite = resolveFromSpriteByTier(kind, upgradesA, upgradesB);
  if (tierSprite) return tierSprite;
  return getTierSlotSprite(kind, resolveUpgradeSlot(upgradesA as UpgradeTier, upgradesB as UpgradeTier));
}

// Per-tower-kind sprite anchor. The game reads defaultAnchor from the atlas
// for each texture; we mirror that per baseSprite.kind:
//   - 'plant': stitched canvas centers bbox, so anchor (0.5, 1.0) puts the
//     canvas bottom at tile-center — the plant reads as growing out of the tile.
//   - 'decor': prefer the atlas defaultAnchor (getTextureAnchor). Falls back
//     to (0.5, 1.0) for ground-standing decor when the atlas has no pivot.
export function resolveSpriteRefAnchor(sprite: SpriteRef): { x: number; y: number } {
  if (sprite.kind === 'decor') {
    const a = getTextureAnchor(sprite.key);
    if (a) return a;
  }
  return { x: 0.5, y: 1.0 };
}

export function resolveTowerAnchor(kind: TowerId, upgradesA: number, upgradesB: number): { x: number; y: number } {
  return resolveSpriteRefAnchor(resolveTowerSprite(kind, upgradesA, upgradesB));
}

// The mgscene sprite key a design slot must carry to count as "the vanilla base
// sprite" for this tower/tier — used to pin custom designs on the vanilla anchor.
export function spriteRefToSceneKey(sprite: SpriteRef): string {
  return sprite.kind === 'decor' ? sprite.key : `sprite/plant/${sprite.key}`;
}
