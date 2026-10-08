import type { Caps, TexLike } from '../types';

export interface HashFn { name: string; src: string }
export interface PhaseMap { cols: number; rows: number; phases: Uint8Array }
export interface PhasePoints { pts: Float32Array; cols: number; rows: number }
/** RGBA bytes of a cols × rows target with each cell's phase in red, or null when the draw failed. */
export type PhaseRender = (prog: { vs: string; fs: string }, p: PhasePoints, phaseCount: number) => ArrayLike<number> | null;

// The game's per-cell hash: the first `float name(vec2 x) { … }` in its weather VS (live: hashCell).
const HASH_FN = /float\s+(\w+)\s*\(\s*vec2\s+\w+\s*\)\s*\{[\s\S]*?\n\}/;
const CLEAR = 255;

export function extractHashFn(vs: string): HashFn | null {
  const m = HASH_FN.exec(vs);
  return m?.[1] ? { name: m[1], src: m[0] } : null;
}

/** Same function source and the same call expression as the game VS, evaluated per vertex (one point per cell). */
export function phaseProgram(hash: HashFn): { vs: string; fs: string } {
  return {
    vs: `#version 300 es\nprecision highp float;\nin vec2 aCell;\nuniform vec2 uGrid;\nuniform float uPhaseCount;\nflat out float vPhase;\n${hash.src}\nvoid main(void) {\n  vPhase = floor(${hash.name}(aCell) * uPhaseCount);\n  gl_PointSize = 1.0;\n  gl_Position = vec4((aCell + 0.5) / uGrid * 2.0 - 1.0, 0.0, 1.0);\n}\n`,
    fs: '#version 300 es\nprecision highp float;\nflat in float vPhase;\nout vec4 finalColor;\nvoid main(void) { finalColor = vec4(vPhase / 255.0, 0.0, 0.0, 1.0); }\n',
  };
}

/** One point per cell of the game geometry (aCell: 4 vertices × 2 floats per cell). */
export function phasePoints(aCell: Float32Array): PhasePoints | null {
  const n = Math.floor(aCell.length / 8);
  const pts = new Float32Array(n * 2);
  let cols = 0, rows = 0;
  for (let i = 0; i < n; i++) {
    const cx = aCell[i * 8]!, cy = aCell[i * 8 + 1]!;
    pts[i * 2] = cx;
    pts[i * 2 + 1] = cy;
    cols = Math.max(cols, cx + 1);
    rows = Math.max(rows, cy + 1);
  }
  return cols > 0 && rows > 0 ? { pts, cols, rows } : null;
}

export interface PhaseCache { get(vs: string, aCell: Float32Array, phaseCount: number): PhaseMap | null }

/** The game's GPU phase bucket per cell (index cy * cols + cx; 255 = not drawn), or null (the caller falls back to the
 * CPU twin). Only successes are kept: a failure is retried when the next grid is built (A W4). */
export function createPhaseCache(render: PhaseRender): PhaseCache {
  const done = new Map<string, PhaseMap>();
  return {
    get(vs, aCell, phaseCount) {
      const id = `${phaseCount}:${aCell.length}:${vs}`;
      const hit = done.get(id);
      if (hit) return hit;
      const hash = extractHashFn(vs);
      const p = phasePoints(aCell);
      if (!hash || !p || phaseCount <= 0 || phaseCount >= CLEAR) return null;
      const px = render(phaseProgram(hash), p, phaseCount);
      if (!px || px.length < p.cols * p.rows * 4) return null;
      const phases = new Uint8Array(p.cols * p.rows);
      let drawn = 0;
      for (let i = 0; i < phases.length; i++) { phases[i] = px[i * 4]!; if (phases[i] !== CLEAR) drawn++; }
      if (drawn === 0) return null;
      const map = { cols: p.cols, rows: p.rows, phases };
      done.set(id, map);
      return map;
    },
  };
}

/** Draws the phase points through the game's own renderer (as alphaProbe does): a throwaway WebGL2 context per grid
 * could evict the game's near the browser's context cap. Live 2026-10-05 (1419): equal to the old context's readback
 * for all 6060 cells of a 101 × 60 grid, rows in the same order, 9.3 ms with the compile. */
export function gameRendererPhases(caps: Caps): PhaseRender {
  const { classes: C, scene: { renderer: r } } = caps;
  return (prog, p, phaseCount) => {
    if (r.gl?.isContextLost()) return null;
    const geometry = new C.Geometry({ attributes: { aCell: { buffer: p.pts, format: 'float32x2' } }, topology: 'point-list' });
    const uniforms = new C.UniformGroup({ uGrid: { value: new Float32Array([p.cols, p.rows]), type: 'vec2<f32>' }, uPhaseCount: { value: phaseCount, type: 'f32' } });
    const shader = new C.Shader({ glProgram: new C.GlProgram({ vertex: prog.vs, fragment: prog.fs, name: 'qpm3d-phase' }), resources: { qpm3dPhase: uniforms } });
    const mesh = new C.Mesh({ geometry, shader, texture: C.Texture.WHITE });
    let tex: TexLike | null = null;
    try {
      tex = r.generateTexture({ target: mesh, frame: new C.Rectangle(0, 0, p.cols, p.rows), resolution: 1, clearColor: [1, 0, 0, 1], antialias: false });
      const out = r.extract.pixels(tex);
      return out.width === p.cols && out.height === p.rows ? out.pixels : null;
    } catch {
      return null;
    } finally {
      tex?.destroy(true);
      mesh.destroy();
      shader.destroy(true);
      geometry.destroy(true);
    }
  };
}
