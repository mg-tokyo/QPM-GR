/** World px per map tile, the game's tile frame. checkTileLayout (scene/tileArt.ts) checks it against the tilemap. */
export const TILE = 256;

// The fixed cull margins from before perf Task 5, still used past the per-frame ring (frame.ts mayBeSeen): sides × W,
// bands past the screen's bottom (billboards; their top band is side × H) and top/bottom (tile-art cards, walls).
export const LEGACY_CULL = { side: 0.75, below: 1200, art: { above: 200, below: 1600 } } as const;
