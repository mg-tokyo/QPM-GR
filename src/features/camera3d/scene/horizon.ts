import type { Pass } from '../frame/frame';
import type { Overrides } from '../frame/overrides';
import type { Caps, Node3, TexLike, UniformGroupLike } from '../types';
import { CAM_RESOURCE } from './camUniforms';
import type { Floor } from './floor';
import { RING_FS, RING_VS, compileNow } from './shaders';
import { hideRects, restoreRects, setTilemapShown, skyStrip, type TileScan } from './tileArt';

const STRIP_RES = 0.5;
const MAX_STRIP_PX = 4096;
// The art row on the horizon sits this far above the sky band's bottom (spike-tuned: row 2384 of 2560, qpm3d-horizon.js).
const RING_N = 8, RING_H0_ABOVE_BOTTOM = 176, RING_BLEND = 160;

interface RingUniforms { uScreen: Float32Array; uRingN: number; uH0: number; uStrip: Float32Array; uBlend: number; uTopColor: Float32Array; uBotColor: Float32Array }

/** cam: the shared camera uniform group (camUniforms.ts). onDrift('horizon'): no sky band once the tile textures
 * resolved (A V8), reported once; the ring stays hidden. */
export function createHorizon(caps: Caps, floor: Floor, getScan: () => TileScan, cam: UniformGroupLike, onDrift: (what: string) => void): Pass {
  const { scene: s, classes: C } = caps;
  const f1 = (v: number) => ({ value: v, type: 'f32' });
  const fv = (len: number, type: string) => ({ value: new Float32Array(len), type });
  const RU: UniformGroupLike = new C.UniformGroup({
    uScreen: fv(2, 'vec2<f32>'),
    uRingN: f1(RING_N), uH0: f1(0), uStrip: fv(2, 'vec2<f32>'), uBlend: f1(RING_BLEND), uTopColor: fv(4, 'vec4<f32>'), uBotColor: fv(4, 'vec4<f32>'),
  });
  const u = RU.uniforms as unknown as RingUniforms;
  const white = C.Texture.WHITE.source;
  const shader = new C.Shader({
    glProgram: new C.GlProgram({ vertex: RING_VS, fragment: RING_FS, name: 'qpm3d-ring' }),
    resources: { [CAM_RESOURCE]: cam, qpm3dRing: RU, uSkyTexture: white, uSkySampler: white.style },
  });
  const geom = new C.Geometry({ attributes: { aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' } }, indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]), topology: 'triangle-list' });
  const ring = new C.Mesh({ geometry: geom, shader, texture: C.Texture.WHITE });
  ring.label = 'qpm3d-ring';
  ring.visible = false;
  const at = s.ground.children.findIndex((c) => c.label === 'qpm3d-ground');
  s.ground.addChildAt(ring, at < 0 ? s.ground.children.length : at);
  let strip: TexLike | null = null;
  let drifted = false;
  let held: { offs: number[]; saved: Float32Array } | null = null;
  // The scan a floor bake hid standing art with. Baked before the tile textures resolved, that art went flat into it
  // (A V7): it rebakes once they resolve. The tilemap itself never changes (live 2026-10-05).
  let floorScan: TileScan | null = null;
  const provisional = (sc: TileScan | null): boolean => sc !== null && sc.len < 0;

  const rowAverage = (px: Uint8Array | Uint8ClampedArray, w: number, y: number): number[] => {
    const c = [0, 0, 0, 0];
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) c[k] = (c[k] ?? 0) + px[(y * w + x) * 4 + k]!;
    return c.map((v) => v / w / 255);
  };

  // The strip is the sky band itself (tileArt.ts skyStrip), so it waits for the tile textures: an entry in the first
  // seconds after load draws no ring until they resolve.
  function bakeStrip(ov: Overrides): boolean {
    if (drifted) return false;
    const scan = getScan();
    if (scan.len < 0) return false;
    const band = skyStrip(s.tileData.pointsBuf, scan.sky, MAX_STRIP_PX / STRIP_RES);
    if (!band) { drifted = true; onDrift('horizon'); return false; }
    const others: Node3[] = s.ground.children.filter((c) => c !== s.tilemap && c.visible);
    const tv = ov.raw<boolean>('visible', s.tilemap);
    setTilemapShown(ov, s.tilemap, true);
    for (const c of others) c.visible = false;
    const saved = hideRects(s.tileData, scan.standing);
    let rt: TexLike | null = null;
    try {
      const mips = Math.floor(Math.log2(Math.max(band.w, band.h) * STRIP_RES)) + 1;
      rt = s.renderer.generateTexture({
        target: s.ground, frame: new C.Rectangle(band.x0, band.y0, band.w, band.h), resolution: STRIP_RES,
        textureSourceOptions: { autoGenerateMipmaps: true, mipLevelCount: mips, scaleMode: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge', maxAnisotropy: 8 },
      });
    } finally {
      restoreRects(s.tileData, scan.standing, saved);
      setTilemapShown(ov, s.tilemap, tv);
      for (const c of others) c.visible = true;
    }
    const ex = s.renderer.extract.pixels(rt);
    u.uTopColor.set(rowAverage(ex.pixels, ex.width, 0));
    u.uBotColor.set(rowAverage(ex.pixels, ex.width, ex.height - 1));
    u.uStrip[0] = band.w; u.uStrip[1] = band.h;
    u.uH0 = band.h - RING_H0_ABOVE_BOTTOM;
    // Bound first: PIXI warns when a bound texture source is destroyed.
    const old = strip;
    strip = rt;
    shader.resources.uSkyTexture = rt.source;
    shader.resources.uSkySampler = rt.source.style;
    old?.destroy(true);
    return true;
  }

  // Released with the floor bakes (≈5 MB kept through 2D before, A V7); warm() or the next entry bakes it again.
  function releaseStrip(): void {
    floorScan = null;
    if (!strip) return;
    shader.resources.uSkyTexture = white;
    shader.resources.uSkySampler = white.style;
    strip.destroy(true);
    strip = null;
  }

  floor.addBakeHooks({
    before() {
      ring.visible = false;
      const scan = getScan();
      if (!provisional(floorScan)) floorScan = scan;
      const offs = scan.sky.concat(scan.standing);
      held = { offs, saved: hideRects(s.tileData, offs) };
    },
    after() {
      if (held) { restoreRects(s.tileData, held.offs, held.saved); held = null; }
    },
    release: releaseStrip,
  });

  return {
    name: 'horizon',
    pre(ctx) {
      if (!strip) bakeStrip(ctx.ov);
      if (provisional(floorScan) && getScan().len >= 0) { floorScan = null; floor.forceRebake(); }
      u.uScreen[0] = ctx.W; u.uScreen[1] = ctx.H;
      RU.update();
      ring.visible = strip !== null;
    },
    warm(ov) { return !strip && bakeStrip(ov); },
    compile() { compileNow(caps, geom, shader); },
    drop() { ring.visible = false; },
    destroy() {
      s.ground.removeChild(ring);
      ring.destroy();
      geom.destroy(true);
      shader.destroy(true);
      strip?.destroy(true);
      strip = null;
      floorScan = null;
    },
  };
}
