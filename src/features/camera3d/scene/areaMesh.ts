import { camera3dDiag } from '../diagnostics';
import type { FrameCtx, Pass } from '../frame/frame';
import { AREA_MARK_Z } from '../math/depth';
import type { Caps, GeometryLike, Mat, Node3, ShaderLike, UniformGroupLike } from '../types';
import type { AreaTileSink } from './areaMarks';
import { CAM_RESOURCE } from './camUniforms';
import { AREA_FS, AREA_VS } from './shaders';

// One mesh per (texture source, z band): area grids share one texture per grid; ground markers and building decals
// (polish Task 11) add a few more. More than this keep their sprite path.
export const MAX_BATCHES = 12;
const MIN_QUADS = 32;

type Affine = Pick<Mat, 'a' | 'b' | 'c' | 'd' | 'tx' | 'ty'>;
interface Rect { x: number; y: number; width: number; height: number }
type Uvs = { x0: number; y0: number; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number };
/** The PIXI 8 Texture fields a Sprite's quad comes from (uvs: TL, TR, BR, BL, rotated atlas frames included). */
export interface QuadTex {
  orig: { width: number; height: number };
  trim?: Rect | null;
  uvs?: Uvs;
  source?: object | null;
}
/** A cacheAsTexture container's render group: PIXI draws `texture` over `_textureBounds` (live 1411, the tap outlines).
 * The texture is filled only when PIXI renders the node: blank while `textureNeedsUpdate` (live 1411, after a reload). */
interface CachedGroup {
  isCachedAsTexture?: boolean; textureNeedsUpdate?: boolean; texture?: { uvs?: Uvs; source?: object | null } | null;
  _textureBounds?: { minX: number; minY: number; maxX: number; maxY: number };
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

/** Quad `q`: local rect (x0, y0)–(x1, y1) at 2D world W2 · L, with the texture uvs (TL, TR, BR, BL). */
function writeRectQuad(L: Affine, W2: Affine, x0: number, y0: number, x1: number, y1: number, u: Uvs | undefined, pos: Float32Array, uv: Float32Array, q: number): boolean {
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

/** Quad `q`: the sprite's drawn rect (trim inside orig, minus the anchor, as PIXI 8 Sprite) at 2D world W2 · L. */
export function writeTileQuad(L: Affine, W2: Affine, tex: QuadTex, ax: number, ay: number, pos: Float32Array, uv: Float32Array, q: number): boolean {
  const o = tex.orig, t = tex.trim;
  const x0 = (t ? t.x : 0) - ax * o.width, y0 = (t ? t.y : 0) - ay * o.height;
  return writeRectQuad(L, W2, x0, y0, x0 + (t ? t.width : o.width), y0 + (t ? t.height : o.height), tex.uvs, pos, uv, q);
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

// A sprite's texture object; a Graphics' `texture` is its drawing-API method (live 1411, the tap outlines).
const spriteTex = (n: Node3): QuadTex | null => (typeof n.texture === 'object' ? (n.texture as unknown as QuadTex | null) : null);

/** What a node draws as one textured quad: a sprite, or a cacheAsTexture container. Null: not a quad. */
function quadSource(n: Node3): object | null {
  const tex = spriteTex(n);
  if (tex) return tex.source && tex.uvs && n.anchor ? tex.source : null;
  const g = n.renderGroup as unknown as CachedGroup | null | undefined;
  return g?.isCachedAsTexture && g.textureNeedsUpdate === false && g.texture?.uvs && g.texture.source && g._textureBounds ? g.texture.source : null;
}

function writeNodeQuad(n: Node3, W2: Affine, pos: Float32Array, uv: Float32Array, q: number): boolean {
  const tex = spriteTex(n);
  if (tex && n.anchor) return writeTileQuad(n.localTransform, W2, tex, n.anchor.x, n.anchor.y, pos, uv, q);
  const g = n.renderGroup as unknown as CachedGroup, b = g._textureBounds!;
  return writeRectQuad(n.localTransform, W2, b.minX, b.minY, b.maxX, b.maxY, g.texture!.uvs, pos, uv, q);
}

interface DynGeometry extends GeometryLike { getBuffer(name: string): { update(): void } }
interface Batch { src: object; z: number; mesh: Node3; geom: DynGeometry; shader: ShaderLike; cap: number; pos: Float32Array; uv: Float32Array; col: Float32Array; n: number; used: number; dirty: boolean }

export interface AreaMesh extends Pass, AreaTileSink {}

/** Tilted, flat game art is drawn here in perspective: area tiles (areaMarks.ts), ground markers and building decals
 * (flat.ts). The callers hide the nodes they hand over. cam: the shared camera uniform group (camUniforms.ts). */
export function createAreaMesh(caps: Caps, skip: WeakSet<Node3>, cam: UniformGroupLike): AreaMesh {
  const { scene: s, classes: C } = caps;
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

  function create(src: object, z: number): Batch | null {
    try {
      program ??= new C.GlProgram({ vertex: AREA_VS, fragment: AREA_FS, name: 'qpm3d-area' });
      const cap = MIN_QUADS;
      const pos = new Float32Array(cap * 8), uv = new Float32Array(cap * 8), col = new Float32Array(cap * 16);
      const geom = geometry(cap, pos, uv, col);
      const style = (src as { style?: unknown }).style;
      const shader = new C.Shader({ glProgram: program, resources: { [CAM_RESOURCE]: cam, uAreaTexture: src, uAreaSampler: style } });
      const mesh = new C.Mesh({ geometry: geom, shader, texture: C.Texture.WHITE });
      mesh.label = 'qpm3d-area';
      mesh.eventMode = 'none';
      mesh.zIndex = z;
      skip.add(mesh);
      s.world.addChild(mesh);
      return { src, z, mesh, geom, shader, cap, pos, uv, col, n: 0, used: 0, dirty: true };
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

  function free(b: Batch): void {
    b.mesh.parent?.removeChild(b.mesh);
    b.mesh.destroy();
    b.geom.destroy(true);
    b.shader.destroy(false);
  }

  function release(): void {
    for (const b of batches) free(b);
    batches = [];
    frame = -1;
  }

  // At the cap, a batch that drew nothing last frame and has nothing yet this frame gives up its slot: a re-cached
  // marker texture comes from the texture pool, so its source can change during a 3D session.
  function freeSlot(): boolean {
    const i = batches.findIndex((x) => x.n === 0 && x.used === 0);
    if (i < 0) return false;
    free(batches[i]!);
    batches.splice(i, 1);
    return true;
  }

  return {
    name: 'areaMesh',
    add(ctx, n, w2, alpha, z = AREA_MARK_Z) {
      if (failed) return false;
      const src = quadSource(n);
      if (!src) return false;
      if (frame !== ctx.frameNo) { frame = ctx.frameNo; for (const x of batches) x.n = 0; }
      let b: Batch | null = null;
      for (const x of batches) if (x.src === src && x.z === z) { b = x; break; }
      if (!b) {
        if (batches.length >= MAX_BATCHES && !freeSlot()) return false;
        b = create(src, z);
        if (!b) return false;
        batches.push(b);
      }
      if (b.n === b.cap) grow(b);
      n.updateLocalTransform();
      if (writeNodeQuad(n, w2, b.pos, b.uv, b.n)) b.dirty = true;
      if (writeQuadColor(n.tint ?? 0xffffff, alpha, b.col, b.n)) b.dirty = true;
      b.n++;
      return true;
    },
    // After the passes that feed it: quads not re-added this frame collapse to a point, an empty batch is hidden (no
    // draw call), changed buffers upload.
    pre(ctx) {
      if (frame !== ctx.frameNo) { frame = ctx.frameNo; for (const x of batches) x.n = 0; }
      for (const b of batches) {
        for (let i = b.n * 8; i < b.used * 8; i++) if (b.pos[i] !== 0) { b.pos[i] = 0; b.dirty = true; }
        b.used = b.n;
        const show = b.n > 0;
        if (b.mesh.visible !== show) b.mesh.visible = show;
        if (!b.dirty) continue;
        b.geom.getBuffer('aPosition').update();
        b.geom.getBuffer('aUV').update();
        b.geom.getBuffer('aColor').update();
        b.dirty = false;
        uploads++;
      }
    },
    drop: release,
    destroy() {
      release();
      (program as { destroy?(): void } | null)?.destroy?.();
      program = null;
    },
    stats: () => ({ quads: batches.reduce((n, b) => n + b.used, 0), batches: batches.length, uploads, failed }),
  };
}
