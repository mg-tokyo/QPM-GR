import { pageWindow } from '../../../core/pageContext';
import { getMapSnapshot, type MapSnapshot } from '../../garden/bridge';
import { ctx, MAX_WALK_DEPTH } from './types';

// ---------------------------------------------------------------------------
// PIXI app & scene-graph helpers
//
// Low-level utilities that walk the live PIXI scene graph or probe texture
// state. No knowledge of rules, layers, or scheduling — those concerns live
// in the layerA/layerB modules and depend on this one.
// ---------------------------------------------------------------------------

export function getPixiApp(): any {
  try {
    const captured = (pageWindow as Record<string, unknown>).__QPM_PIXI_CAPTURED__ as
      { app?: unknown } | undefined;
    return (captured?.app) ?? null;
  } catch {
    return null;
  }
}

function isPixiSprite(node: any): boolean {
  if (!node || typeof node !== 'object') return false;
  const tex = node.texture;
  if (!tex || typeof tex !== 'object') return false;
  return (typeof tex.baseTexture === 'object' && tex.baseTexture !== null)
      || (typeof tex.source === 'object' && tex.source !== null);
}

export function walkSpriteTree(node: any, cb: (sprite: any) => void, depth = 0): void {
  if (!node || depth > MAX_WALK_DEPTH) return;
  if (isPixiSprite(node)) cb(node);
  const children = node.children;
  if (Array.isArray(children)) {
    for (const child of children) {
      walkSpriteTree(child, cb, depth + 1);
    }
  }
}

export function isTextureRenderable(tex: any): boolean {
  if (!tex || tex?.destroyed) return false;
  const source = tex?.source ?? tex?.baseTexture ?? tex?._source ?? tex?._baseTexture ?? null;
  if (!source) return false;
  if (source.destroyed) return false;
  if (source.style === null) return false;
  return true;
}

const TILE_LABEL_RE = /^Tile\s*\(\s*(-?\d+)\s*,\s*(-?\d+)\s*\)$/;

/**
 * Build a mapping from dirtTileIdx (sequential 0-199) to PIXI world
 * coordinate key `"x,y"` for the current player's tiles.
 *
 * Uses the map atom's `globalTileIdxToDirtTile` to match each PIXI
 * "Tile (x, y)" container to the correct dirtTileIdx, filtering by
 * `userSlotIdx` so only the current player's tiles are included.
 */
export function buildPlayerTileMap(mySlotIdx: number): Map<string, string> {
  const app = getPixiApp();
  const map = getMapSnapshot();
  if (!app?.stage || !map?.cols) return new Map();

  const result = new Map<string, string>();

  function scan(node: unknown, depth: number): void {
    if (!node || typeof node !== 'object' || depth > 10) return;
    const n = node as Record<string, unknown>;
    if (typeof n.label === 'string') {
      const m = TILE_LABEL_RE.exec(n.label);
      if (m) {
        const x = Number(m[1]);
        const y = Number(m[2]);
        const globalIdx = x + y * (map as MapSnapshot).cols;
        const dirt = (map as MapSnapshot).globalTileIdxToDirtTile?.[globalIdx];
        if (dirt && dirt.userSlotIdx === mySlotIdx) {
          result.set(String(dirt.dirtTileIdx), `${x},${y}`);
        }
        return;
      }
    }
    const children = (n as Record<string, unknown>).children;
    if (Array.isArray(children)) {
      for (const child of children) scan(child, depth + 1);
    }
  }

  scan(app.stage, 0);
  return result;
}

/**
 * Same as buildPlayerTileMap but for boardwalk tiles. Returns a mapping
 * from `boardwalkTileIdx` (sequential 0..N per player) to PIXI world
 * coordinate key `"x,y"`.
 */
export function buildPlayerBoardwalkTileMap(mySlotIdx: number): Map<string, string> {
  const app = getPixiApp();
  const map = getMapSnapshot();
  if (!app?.stage || !map?.cols) return new Map();

  const result = new Map<string, string>();

  function scan(node: unknown, depth: number): void {
    if (!node || typeof node !== 'object' || depth > 10) return;
    const n = node as Record<string, unknown>;
    if (typeof n.label === 'string') {
      const m = TILE_LABEL_RE.exec(n.label);
      if (m) {
        const x = Number(m[1]);
        const y = Number(m[2]);
        const globalIdx = x + y * (map as MapSnapshot).cols;
        const bw = (map as MapSnapshot).globalTileIdxToBoardwalk?.[globalIdx];
        if (bw && bw.userSlotIdx === mySlotIdx) {
          result.set(String(bw.boardwalkTileIdx), `${x},${y}`);
        }
        return;
      }
    }
    const children = (n as Record<string, unknown>).children;
    if (Array.isArray(children)) {
      for (const child of children) scan(child, depth + 1);
    }
  }

  scan(app.stage, 0);
  return result;
}

export function getFallbackTexture(): any | null {
  const fromSvc = ctx.currentSvc?.state?.ctors?.Texture?.EMPTY ?? null;
  if (isTextureRenderable(fromSvc)) return fromSvc;
  const fromPage = (pageWindow as any)?.PIXI?.Texture?.EMPTY ?? (pageWindow as any)?.__PIXI__?.Texture?.EMPTY ?? null;
  if (isTextureRenderable(fromPage)) return fromPage;
  return null;
}
