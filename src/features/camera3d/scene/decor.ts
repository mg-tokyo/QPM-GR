import { project } from '../math/camera';
import { GROUND_DECOR_Z, depthKey } from '../math/depth';
import { nearCamera, recheck, type FrameCtx, type Pass } from '../frame/frame';
import type { Caps, Node3 } from '../types';
import type { Fader } from './fades';
import { artBaseRow, subTexture, type TileScan } from './tileArt';

interface Decor { s: Node3; fx: number; fy: number; flip: number; fence: boolean }

export function createDecor(caps: Caps, skip: WeakSet<Node3>, fader: Fader, getScan: () => TileScan): Pass & { setFenceFade(t: number): void } {
  const { scene: s, classes: C } = caps;
  let items: Decor[] = [];
  let builtFor: TileScan | null = null;
  let fenceFade = 0; // the fence walls' fade-in (0..1); fence cards cross-fade out against it
  let attached = false;

  // Detached while 2D: hidden World children still cost the game's World zIndex sort (live: 0.18 ms per sort).
  function attach(on: boolean): void {
    if (attached === on) return;
    attached = on;
    for (const d of items) { if (on) s.world.addChild(d.s); else s.world.removeChild(d.s); }
  }

  function build(): void {
    attach(false);
    for (const d of items) d.s.destroy();
    items = [];
    const scan = getScan();
    builtFor = scan;
    const pb = scan.pb;
    for (const o of scan.standing) {
      const key = scan.keyAt.get(o);
      if (!key) continue;
      const w = pb[o + 4]!, h = artBaseRow(caps, key, w, pb[o + 5]!);
      const tex = subTexture(caps, key, 0, 0, w, h);
      if (!tex) continue;
      const sp = new C.Sprite(tex);
      sp.anchor?.set(0.5, 1);
      sp.label = 'qpm3d-decor';
      sp.visible = false;
      sp.eventMode = 'none';
      skip.add(sp);
      items.push({ s: sp, fx: pb[o + 2]! + w / 2, fy: pb[o + 3]! + h, flip: pb[o + 6] === 12 ? -1 : 1, fence: scan.fence.has(o) });
    }
  }

  return {
    name: 'decor',
    setFenceFade(t) { fenceFade = t; },
    pre(ctx: FrameCtx) {
      if (builtFor !== getScan()) build();
      attach(true);
      const b = ctx.basis, out = ctx.out;
      for (let i = 0; i < items.length; i++) {
        const d = items[i]!;
        const isFence = d.fence;
        // A hidden card can only reappear when it is re-checked (fence cards: every frame, they follow the wall fade).
        const check = recheck(ctx, i);
        if (!check && !isFence && !d.s.visible) continue;
        project(b, d.fx, 0, d.fy, out);
        const sx = out[0]!, sy = out[1]!, cz = out[2]!;
        const vis = (nearCamera(ctx, d.fx, d.fy) || !(cz < ctx.params.near || cz > ctx.params.far || sx < -ctx.marginX || sx > ctx.W + ctx.marginX || sy < -200 || sy > ctx.H + 1600)) && (!isFence || fenceFade < 1);
        if ((check || isFence) && d.s.visible !== vis) d.s.visible = vis;
        if (!d.s.visible) continue;
        // Visibility holds between re-checks; a card that crossed the near plane since then is parked, not flipped.
        if (cz < ctx.params.near) { d.s.scale.set(0, 0); continue; }
        const mm = b.fpx / cz;
        d.s.position.set(sx, sy);
        d.s.scale.set(d.flip * mm, mm);
        // Straight down this tile art is Ground in 2D: under World's markers and weather scrim (s = 0 in rain/frost).
        const key = ctx.exactKeys ? GROUND_DECOR_Z + d.fy : depthKey(d.fx, d.fy, ctx.dx, ctx.dz, 0);
        if (d.s.zIndex !== key) d.s.zIndex = key;
        const a = fader.factor(ctx, d.s, key, d.fx, d.fy) * (isFence ? 1 - fenceFade : 1);
        if (d.s.alpha !== a) d.s.alpha = a;
      }
    },
    drop() { for (const d of items) if (d.s.visible) d.s.visible = false; attach(false); },
    destroy() { attach(false); for (const d of items) d.s.destroy(); items = []; builtFor = null; },
    stats: () => ({ decor: items.length }),
  };
}
