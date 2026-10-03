import type { FrameCtx, Pass } from '../frame/frame';
import type { Caps, Node3, TexLike, UniformGroupLike } from '../types';
import type { Floor } from './floor';
import { RING_FS, RING_VS } from './shaders';
import { hideRects, restoreRects, type TileScan } from './tileArt';

const STRIP = { x0: 0, w: 1536, h: 2560, res: 0.5 };
const RING_N = 8, RING_H0 = 2384, RING_BLEND = 160;

interface RingUniforms { uScreen: Float32Array; uCamF: Float32Array; uCamR: Float32Array; uCamU: Float32Array; uFpx: number; uCenter: Float32Array; uRingN: number; uH0: number; uStrip: Float32Array; uBlend: number; uTopColor: Float32Array; uBotColor: Float32Array }

export function createHorizon(caps: Caps, floor: Floor, getScan: () => TileScan): Pass {
  const { scene: s, classes: C } = caps;
  const f1 = (v: number) => ({ value: v, type: 'f32' });
  const fv = (len: number, type: string) => ({ value: new Float32Array(len), type });
  const RU: UniformGroupLike = new C.UniformGroup({
    uScreen: fv(2, 'vec2<f32>'), uCamF: fv(3, 'vec3<f32>'), uCamR: fv(3, 'vec3<f32>'), uCamU: fv(3, 'vec3<f32>'), uFpx: f1(1), uCenter: fv(2, 'vec2<f32>'),
    uRingN: f1(RING_N), uH0: f1(RING_H0), uStrip: fv(2, 'vec2<f32>'), uBlend: f1(RING_BLEND), uTopColor: fv(4, 'vec4<f32>'), uBotColor: fv(4, 'vec4<f32>'),
  });
  const u = RU.uniforms as unknown as RingUniforms;
  const white = C.Texture.WHITE.source;
  const shader = new C.Shader({ glProgram: new C.GlProgram({ vertex: RING_VS, fragment: RING_FS, name: 'qpm3d-ring' }), resources: { qpm3dRing: RU, uSkyTexture: white, uSkySampler: white.style } });
  const geom = new C.Geometry({ attributes: { aPosition: { buffer: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]), format: 'float32x2' } }, indexBuffer: new Uint32Array([0, 1, 2, 0, 2, 3]), topology: 'triangle-list' });
  const ring = new C.Mesh({ geometry: geom, shader, texture: C.Texture.WHITE });
  ring.label = 'qpm3d-ring';
  ring.visible = false;
  const at = s.ground.children.findIndex((c) => c.label === 'qpm3d-ground');
  s.ground.addChildAt(ring, at < 0 ? s.ground.children.length : at);
  let strip: TexLike | null = null;
  let held: { offs: number[]; saved: Float32Array } | null = null;

  const rowAverage = (px: Uint8Array | Uint8ClampedArray, w: number, y: number): number[] => {
    const c = [0, 0, 0, 0];
    for (let x = 0; x < w; x++) for (let k = 0; k < 4; k++) c[k] = (c[k] ?? 0) + px[(y * w + x) * 4 + k]!;
    return c.map((v) => v / w / 255);
  };

  function bakeStrip(ctx: FrameCtx): void {
    const scan = getScan();
    const others: Node3[] = s.ground.children.filter((c) => c !== s.tilemap && c.visible);
    const tv = ctx.ov.raw<boolean>('visible', s.tilemap);
    ctx.ov.rawSet('visible', s.tilemap, true);
    for (const c of others) c.visible = false;
    const saved = hideRects(s.tileData, scan.standing);
    let rt: TexLike | null = null;
    try {
      const mips = Math.floor(Math.log2(Math.max(STRIP.w, STRIP.h) * STRIP.res)) + 1;
      rt = s.renderer.generateTexture({
        target: s.ground, frame: new C.Rectangle(STRIP.x0, 0, STRIP.w, STRIP.h), resolution: STRIP.res,
        textureSourceOptions: { autoGenerateMipmaps: true, mipLevelCount: mips, scaleMode: 'linear', addressModeU: 'repeat', addressModeV: 'clamp-to-edge', maxAnisotropy: 8 },
      });
    } finally {
      restoreRects(s.tileData, scan.standing, saved);
      ctx.ov.rawSet('visible', s.tilemap, tv);
      for (const c of others) c.visible = true;
    }
    const ex = s.renderer.extract.pixels(rt);
    u.uTopColor.set(rowAverage(ex.pixels, ex.width, 0));
    u.uBotColor.set(rowAverage(ex.pixels, ex.width, ex.height - 1));
    strip?.destroy(true);
    strip = rt;
    shader.resources.uSkyTexture = rt.source;
    shader.resources.uSkySampler = rt.source.style;
  }

  floor.addBakeHooks({
    before() {
      ring.visible = false;
      const scan = getScan();
      const offs = scan.sky.concat(scan.standing);
      held = { offs, saved: hideRects(s.tileData, offs) };
    },
    after() {
      if (held) { restoreRects(s.tileData, held.offs, held.saved); held = null; }
    },
  });
  floor.setSkyReplaced(true);

  return {
    name: 'horizon',
    pre(ctx) {
      if (!strip) bakeStrip(ctx);
      const b = ctx.basis;
      u.uScreen[0] = ctx.W; u.uScreen[1] = ctx.H;
      u.uCamF.set(b.F); u.uCamR.set(b.R); u.uCamU.set(b.U);
      u.uFpx = b.fpx; u.uCenter[0] = b.cx0; u.uCenter[1] = b.cy0;
      u.uStrip[0] = STRIP.w; u.uStrip[1] = STRIP.h;
      RU.update();
      ring.visible = true;
    },
    drop() { ring.visible = false; },
    destroy() {
      s.ground.removeChild(ring);
      ring.destroy();
      geom.destroy(true);
      shader.destroy(true);
      strip?.destroy(true);
      strip = null;
    },
  };
}
