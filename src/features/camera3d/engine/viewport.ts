import { TILE } from '../constants';
import { groundFootprint } from '../math/camera';
import type { DetailRadius, Pass } from '../frame/frame';
import type { DetailPreset } from '../settings';
import type { Caps } from '../types';

// The Detail setting ("Pets & players distance", P12): the game's cull box reaches this far (pets, avatars and tile
// objects update and animate inside it). QPM draws the whole map; a pet or avatar past it is hidden by the game itself.
export const DETAIL_RADIUS: Readonly<Record<DetailPreset, number>> = { closest: 2600, near: 4600, medium: 6600, far: 8500 };

export function applyDetail(r: DetailRadius, preset: DetailPreset): void {
  r.px = DETAIL_RADIUS[preset];
}

export interface TileWindow { minTileX: number; minTileY: number; maxTileX: number; maxTileY: number }
interface FrameContextLike { viewport: TileWindow }

const clamp = (v: number, hi: number): number => Math.max(0, Math.min(hi, v));

/** The map tiles under a ground footprint (world px) plus one each side, clamped to the map, into `out`. */
export function tileWindow(f: { x0: number; y0: number; x1: number; y1: number }, cols: number, rows: number, out: TileWindow): TileWindow {
  out.minTileX = clamp(Math.floor(f.x0 / TILE) - 1, cols - 1);
  out.maxTileX = clamp(Math.ceil(f.x1 / TILE) + 1, cols - 1);
  out.minTileY = clamp(Math.floor(f.y0 / TILE) - 1, rows - 1);
  out.maxTileY = clamp(Math.ceil(f.y1 / TILE) + 1, rows - 1);
  return out;
}

// The game culls pets (setViewportVisible), avatars (isInViewport) and tiles against its frame context's `viewport`;
// at max zoom it is 5×4 tiles, so pets/avatars blink in 3D. The game assigns a NEW viewport object whenever its camera
// centre or scale changes (QuinoaCanvas frame update, live 2026-10-03), so while 3D is live the context's `viewport`
// property reads the 3D ground footprint and the game's assignments land in a shadow that is put back on exit.
export function createViewportPass(caps: Caps, detail: DetailRadius): Pass {
  const pet = caps.systems.petSystem as unknown as Record<string, unknown>;
  const { cols, rows } = caps.systems.map;
  const wide: TileWindow = { minTileX: 0, minTileY: 0, maxTileX: 0, maxTileY: 0 };
  let frameCtx: FrameContextLike | null = null;
  let gameVp: TileWindow | null = null;
  let capturing = false;
  let ownPre = false;
  let origPre: unknown = null;
  let installed = false;

  function release(): void {
    if (!capturing) return;
    capturing = false;
    if (ownPre) pet.preDraw = origPre;
    else delete pet.preDraw;
  }

  function capture(): void {
    if (frameCtx || capturing) return;
    capturing = true;
    ownPre = Object.prototype.hasOwnProperty.call(pet, 'preDraw');
    origPre = pet.preDraw;
    pet.preDraw = function (this: unknown, ...a: unknown[]): unknown {
      const c = a[0] as Partial<FrameContextLike> | null | undefined;
      if (!frameCtx && c && typeof c === 'object' && c.viewport) { frameCtx = c as FrameContextLike; release(); }
      return (origPre as (...x: unknown[]) => unknown).apply(this, a);
    };
  }

  function install(): void {
    if (!frameCtx || installed) return;
    gameVp = frameCtx.viewport;
    Object.defineProperty(frameCtx, 'viewport', { configurable: true, enumerable: true, get: () => wide, set: (v: TileWindow) => { gameVp = v; } });
    installed = true;
  }

  function uninstall(): void {
    if (!frameCtx || !installed) return;
    const c = frameCtx as unknown as Record<string, unknown>;
    delete c.viewport;
    c.viewport = gameVp;
    gameVp = null;
    installed = false;
  }

  return {
    name: 'viewport',
    pre(ctx) {
      capture();
      tileWindow(groundFootprint(ctx.basis, ctx.W, ctx.H, detail.px), cols, rows, wide);
      install();
    },
    drop() { uninstall(); release(); },
    destroy() { uninstall(); release(); frameCtx = null; },
    stats: () => ({ captured: frameCtx !== null, installed, tiles: (wide.maxTileX - wide.minTileX + 1) * (wide.maxTileY - wide.minTileY + 1) }),
  };
}
