import { groundFootprint } from '../math/camera';
import type { Fog, Pass } from '../frame/frame';
import type { DetailPreset } from '../settings';
import type { Caps } from '../types';

// Detail distance: the game's cull box reaches `end` (pets, avatars and tile objects update and animate inside it).
// There is no visual fog any more (user decision 2026-10-03): QPM draws the whole map, so `start` is unused and a pet
// or avatar past `end` is hidden by the game itself.
export const DETAIL_FOG: Readonly<Record<DetailPreset, Fog>> = {
  near: { start: 3000, end: 4600 },
  medium: { start: 4300, end: 6600 },
  far: { start: 5500, end: 8500 },
};

export function applyDetail(fog: Fog, preset: DetailPreset): void {
  fog.start = DETAIL_FOG[preset].start;
  fog.end = DETAIL_FOG[preset].end;
}

interface Viewport { minTileX: number; minTileY: number; maxTileX: number; maxTileY: number }
interface FrameContextLike { viewport: Viewport }

// The game culls pets (setViewportVisible), avatars (isInViewport) and tiles against its frame context's `viewport`;
// at max zoom it is 5×4 tiles, so pets/avatars blink in 3D. The game assigns a NEW viewport object whenever its camera
// centre or scale changes (QuinoaCanvas frame update, live 2026-10-03), so while 3D is live the context's `viewport`
// property reads the 3D ground footprint and the game's assignments land in a shadow that is put back on exit.
export function createViewportPass(caps: Caps, fog: Fog): Pass {
  const pet = caps.systems.petSystem as unknown as Record<string, unknown>;
  const { cols, rows } = caps.systems.map;
  const wide: Viewport = { minTileX: 0, minTileY: 0, maxTileX: 0, maxTileY: 0 };
  let frameCtx: FrameContextLike | null = null;
  let gameVp: Viewport | null = null;
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
    Object.defineProperty(frameCtx, 'viewport', { configurable: true, enumerable: true, get: () => wide, set: (v: Viewport) => { gameVp = v; } });
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

  const clamp = (v: number, hi: number): number => Math.max(0, Math.min(hi, v));

  return {
    name: 'viewport',
    pre(ctx) {
      capture();
      const f = groundFootprint(ctx.basis, ctx.W, ctx.H, fog.end);
      wide.minTileX = clamp(Math.floor(f.x0 / 256) - 1, cols - 1);
      wide.maxTileX = clamp(Math.ceil(f.x1 / 256) + 1, cols - 1);
      wide.minTileY = clamp(Math.floor(f.y0 / 256) - 1, rows - 1);
      wide.maxTileY = clamp(Math.ceil(f.y1 / 256) + 1, rows - 1);
      install();
    },
    drop() { uninstall(); release(); },
    destroy() { uninstall(); release(); frameCtx = null; },
    stats: () => ({ captured: frameCtx !== null, installed, tiles: (wide.maxTileX - wide.minTileX + 1) * (wide.maxTileY - wide.minTileY + 1) }),
  };
}
