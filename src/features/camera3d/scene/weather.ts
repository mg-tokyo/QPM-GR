import { getKeysByFrame } from '../../../sprite-v2/gameTextures';
import { camera3dDiag } from '../diagnostics';
import type { Fog, FrameCtx, Pass } from '../frame/frame';
import type { Caps, Node3, ShaderLike, UniformGroupLike } from '../types';
import { fadeWeight } from './fades';
import type { Floor } from './floor';
import { patchWeatherFragment, patchWeatherVertex, stripShaderName } from './shaders';
import { createWeatherBolts, type BoltSource } from './weatherBolts';
import { parseCellHash, weatherBlend, weatherModeOf, type CellHash, type WeatherMode } from './weatherCells';

// The flat pattern's draw slot: above World while nearly straight down (the 2D order, so s = 0 stays exact in rain),
// on the ground under billboards below 80°. Standing weather always draws above World (spec §6.8.1).
const OVER_PITCH = (80 * Math.PI) / 180;

/** Spec §6.8.1 tuning; `on: false` draws every weather flat (the perf A/B). standScale 1 = the art's native size, as
 * the game draws it. */
export interface WeatherTuning { on: boolean; radiusTiles: number; thinTiles: number; standScale: number }
export const defaultWeatherTuning = (): WeatherTuning => ({ on: true, radiusTiles: 16, thinTiles: 4, standScale: 1 });

interface Mirror {
  game: Node3; mesh: Node3; shader: ShaderLike; prog: unknown; vs: string; mode: UniformGroupLike; hash: CellHash | null;
  ox: number; oy: number; key: string | null; last: WeatherMode; bolt: BoltSource | null;
}
interface CamUniforms {
  uCamPos: Float32Array; uCamF: Float32Array; uCamR: Float32Array; uCamU: Float32Array; uFpx: number; uCenter: Float32Array; uNear: number;
  uRadius: number; uThinPx: number; uStandScale: number;
}
interface ModeUniforms { uStand: number; uFlatAlpha: number; uFootPx: number }
// The game's weather group 99 resource slots, in the order the mirror shader binds them (live 10-02 bind map).
const RES_NAMES = ['weatherUniforms', 'uWeatherTexture', 'uWeatherSampler'] as const;

const gameUniforms = (m: Mirror): Record<string, unknown> => (m.shader.resources.weatherUniforms as UniformGroupLike).uniforms;
const vecAt = (u: Record<string, unknown>, k: string, i: number): number | null => { const v = u[k]; return v instanceof Float32Array && v.length > i ? v[i]! : null; };

export function createWeatherMirror(caps: Caps, floor: Floor, skip: WeakSet<Node3>, fog: Fog, tune: WeatherTuning): Pass & { available(): boolean } {
  const { scene: s, classes: C } = caps;
  const fv = (len: number, type: string) => ({ value: new Float32Array(len), type });
  const f1 = (value: number) => ({ value, type: 'f32' });
  const CU: UniformGroupLike = new C.UniformGroup({
    uCamPos: fv(3, 'vec3<f32>'), uCamF: fv(3, 'vec3<f32>'), uCamR: fv(3, 'vec3<f32>'), uCamU: fv(3, 'vec3<f32>'), uFpx: f1(1), uCenter: fv(2, 'vec2<f32>'), uNear: f1(40),
    uRadius: f1(4096), uThinPx: f1(1024), uStandScale: f1(1),
  });
  const u = CU.uniforms as unknown as CamUniforms;
  const mirrors: Mirror[] = [];
  const handled = new WeakSet<Node3>();
  const bolts = createWeatherBolts(caps, skip);
  let failed = false;
  let fadeOk = true;

  const build = (game: Node3): Mirror | null => {
    const sh = game.shader as ShaderLike | undefined;
    const res = sh?.groups?.['99']?.resources;
    const vs = sh?.glProgram ? patchWeatherVertex(sh.glProgram.vertex) : null;
    if (!sh?.glProgram || !res || !res['0'] || !res['1'] || !res['2'] || !vs || !game.geometry) return null;
    const fs = patchWeatherFragment(sh.glProgram.fragment);
    if (!fs) fadeOk = false;
    const mode: UniformGroupLike = new C.UniformGroup({ uStand: f1(0), uFlatAlpha: f1(1), uFootPx: f1(256) });
    const shader = new C.Shader({
      glProgram: new C.GlProgram({ vertex: vs, fragment: fs ?? stripShaderName(sh.glProgram.fragment), name: 'qpm3d-weather' }),
      resources: { weatherUniforms: res['0'], uWeatherTexture: res['1'], uWeatherSampler: res['2'], qpm3dWeatherCam: CU, qpm3dWeatherMode: mode },
    });
    const mesh = new C.Mesh({ geometry: game.geometry, shader, texture: C.Texture.WHITE });
    mesh.label = 'qpm3d-weather';
    mesh.eventMode = 'none';
    mesh.visible = false;
    handled.add(mesh);
    return { game, mesh, shader, prog: sh.glProgram, vs: sh.glProgram.vertex, mode, hash: parseCellHash(sh.glProgram.vertex), ox: NaN, oy: NaN, key: null, last: 'flat', bolt: null };
  };
  const dispose = (m: Mirror): void => { m.mesh.parent?.removeChild(m.mesh); m.mesh.destroy(); m.shader.destroy(true); };

  // A weather change replaces a mesh's geometry (live 2026-10-03, AmberMoon: the mirror kept the destroyed one and
  // every 3D frame threw in checkCompatibility) and can swap its resources or program: follow the game each frame.
  const sync = (i: number): Mirror | null => {
    const m = mirrors[i]!;
    const sh = m.game.shader as ShaderLike | undefined;
    if (sh?.glProgram !== m.prog) {
      dispose(m);
      const next = build(m.game);
      if (!next) { mirrors.splice(i, 1); handled.delete(m.game); return null; }
      mirrors[i] = next;
      return next;
    }
    const g = m.game.geometry;
    if (g && m.mesh.geometry !== g) m.mesh.geometry = g;
    const res = sh?.groups?.['99']?.resources;
    if (res) RES_NAMES.forEach((name, k) => { const r = res[String(k)]; if (r && m.shader.resources[name] !== r) { m.shader.resources[name] = r; m.ox = NaN; } });
    return m;
  };

  // The active weather's atlas key: the game writes uFrameOriginPx = texture.frame.{x,y} on every weather change
  // (live setWeather, build 1381). Looked up again only when the origin moves.
  const keyOf = (m: Mirror): string | null => {
    const gu = gameUniforms(m);
    const x = vecAt(gu, 'uFrameOriginPx', 0), y = vecAt(gu, 'uFrameOriginPx', 1);
    if (x === null || y === null) return null;
    if (x !== m.ox || y !== m.oy) {
      const byFrame = getKeysByFrame('weather/');
      if (byFrame.size === 0) return null; // sprite textures not loaded yet: look again next frame
      m.ox = x; m.oy = y;
      m.key = byFrame.get(`${x},${y}`) ?? null;
      m.bolt = m.key && m.hash ? { game: m.game, uniforms: gu, key: m.key, hash: m.hash, vs: m.vs } : null;
    }
    return m.key;
  };

  for (const game of s.weather.children) {
    const m = build(game);
    if (!m) { failed = true; continue; }
    mirrors.push(m);
    handled.add(game);
  }
  if (failed || mirrors.length === 0) camera3dDiag.diag.info('QPM-CAM3D-006', { mirrors: mirrors.length });

  floor.addBakeHooks({
    before() { for (const m of mirrors) m.mesh.visible = false; },
    after() { /* pre() sets visibility again this frame */ },
  });

  return {
    name: 'weather',
    available: () => mirrors.length > 0,
    pre(ctx: FrameCtx) {
      const b = ctx.basis;
      // fog.end is the Detail distance (the game's cull radius) since fog was removed (Task 17 part 2d).
      const radius = Math.max(256, Math.min(fog.end, tune.radiusTiles * 256));
      u.uCamPos.set(b.C); u.uCamF.set(b.F); u.uCamR.set(b.R); u.uCamU.set(b.U);
      u.uFpx = b.fpx; u.uCenter[0] = b.cx0; u.uCenter[1] = b.cy0; u.uNear = ctx.params.near;
      u.uRadius = radius; u.uThinPx = tune.thinTiles * 256; u.uStandScale = tune.standScale;
      CU.update();
      const w = fadeWeight(ctx.params.pitch);
      const overPitch = ctx.params.pitch >= OVER_PITCH;
      let bolt: BoltSource | null = null;
      let boltAlpha = 0;
      for (let i = mirrors.length - 1; i >= 0; i--) {
        const m = mirrors[i]!.game.destroyed ? mirrors[i]! : sync(i);
        if (!m) continue;
        const on = !m.game.destroyed && ctx.ov.gameValue<boolean>('visible', m.game);
        if (!m.game.destroyed) ctx.ov.put('visible', m.game, false);
        let mode: WeatherMode = on && tune.on ? weatherModeOf(keyOf(m)) : 'flat';
        if (mode === 'bolts' && !m.bolt) mode = 'stand'; // hash regex drift: the storm stands in the mesh instead
        m.last = mode;
        const bl = weatherBlend(mode, w, overPitch);
        const mu = m.mode.uniforms as unknown as ModeUniforms;
        const foot = vecAt(gameUniforms(m), 'uFrameSizePx', 1) ?? 256;
        if (mu.uStand !== bl.stand || mu.uFlatAlpha !== bl.flatAlpha || mu.uFootPx !== foot) {
          mu.uStand = bl.stand; mu.uFlatAlpha = bl.flatAlpha; mu.uFootPx = foot;
          m.mode.update();
        }
        const parent = bl.overWorld ? s.weather : s.ground;
        if (m.mesh.parent !== parent) parent.addChild(m.mesh);
        const vis = on && bl.flatAlpha > 0;
        if (m.mesh.visible !== vis) m.mesh.visible = vis;
        if (mode === 'bolts' && !bolt) { bolt = m.bolt; boltAlpha = bl.boltAlpha; }
      }
      bolts.update(ctx, bolt, boltAlpha, radius);
      // Without a mirror (drift, or a mesh the game added later) a Weather child would draw in 2D screen space.
      for (const c of s.weather.children) if (!handled.has(c)) ctx.ov.put('visible', c, false);
    },
    drop() { for (const m of mirrors) m.mesh.visible = false; bolts.drop(); },
    destroy() {
      for (const m of mirrors) dispose(m);
      mirrors.length = 0;
      bolts.destroy();
    },
    stats: () => ({
      mirrors: mirrors.length, modes: mirrors.map((m) => m.last).join(','), keys: mirrors.map((m) => m.key ?? '-').join(','), fadeOk, ...bolts.stats(),
    }),
  };
}
