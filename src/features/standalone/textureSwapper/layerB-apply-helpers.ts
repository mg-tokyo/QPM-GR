import type { RuleEntry } from './layerB-prepare';

/**
 * Detect PIXI sprite classes whose texture is NOT rendered as a single
 * atlas region: NineSliceSprite tiles a texture in nine pieces and
 * TilingSprite tiles it across its bounds. Swapping their texture to a
 * rule's customTex produces tiled garbage — the visible bug here was an
 * inventory slot's NineSliceSprite background matched via Strategy 6's
 * `(Daisy)` ancestor-label hint and ended up 9-slice-tiling the Daisy
 * rainbow bake across a 224×224 panel.
 *
 * Detection is duck-typed against PIXI v8's NineSlice / TilingSprite props
 * so it survives constructor-name minification. We DON'T block direct
 * sprite-key matches (Strategy 1) — if the user explicitly targets a UI
 * atlas key the game uses on a 9-slice, the swap is still their choice.
 * This gate only suppresses *hint-based* matches (Strategy 6 / 7), which
 * are the broad ancestor-walk paths that misfire on shared parent labels.
 */
export function isNineSliceOrTiledSprite(sprite: any): boolean {
  if (!sprite) return false;
  // NineSliceSprite: four border-width props PIXI v8 owns directly.
  const hasNineSliceProps =
    typeof sprite.leftWidth === 'number'
    && typeof sprite.rightWidth === 'number'
    && typeof sprite.topHeight === 'number'
    && typeof sprite.bottomHeight === 'number';
  if (hasNineSliceProps) return true;
  // TilingSprite: tileScale + tilePosition + tileTransform PIXI v8 owns.
  const hasTilingProps =
    sprite.tileScale != null
    && sprite.tilePosition != null
    && sprite.tileTransform != null;
  if (hasTilingProps) return true;
  return false;
}

/**
 * Asset-family helper (2026-06-27 Phase C). Returns the ORIGINAL-CASE atlas
 * key for the first family variant whose lowercase form appears in the
 * sprite's lowercase key set — or null when the sprite matched the rule's
 * base (or via a non-family strategy). Lowercase form is used for the
 * intersection because extractTextureSpriteKeys lowercases everything for
 * case-insensitive matching; the original-case value is what gets passed
 * back into svc.renderToCanvas, where atlas IDs are case-sensitive.
 *
 * O(1) per spriteKey thanks to the Map.get lookup; iterates the smaller
 * side of the comparison.
 */
export function findMatchedFamilyVariantKey(
  spriteKeys: Set<string>,
  familyVariantKeyByLower: Map<string, string>,
): string | null {
  if (familyVariantKeyByLower.size === 0) return null;
  if (spriteKeys.size <= familyVariantKeyByLower.size) {
    for (const key of spriteKeys) {
      const original = familyVariantKeyByLower.get(key);
      if (original) return original;
    }
    return null;
  }
  for (const [low, original] of familyVariantKeyByLower) {
    if (spriteKeys.has(low)) return original;
  }
  return null;
}

/**
 * For plant/crop leaf sprites, find the ancestor container that should
 * receive scale instead so children (crops under plant, mutation icons
 * under crop) transform together.
 *
 * Hierarchy (confirmed via live probe):
 *   PlantBody → PlantBodyBase (plant tex) + slot-N → CropVisual → Sprite (crop tex)
 *
 * - Plant rules → scale PlantBody (contains plant sprite + all crop slots)
 * - Crop rules  → scale CropVisual (contains crop sprite + mutation icons)
 */
export function findScaleContainer(sprite: unknown, entry: RuleEntry): unknown | null {
  const id = entry.targetIdLower;
  const isPlant = id.endsWith('plant') || id.endsWith('tallplant');
  const isCrop = id.endsWith('crop');
  if (!isPlant && !isCrop) return null;

  let cur = (sprite as { parent?: unknown })?.parent;
  let depth = 0;
  while (cur && typeof cur === 'object' && depth < 5) {
    const label = typeof (cur as { label?: unknown }).label === 'string'
      ? (cur as { label: string }).label : '';
    if (isPlant && label.endsWith('PlantBody')) return cur;
    if (isCrop && label === 'CropVisual') return cur;
    cur = (cur as { parent?: unknown }).parent;
    depth++;
  }
  return null;
}
