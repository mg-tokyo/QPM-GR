import type { TowerId, UpgradeTier } from '../types';
import type { SpriteRef } from '../data/towerDefs';
import { getTierSlotSprite, resolveUpgradeSlot } from '../data/tierSlots';
import { getTextureAnchor } from '../../../sprite-v2/compat';

export function resolveTowerSprite(kind: TowerId, upgradesA: number, upgradesB: number): SpriteRef {
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
