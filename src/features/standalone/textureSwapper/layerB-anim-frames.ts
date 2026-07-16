// PIXI AnimatedSprite stores per-frame textures internally and overwrites
// sprite.texture on every animation tick. A one-shot sprite.texture = X is
// clobbered within 16ms. To persist a texture swap we must replace every
// entry in the frames array. Restore path reverses the replacement.

/**
 * Save the original per-frame textures from a PIXI AnimatedSprite.
 * Returns null for non-animated sprites (no `.textures` array).
 */
export function snapshotAnimFrameTextures(sprite: any): any[] | null {
  const textures = sprite?.textures;
  if (!Array.isArray(textures) || textures.length <= 1) return null;
  return textures.map((f: any) =>
    f && typeof f === 'object' && 'texture' in f
      ? { texture: f.texture, time: f.time }
      : f,
  );
}

/**
 * Replace every frame in an AnimatedSprite's internal textures array
 * with `tex` so the swap persists through animation cycles. Handles
 * both FrameObject format (`{ texture, time }`) and plain Texture[].
 */
export function replaceAnimFrameTextures(sprite: any, tex: any): void {
  const textures = sprite?.textures;
  if (!Array.isArray(textures) || textures.length <= 1) return;
  for (let i = 0; i < textures.length; i++) {
    if (textures[i] && typeof textures[i] === 'object' && 'texture' in textures[i]) {
      textures[i].texture = tex;
    } else {
      textures[i] = tex;
    }
  }
}

/**
 * Restore an AnimatedSprite's frame textures from a snapshot taken at
 * Layer B snapshot time.
 */
export function restoreAnimFrameTextures(sprite: any, saved: any[]): void {
  const textures = sprite?.textures;
  if (!Array.isArray(textures)) return;
  for (let i = 0; i < saved.length && i < textures.length; i++) {
    const s = saved[i];
    if (s && typeof s === 'object' && 'texture' in s && textures[i] && typeof textures[i] === 'object' && 'texture' in textures[i]) {
      textures[i].texture = s.texture;
    } else {
      textures[i] = s;
    }
  }
}
