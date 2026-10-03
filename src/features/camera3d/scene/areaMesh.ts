import { camera3dDiag } from '../diagnostics';
import type { FrameCtx, Pass } from '../frame/frame';
import { AREA_MARK_Z } from '../math/depth';
import type { Caps, GeometryLike, Mat, Node3, ShaderLike, UniformGroupLike } from '../types';
import type { AreaTileSink } from './areaMarks';
import { AREA_FS, AREA_VS } from './shaders';

// One mesh per tile texture source (the game's AreaTileIndicator shares one texture per grid); more sources than this
// keep the sprite path.
const MAX_BATCHES = 4;
const MIN_QUADS = 32;

type Affine = Pick<Mat, 'a' | 'b' | 'c' | 'd' | 'tx' | 'ty'>;
interface Rect { x: number; y: number; width: number; height: number }
/** The PIXI 8 Texture fields a Sprite's quad comes from (uvs: TL, TR, BR, BL, rotated atlas frames included). */
export interface QuadTex {
  orig: { width: number; height: number };
  trim?: Rect | null;
  uvs?: { x0: number; y0: number; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number };
  source?: object | null;
}

const put = (a: Float32Array, i: number, v: number): boolean => {
  const f = Math.fround(v);
  if (a[i] === f) return false;
  a[i] = f;
  return true;
};

function corner(pos: Float32Array, i: number, L: Affine, W2: Affine, lx: number, ly: number): boolean {
  const px = L.a * lx + L.c * ly + L.tx, py = L.b * lx + L.d * ly + L.ty;
  const cx = put(pos, i, W2.a * px + W2.c * py + W2.tx);
  return put(pos, i + 1, W2.b * px + W2.d * py + W2.ty) || cx;
}

/** Quad `q`: the sprite's drawn rect (trim inside orig, minus the anchor, as PIXI 8 Sprite) at 2D world W2 · L. */
export function writeTileQuad(L: Affine, W2: Affine, tex: QuadTex, ax: number, ay: number, pos: Float32Array, uv: Float32Array, q: number): boolean {
  const o = tex.orig, t = tex.trim, u = tex.uvs;
  const x0 = (t ? t.x : 0) - ax * o.width, x1 = x0 + (t ? t.width : o.width);
  const y0 = (t ? t.y : 0) - ay * o.height, y1 = y0 + (t ? t.height : o.height);
  const i = q * 8;
  let ch = corner(pos, i, L, W2, x0, y0);
  ch = corner(pos, i + 2, L, W2, x1, y0) || ch;
  ch = corner(pos, i + 4, L, W2, x1, y1) || ch;
  ch = corner(pos, i + 6, L, W2, x0, y1) || ch;
  if (u) {
    ch = put(uv, i, u.x0) || ch; ch = put(uv, i + 1, u.y0) || ch; ch = put(uv, i + 2, u.x1) || ch; ch = put(uv, i + 3, u.y1) || ch;
    ch = put(uv, i + 4, u.x2) || ch; ch = put(uv, i + 5, u.y2) || ch; ch = put(uv, i + 6, u.x3) || ch; ch = put(uv, i + 7, u.y3) || ch;
  }
  return ch;
}

/** Premultiplied tint × alpha on the quad's four corners (PIXI's sprite colour). */
export function writeQuadColor(tint: number, alpha: number, col: Float32Array, q: number): boolean {
  const r = (((tint >> 16) & 255) / 255) * alpha, g = (((tint >> 8) & 255) / 255) * alpha, b = ((tint & 255) / 255) * alpha;
  let ch = false;
  for (let k = 0, i = q * 16; k < 4; k++, i += 4) {
    ch = put(col, i, r) || ch; ch = put(col, i + 1, g) || ch; ch = put(col, i + 2, b) || ch; ch = put(col, i + 3, alpha) || ch;
  }
  return ch;
}

interface DynGeometry extends GeometryLike { getBuffer(name: string): { update(): void } }
interface Batch { src: object; mesh: Node3; geom: DynGeometry; shader: ShaderLike; cap: number; pos: Float32Array; uv: Float32Array; col: Float32Array; n: number; used: number; dirty: boolean }
interface CamUniforms { uCamPos: Float32Array; uCamF: Float32Array; uCamR: Float32Array; uCamU: Float32Array; uFpx: number; uCenter: Float32Array; uNear: number }

export interface AreaMesh extends Pass, AreaTileSink {}

/** Tilted, the game's area tiles are drawn here in perspective (areaMarks.ts hides the sprites it takes). */
export function createAreaMesh(caps: Caps, skip: WeakSet<Node3>): AreaMesh {
  const { scene: s, classes: C } = caps;
  let CU: UniformGroupLike | null = null;
  let program: unknown = null;
  let batches: Batch[] = [];
  let frame = -1, failed = false, uploads = 0;

  const geometry = (cap: number, pos: Float32Array, uv: Float32Array, col: Float32Array): DynGeometry => {
    const idx = new Uint32Array(cap * 6);
    for (let q = 0; q < cap; q++) { const v = q * 4, i = q * 6; idx[i] = v; idx[i + 1] = v + 1; idx[i + 2] = v + 2; idx[i + 3] = v; idx[i + 4] = v + 2; idx[i + 5] = v + 3; }
    return new C.Geometry({
      attributes: { aPosition: { buffer: pos, format: 'float32x2' }, aUV: { buffer: uv, format: 'float32x2' }, aColor: { buffer: col, format: 'float32x4' } },
      indexBuffer: idx, topology: 'triangle-list',
    }) as unknown as DynGeometry;
  };

  function create(src: object): Batch | null {
    try {
      const fv = (len: number, type: string) => ({ value: new Float32Array(len), type });
      const f1 = (v: number) => ({ value: v, type: 'f32' });
      CU ??= new C.UniformGroup({
        uCamPos: fv(3, 'vec3<f32>'), uCamF: fv(3, 'vec3<f32>'), uCamR: fv(3, 'vec3<f32>'), uCamU: fv(3, 'vec3<f32>'), uFpx: f1(1), uCenter: fv(2, 'vec2<f32>'), uNear: f1(40),
      });
      program ??= new C.GlProgram({ vertex: AREA_VS, fragment: AREA_FS, name: 'qpm3d-area' });
      const cap = MIN_QUADS;
      const pos = new Float32Array(cap * 8), uv = new Float32Array(cap * 8), col = new Float32Array(cap * 16);
      const geom = geometry(cap, pos, uv, col);
      const style = (src as { style?: unknown }).style;
      const shader = new C.Shader({ glProgram: program, resources: { qpm3dArea: CU, uAreaTexture: src, uAreaSampler: style } });
      const mesh = new C.Mesh({ geometry: geom, shader, texture: C.Texture.WHITE });
      mesh.label = 'qpm3d-area';
      mesh.eventMode = 'none';
      mesh.zIndex = AREA_MARK_Z;
      skip.add(mesh);
      s.world.addChild(mesh);
      return { src, mesh, geom, shader, cap, pos, uv, col, n: 0, used: 0, dirty: true };
    } catch (e) {
      failed = true;
      camera3dDiag.diag.info('QPM-CAM3D-008', { error: String(e) });
      return null;
    }
  }

  function grow(b: Batch): void {
    const cap = b.cap * 2;
    const pos = new Float32Array(cap * 8), uv = new Float32Array(cap * 8), col = new Float32Array(cap * 16);
    pos.set(b.pos); uv.set(b.uv); col.set(b.col);
    const geom = geometry(cap, pos, uv, col);
    (b.mesh as unknown as { geometry: unknown }).geometry = geom;
    b.geom.destroy(true);
    Object.assign(b, { cap, pos, uv, col, geom, dirty: true });
  }

  function release(): void {
    for (const b of batches) {
      b.mesh.parent?.removeChild(b.mesh);
      b.mesh.destroy();
      b.geom.destroy(true);
      b.shader.destroy(false);
    }
    batches = [];
    frame = -1;
  }

  return {
    name: 'areaMesh',
    add(ctx, sp, w2, alpha) {
      if (failed) return false;
      const tex = sp.texture as unknown as QuadTex | null | undefined;
      const src = tex?.source, anc = sp.anchor;
      if (!tex || !src || !tex.uvs || !anc) return false;
      if (frame !== ctx.frameNo) { frame = ctx.frameNo; for (const x of batches) x.n = 0; }
      let b: Batch | null = null;
      for (const x of batches) if (x.src === src) { b = x; break; }
      if (!b) {
        if (batches.length >= MAX_BATCHES) return false;
        b = create(src);
        if (!b) return false;
        batches.push(b);
      }
      if (b.n === b.cap) grow(b);
      sp.updateLocalTransform();
      if (writeTileQuad(sp.localTransform, w2, tex, anc.x, anc.y, b.pos, b.uv, b.n)) b.dirty = true;
      if (writeQuadColor(sp.tint ?? 0xffffff, alpha, b.col, b.n)) b.dirty = true;
      b.n++;
      return true;
    },
    // After the entity pass: quads not re-added this frame collapse to a point (no draw), changed buffers upload.
    pre(ctx) {
      if (frame !== ctx.frameNo) { frame = ctx.frameNo; for (const x of batches) x.n = 0; }
      let any = false;
      for (const b of batches) {
        for (let i = b.n * 8; i < b.used * 8; i++) if (b.pos[i] !== 0) { b.pos[i] = 0; b.dirty = true; }
        b.used = b.n;
        if (b.n > 0) any = true;
        if (!b.dirty) continue;
        b.geom.getBuffer('aPosition').update();
        b.geom.getBuffer('aUV').update();
        b.geom.getBuffer('aColor').update();
        b.dirty = false;
        uploads++;
      }
      if (!any || !CU) return;
      const u = CU.uniforms as unknown as CamUniforms, bs = ctx.basis;
      u.uCamPos.set(bs.C); u.uCamF.set(bs.F); u.uCamR.set(bs.R); u.uCamU.set(bs.U);
      u.uFpx = bs.fpx; u.uCenter[0] = bs.cx0; u.uCenter[1] = bs.cy0; u.uNear = ctx.params.near;
      CU.update();
    },
    drop: release,
    destroy() {
      release();
      (program as { destroy?(): void } | null)?.destroy?.();
      program = null;
      CU = null;
    },
    stats: () => ({ quads: batches.reduce((n, b) => n + b.used, 0), batches: batches.length, uploads, failed }),
  };
}
