import { project, type Basis } from '../math/camera';
import { SKY_Z } from '../math/depth';
import type { FrameCtx, Pass } from '../frame/frame';
import type { MoonSystemLike, Node3 } from '../types';
import type { SkyAngle } from './horizon';

type Draw = MoonSystemLike['draw'];

/** Screen point and art scale of a sky-band row drawn on the ring due north (yaw 0 = −y, the band's own side); null when
 * it is behind the camera. */
export function skyPoint(b: Basis, a: SkyAngle, out: number[]): boolean {
  const dy = Math.sin(a.el), dz = -Math.cos(a.el);
  const dF = dy * b.F[1] + dz * b.F[2];
  if (!(dF > 1e-3)) return false;
  out[0] = b.cx0 + (b.fpx * (dz * b.R[2])) / dF;
  out[1] = b.cy0 - (b.fpx * (dy * b.U[1] + dz * b.U[2])) / dF;
  out[2] = (b.fpx * a.radPerPx) / dF;
  return true;
}

// The game shows its moon only while its own (2D) viewport holds row 4.5 at the top of the map (live 1634). Tilted, the
// sky is in view from anywhere: the moon system draws against the whole map, so the game still decides when it shows,
// its phase shadow, tint and blend, and the moon is laid on the sky ring due north at its sky-band row.
export function createMoon(sys: MoonSystemLike | null, skip: WeakSet<Node3>, map: { cols: number; rows: number }, skyAngle: (y: number) => SkyAngle | null): Pass {
  const whole = { minTileX: 0, minTileY: 0, maxTileX: map.cols - 1, maxTileY: map.rows - 1 };
  if (sys) skip.add(sys.container);
  let orig: Draw | null = null, wrap: Draw | null = null, own = false;
  let wide = false, shown = false;
  const pt = [0, 0, 0];

  function hook(s: MoonSystemLike): void {
    if (wrap) return;
    const o = s.draw;
    own = Object.prototype.hasOwnProperty.call(s, 'draw');
    const w: Draw = function (this: unknown, c: unknown): unknown {
      return o.call(this, wide && c && typeof c === 'object' ? Object.create(c, { viewport: { value: whole } }) : c);
    };
    orig = o; wrap = w;
    s.draw = w;
  }
  function unhook(): void {
    wide = false;
    if (!sys || !wrap) return;
    if (sys.draw === wrap) {
      if (own) sys.draw = orig!;
      else delete (sys as { draw?: Draw }).draw;
    }
    wrap = null; orig = null;
  }

  function place(ctx: FrameCtx, c: Node3): boolean {
    ctx.saves.save(c);
    if (ctx.exactKeys) {
      // Straight down is the 2D view: a billboard on its own row is exact.
      project(ctx.basis, c.x, 0, c.y, pt);
      if (!(pt[2]! >= ctx.params.near)) { c.scale.set(0, 0); return false; }
      const mm = ctx.basis.fpx / pt[2]!;
      c.position.set(pt[0]!, pt[1]!);
      c.scale.set(c.scale.x * mm, c.scale.y * mm);
      ctx.ov.drop('zIndex', c);
      return true;
    }
    const a = skyAngle(c.y);
    if (!a || !skyPoint(ctx.basis, a, pt)) { c.scale.set(0, 0); return false; }
    c.position.set(pt[0]!, pt[1]!);
    c.scale.set(c.scale.x * pt[2]!, c.scale.y * pt[2]!);
    ctx.ov.put('zIndex', c, SKY_Z);
    return true;
  }

  return {
    name: 'moon',
    pre(ctx) {
      shown = false;
      if (!sys) return;
      hook(sys);
      // Read by the game's next draw (before the next render).
      wide = !ctx.exactKeys;
      const c = sys.container;
      if (c.destroyed || !c.visible) return;
      shown = place(ctx, c);
    },
    drop: unhook,
    destroy: unhook,
    stats: () => ({ moon: sys !== null, moonShown: shown, wide }),
  };
}
