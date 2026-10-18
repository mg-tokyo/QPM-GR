import { TILE } from '../constants';
import { project } from '../math/camera';
import { SORT_Z_SCALE } from '../math/depth';
import type { DrawnEntry } from '../frame/drawn';
import type { FrameCtx, Pass } from '../frame/frame';
import type { Node3 } from '../types';

// Game 1634 draws night lights (fireflies, ghost sparkles, torch glows) and pet thought bubbles in layers outside Camera
// that its day/night system moves with the 2D camera each frame. In 3D Camera is the identity and World is drawn in
// screen space, so each mirror is too, and its content is placed where 3D draws the thing it belongs to. They still
// draw over the night-graded scene, as in 2D.
const MAX_DEPTH = 2;

/** The tile-centre row a floating 2D point (a glow over its decor, a firefly over its tile) stands over: the next one at
 * or below it. */
export const standRowOf = (y: number): number => (Math.ceil(y / TILE - 0.5) + 0.5) * TILE;

/** The billboard drawn this frame at exactly 2D (x, y): a thought bubble's anchor copies its pet's position. */
function ownerAt(ctx: FrameCtx, x: number, y: number): DrawnEntry | null {
  const t = ctx.drawn, es = t.entries;
  for (let i = 0; i < t.len; i++) { const e = es[i]!; if (e.x === x && e.y === y) return e; }
  return null;
}

export function createNightMirrors(mirrors: readonly Node3[] | null): Pass {
  let placed = 0, owned = 0, hidden = 0;

  const put = (ctx: FrameCtx, n: Node3, px: number, py: number, mm: number): void => {
    ctx.saves.save(n);
    n.position.set(px, py);
    n.scale.set(n.scale.x * mm, n.scale.y * mm);
    placed++;
  };
  const hide = (ctx: FrameCtx, n: Node3): void => { ctx.saves.save(n); n.scale.set(0, 0); hidden++; };

  function place(ctx: FrameCtx, n: Node3): void {
    const x = n.x, y = n.y;
    // Only a node carrying a depth key (a bubble anchor: its pet's) has an owner in World.
    if (ctx.ov.gameValue<number>('zIndex', n) >= SORT_Z_SCALE) {
      const e = ownerAt(ctx, x, y);
      if (!e || !(e.mm > 0)) { hide(ctx, n); return; }
      put(ctx, n, e.px, e.py, e.mm);
      owned++;
      if (ctx.exactKeys) ctx.ov.drop('zIndex', n); else ctx.ov.put('zIndex', n, e.mm);
      return;
    }
    // Billboard art-row rule (entities.ts placeBillboard): row y drawn (g − y) above ground row g, exact straight down.
    const g = standRowOf(y), o = ctx.out;
    project(ctx.basis, x, 0, g, o);
    const cz = o[2]!;
    if (!(cz >= ctx.params.near)) { hide(ctx, n); return; }
    const mm = ctx.basis.fpx / cz;
    put(ctx, n, o[0]!, o[1]! - (g - y) * mm, mm);
  }

  function walk(ctx: FrameCtx, parent: Node3, depth: number): void {
    for (const c of parent.children) {
      if (!c.visible) continue;
      if (c.x === 0 && c.y === 0 && !c.texture) { if (depth < MAX_DEPTH) walk(ctx, c, depth + 1); continue; }
      place(ctx, c);
    }
  }

  return {
    name: 'nightMirrors',
    pre(ctx) {
      placed = 0; owned = 0; hidden = 0;
      if (!mirrors) return;
      for (const m of mirrors) {
        if (m.destroyed || !m.visible) continue;
        // As the Camera (frame.ts): its 2D transform comes back in post.
        ctx.saves.save(m);
        m.pivot.set(0, 0); m.skew.set(0, 0); m.rotation = 0; m.scale.set(1, 1); m.position.set(0, 0);
        walk(ctx, m, 1);
      }
    },
    drop() { /* per-frame saves only; the zIndex overrides go with ov.dropAll */ },
    destroy() { /* nothing owned */ },
    stats: () => ({ mirrors: mirrors?.length ?? 0, placed, owned, hidden }),
  };
}
