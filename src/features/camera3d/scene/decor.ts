import { LEGACY_CULL } from '../constants';
import { project } from '../math/camera';
import { GROUND_DECOR_Z, depthKey } from '../math/depth';
import { legacyShow, mayShow } from '../frame/cull';
import { mayBeSeen, nearCamera, recheck, ringDue, type FrameCtx, type Pass } from '../frame/frame';
import type { Caps, Node3 } from '../types';
import type { Fader } from './fades';
import { FlipGate, rectOnScreen } from './flipGate';
import { D8_MIRROR_H, RECT, artBaseRow, subTexture, type TileScan } from './tileArt';

/** on: in view at its last check; off: the frame it left the view; hw, h: its art's half width and height (world px);
 * placed: drawn in full last frame (not parked, waiting or behind the lens). */
interface Decor { s: Node3; fx: number; fy: number; flip: number; fence: boolean; hw: number; h: number; on: boolean; off: number; placed: boolean }

export function createDecor(caps: Caps, skip: WeakSet<Node3>, fader: Fader, getScan: () => TileScan): Pass & { setFenceFade(t: number): void } {
  const { scene: s, classes: C } = caps;
  const gate = new FlipGate(s.world);
  let items: Decor[] = [];
  let builtFor: TileScan | null = null;
  let fenceFade = 0; // the fence walls' fade-in (0..1); fence cards cross-fade out against it
  let attached = false;
  let parked = 0, pending = 0, kept = 0;
  // The avatar's occlusion inputs last frame (fadeTarget): with them and the camera unchanged, a placed card that is
  // not mid-fade would be written exactly as it is (perf Task 4).
  let occKey: number | null | undefined, occX = 0, occY = 0;

  // Detached while 2D: hidden World children still cost the game's World zIndex sort (live: 0.18 ms per sort).
  function attach(on: boolean): void {
    if (attached === on) return;
    attached = on;
    gate.noteFlip();
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
      const w = pb[o + RECT.W]!, h = artBaseRow(caps, key, w, pb[o + RECT.H]!);
      const tex = subTexture(caps, key, 0, 0, w, h);
      if (!tex) continue;
      const sp = new C.Sprite(tex);
      sp.anchor?.set(0.5, 1);
      sp.label = 'qpm3d-decor';
      sp.visible = false;
      sp.eventMode = 'none';
      skip.add(sp);
      items.push({ s: sp, fx: pb[o + RECT.X]! + w / 2, fy: pb[o + RECT.Y]! + h, flip: pb[o + RECT.ROTATE] === D8_MIRROR_H ? -1 : 1, fence: scan.fence.has(o), hw: w / 2, h, on: false, off: 0, placed: false });
    }
  }

  // Out of view: still drawn, at scale 0, until a frame that rebuilds World anyway hides it (flipGate.ts).
  function park(ctx: FrameCtx, d: Decor): void {
    d.placed = false;
    if (!d.s.visible) return;
    d.s.scale.set(0, 0);
    if (gate.canHide(ctx, ctx.frameNo - d.off)) gate.set(d.s, false);
    else parked++;
  }

  return {
    name: 'decor',
    setFenceFade(t) { fenceFade = t; },
    pre(ctx: FrameCtx) {
      gate.begin(ctx);
      if (builtFor !== getScan()) build();
      attach(true);
      parked = 0; pending = 0; kept = 0;
      const b = ctx.basis, out = ctx.out, near = ctx.params.near;
      const u = ctx.avatarUpper, ux = u ? u.x : NaN, uy = u ? u.y : NaN;
      const still = ctx.camStill && ctx.avatarKey === occKey && Object.is(ux, occX) && Object.is(uy, occY);
      occKey = ctx.avatarKey; occX = ux; occY = uy;
      for (let i = 0; i < items.length; i++) {
        const d = items[i]!;
        // Fence cards are re-checked every frame: they follow the wall fade.
        const check = d.fence || recheck(ctx, i) || ringDue(ctx, d.fx, d.fy);
        if (!check && !d.on) { park(ctx, d); continue; }
        if (still && !check && d.placed && !fader.isFading(ctx, d.s)) { kept++; continue; }
        project(b, d.fx, 0, d.fy, out);
        const sx = out[0]!, sy = out[1]!, cz = out[2]!;
        if (check) {
          // Its art: hw each side of the foot and h above it. A fence card is re-decided every frame, so the screen as
          // the camera may turn it before the next rebuild (cull.ts ahead; ring lever off: the fixed margins of before
          // perf Task 5); the rest until their next re-check.
          const c = ctx.cull;
          const seen = !d.fence ? mayBeSeen(ctx, d.fx, d.fy, sx, sy, cz, d.hw, d.h, 0, 0, true)
            : nearCamera(ctx, d.fx, d.fy) || (c.ring <= 0 ? legacyShow(c, sx, sy, cz, LEGACY_CULL.art.above, LEGACY_CULL.art.below) : mayShow(c, sx, sy, cz, d.hw, d.h, 0, 0, c.ahead));
          const vis = seen && (!d.fence || fenceFade < 1);
          if (vis !== d.on) { d.on = vis; if (!vis) d.off = ctx.frameNo; }
        }
        if (!d.on) { park(ctx, d); continue; }
        // In view until its next check; a card that crossed the near plane since then is parked, not flipped.
        if (cz < near) { d.s.scale.set(0, 0); d.placed = false; continue; }
        const mm = b.fpx / cz;
        if (!d.s.visible) {
          const hw = d.hw * mm;
          if (!gate.canShow(ctx, rectOnScreen(ctx, sx - hw, sy - d.h * mm, sx + hw, sy))) { pending++; d.placed = false; continue; }
          gate.set(d.s, true);
        }
        d.s.position.set(sx, sy);
        d.s.scale.set(d.flip * mm, mm);
        // Straight down this tile art is Ground in 2D: under World's markers and weather scrim (s = 0 in rain/frost).
        const key = ctx.exactKeys ? GROUND_DECOR_Z + d.fy : depthKey(d.fx, d.fy, ctx.dx, ctx.dz, 0);
        if (d.s.zIndex !== key) d.s.zIndex = key;
        const a = fader.factor(ctx, d.s, key, d.fx, d.fy) * (d.fence ? 1 - fenceFade : 1);
        if (d.s.alpha !== a) d.s.alpha = a;
        d.placed = true;
      }
      gate.end();
    },
    warm() { if (builtFor === getScan()) return false; build(); return true; },
    drop() { for (const d of items) { d.on = false; d.placed = false; if (d.s.visible) d.s.visible = false; } occKey = undefined; attach(false); },
    destroy() { attach(false); for (const d of items) d.s.destroy(); items = []; builtFor = null; },
    stats: () => ({ decor: items.length, parked, pending, kept, forced: gate.forced }),
  };
}
