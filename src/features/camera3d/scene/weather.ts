import { getKeysByFrame } from '../../../sprite-v2/gameTextures';
import { TILE } from '../constants';
import { camera3dDiag } from '../diagnostics';
import type { DetailRadius, FrameCtx, Pass } from '../frame/frame';
import type { Overrides } from '../frame/overrides';
import type { Caps, Node3, ShaderLike, UniformGroupLike } from '../types';
import { CAM_RESOURCE } from './camUniforms';
import type { Floor } from './floor';
import { patchWeatherFragment, patchWeatherTall, patchWeatherVertex, stripShaderName } from './shaders';
import { createWeatherBolts, type BoltSource } from './weatherBolts';
import { extractHashFn } from './weatherPhases';
import {
  SLAB_OPEN, parseCellHash, slabCount, slabShift, slabStart, weatherBlend, weatherModeOf, weatherPatchIssues, type CellHash, type WeatherMode,
} from './weatherCells';
import { createSlabSet, type SlabSet } from './weatherSlabs';

// The flat pattern's draw slot: above World at the 2D match (exactKeys: the 2D order, so s = 0 stays exact in rain), on
// the ground under billboards once tilted. Tilted standing weather draws as depth slabs in World (P9, weatherSlabs.ts).

/** Spec §6.8.1 tuning; `on: false` draws every weather flat (the perf A/B). standScale 1 = the art's native size, as
 * the game draws it. slabTiles: the P9 slab depth; 0 draws standing weather over World in one mesh (the A/B).
 * standTiles: the most frames a standing column grows to (1 = the one-frame card, which read as a knee-high band
 * under clear sky, live 10-06). Columns top out at the camera's eye height, so no drop draws over the sky; in first person
 * the ones within nearTiles rise to standTiles. */
export interface WeatherTuning {
  on: boolean; radiusTiles: number; thinTiles: number; standScale: number; slabTiles: number; standTiles: number; nearTiles: number;
}
export const defaultWeatherTuning = (): WeatherTuning => ({
  on: true, radiusTiles: 16, thinTiles: 4, standScale: 1, slabTiles: 2, standTiles: 8, nearTiles: 2,
});

interface Mirror {
  game: Node3; mesh: Node3; shader: ShaderLike; make: (range: UniformGroupLike) => ShaderLike; prog: unknown; vs: string; mode: UniformGroupLike;
  hash: CellHash | null; phased: boolean; tall: boolean; ox: number; oy: number; key: string | null; last: WeatherMode; bolt: BoltSource | null;
  slabs: SlabSet | null; wantSlabs: boolean;
}
interface StandUniforms { uRadius: number; uThinPx: number; uStandScale: number; uSortDir: Float32Array; uNearTall: number; uNearPx: number }
interface ModeUniforms { uStand: number; uFlatAlpha: number; uFootPx: number; uStandTiles: number }
// The game's weather group 99 resource slots, in the order the mirror shader binds them (live 10-02 bind map).
const RES_NAMES = ['weatherUniforms', 'uWeatherTexture', 'uWeatherSampler'] as const;

const gameUniforms = (m: Mirror): Record<string, unknown> => (m.shader.resources.weatherUniforms as UniformGroupLike).uniforms;
const vecAt = (u: Record<string, unknown>, k: string, i: number): number | null => { const v = u[k]; return v instanceof Float32Array && v.length > i ? v[i]! : null; };
const gameResources = (game: Node3): Record<string, unknown> | undefined => (game.shader as ShaderLike | undefined)?.groups?.['99']?.resources;

function takeResources(shader: ShaderLike, res: Record<string, unknown>): boolean {
  let changed = false;
  for (let k = 0; k < RES_NAMES.length; k++) {
    const r = res[String(k)], name = RES_NAMES[k]!;
    if (r && shader.resources[name] !== r) { shader.resources[name] = r; changed = true; }
  }
  return changed;
}

export interface WeatherMirror extends Pass {
  available(): boolean;
  /** The "Weather in 3D" setting's simple mode: standing weather as one mesh over World (no slabs), a storm without bolts. */
  setSimple(on: boolean): void;
}

/** cam: the shared camera uniform group (camUniforms.ts). */
export function createWeatherMirror(
  caps: Caps, floor: Floor, skip: WeakSet<Node3>, detail: DetailRadius, tune: WeatherTuning, cam: UniformGroupLike,
): WeatherMirror {
  const { scene: s, classes: C } = caps;
  const fv = (len: number, type: string) => ({ value: new Float32Array(len), type });
  const f1 = (value: number) => ({ value, type: 'f32' });
  const CU: UniformGroupLike = new C.UniformGroup({
    uRadius: f1(4096), uThinPx: f1(1024), uStandScale: f1(1), uSortDir: fv(2, 'vec2<f32>'), uNearTall: f1(0), uNearPx: f1(2 * TILE),
  });
  const u = CU.uniforms as unknown as StandUniforms;
  const ALL: UniformGroupLike = new C.UniformGroup({ uSlab: { value: new Float32Array([-SLAB_OPEN, SLAB_OPEN]), type: 'vec2<f32>' } });
  const mirrors: Mirror[] = [];
  const handled = new WeakSet<Node3>();
  const unmirrored: Node3[] = [];
  const reported = new Set<string>();
  // Once per drifted piece per install (A W3): each one otherwise degrades without a trace.
  const report = (patch: string): void => {
    if (reported.has(patch)) return;
    reported.add(patch);
    camera3dDiag.diag.info('QPM-CAM3D-006', { patch, mirrors: mirrors.length });
  };
  const bolts = createWeatherBolts(caps, skip, report);
  let fadeOk = true, tallOk = true, simple = false;
  // The game builds its pattern meshes once per weather system (live 1419 WeatherSystem constructor): mirrors follow the
  // Weather container's child events, never a per-frame scan (A W2). Without events, a child-count change stands in.
  const events = typeof s.weather.on === 'function' && typeof s.weather.off === 'function';
  let dirty = false, childCount = -1;
  const onChildren = (): void => { dirty = true; };
  // The slab window every mirror's slabs share: first slab index, view axis, count, depth.
  let k0 = NaN, sdx = NaN, sdz = NaN, slabN = 0, slabPx = 0, reKeys = 0, forced = 0;

  const build = (game: Node3): Mirror | null => {
    const sh = game.shader as ShaderLike | undefined;
    const res = gameResources(game);
    if (!sh?.glProgram || !res || !res['0'] || !res['1'] || !res['2'] || !game.geometry) { report('resources'); return null; }
    const { vertex, fragment } = sh.glProgram;
    const issues = weatherPatchIssues(vertex, fragment);
    for (const p of issues) report(p);
    const vs = patchWeatherVertex(vertex);
    if (!vs) return null;
    const fs = patchWeatherFragment(fragment);
    if (!fs) fadeOk = false;
    const hashFn = extractHashFn(vertex);
    const tallFs = fs && hashFn ? patchWeatherTall(fs, hashFn) : null;
    if (!tallFs) tallOk = false;
    const program = new C.GlProgram({ vertex: vs, fragment: tallFs ?? fs ?? stripShaderName(fragment), name: 'qpm3d-weather' });
    const mode: UniformGroupLike = new C.UniformGroup({ uStand: f1(0), uFlatAlpha: f1(1), uFootPx: f1(TILE), uStandTiles: f1(1) });
    const make = (range: UniformGroupLike): ShaderLike => {
      const cur = gameResources(game) ?? res;
      return new C.Shader({
        glProgram: program,
        resources: {
          weatherUniforms: cur['0'], uWeatherTexture: cur['1'], uWeatherSampler: cur['2'], [CAM_RESOURCE]: cam, qpm3dWeatherCam: CU,
          qpm3dWeatherMode: mode, qpm3dWeatherSlab: range,
        },
      });
    };
    const shader = make(ALL);
    const mesh = new C.Mesh({ geometry: game.geometry, shader, texture: C.Texture.WHITE });
    mesh.label = 'qpm3d-weather';
    mesh.eventMode = 'none';
    mesh.visible = false;
    handled.add(mesh);
    return {
      game, mesh, shader, make, prog: sh.glProgram, vs: vertex, mode, hash: parseCellHash(vertex), phased: !issues.includes('cellHash') || !issues.includes('hashFn'),
      tall: tallFs !== null, ox: NaN, oy: NaN, key: null, last: 'flat', bolt: null, slabs: null, wantSlabs: false,
    };
  };
  const dispose = (m: Mirror): void => {
    m.slabs?.destroy();
    m.slabs = null;
    m.mesh.parent?.removeChild(m.mesh);
    m.mesh.destroy();
    m.shader.destroy(true);
  };

  // A weather change replaces a mesh's geometry (live 2026-10-03, AmberMoon: the mirror kept the destroyed one and
  // every 3D frame threw in checkCompatibility) and can swap its resources or program: follow the game each frame.
  const sync = (i: number): Mirror | null => {
    const m = mirrors[i]!;
    const sh = m.game.shader as ShaderLike | undefined;
    if (sh?.glProgram !== m.prog) {
      dispose(m);
      const next = build(m.game);
      if (!next) { mirrors.splice(i, 1); handled.delete(m.game); unmirrored.push(m.game); return null; }
      mirrors[i] = next;
      return next;
    }
    const g = m.game.geometry;
    const res = gameResources(m.game);
    let changed = false;
    if (g && m.mesh.geometry !== g) { m.mesh.geometry = g; changed = true; }
    if (res && takeResources(m.shader, res)) { m.ox = NaN; changed = true; }
    if (changed && m.slabs) m.slabs.follow(m.mesh.geometry, (shader) => { if (res) takeResources(shader, res); });
    return m;
  };

  const reconcile = (ov: Overrides | null): void => {
    for (let i = mirrors.length - 1; i >= 0; i--) {
      const m = mirrors[i]!;
      if (!m.game.destroyed && m.game.parent === s.weather) continue;
      ov?.drop('visible', m.game);
      handled.delete(m.game);
      dispose(m);
      mirrors.splice(i, 1);
    }
    for (const c of unmirrored) if (c.parent !== s.weather) ov?.drop('visible', c);
    unmirrored.length = 0;
    for (const c of s.weather.children) {
      if (handled.has(c)) continue;
      const m = build(c);
      if (m) { mirrors.push(m); handled.add(c); } else unmirrored.push(c);
    }
    childCount = s.weather.children.length;
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
      m.bolt = m.key && m.phased ? { game: m.game, uniforms: gu, key: m.key, hash: m.hash, vs: m.vs } : null;
    }
    return m.key;
  };

  // The window moves only on a frame World rebuilds anyway (a re-key of every slab is then free), unless it lags two slabs.
  function placeSlabs(ctx: FrameCtx, px: number, radius: number, any: boolean): void {
    if (!any) { for (const m of mirrors) m.slabs?.attach(s.world, false); return; }
    // Slabs past the radius draw at alpha 0: size the set by it (the closest distance, 2600 px, is under 16 tiles).
    const n = slabCount(radius, px);
    let attaching = false;
    for (const m of mirrors) {
      if (m.slabs && m.slabs.n !== n) { m.slabs.destroy(); m.slabs = null; }
      if (m.wantSlabs && !m.slabs) m.slabs = createSlabSet(C, skip, m.make, m.mesh.geometry, n);
      if (m.slabs && m.slabs.on !== m.wantSlabs) attaching = true;
    }
    const rebuilds = ctx.reCull || s.world.renderGroup?.structureDidChange === true;
    const b = ctx.basis;
    const want = slabStart(b.C[0] * ctx.dx + b.C[2] * ctx.dz, px);
    const shift = slabShift(want, n === slabN && px === slabPx ? k0 : NaN, ctx.dx !== sdx || ctx.dz !== sdz, rebuilds || attaching);
    if (shift !== 'keep') {
      k0 = want; sdx = ctx.dx; sdz = ctx.dz; slabN = n; slabPx = px;
      u.uSortDir[0] = ctx.dx; u.uSortDir[1] = ctx.dz;
      reKeys++;
    }
    if (shift === 'forced' || (attaching && !rebuilds)) forced++;
    for (const m of mirrors) {
      if (!m.slabs) continue;
      if (m.wantSlabs) m.slabs.place(k0, px);
      m.slabs.attach(s.world, m.wantSlabs);
    }
  }

  if (events) { s.weather.on!('childAdded', onChildren); s.weather.on!('childRemoved', onChildren); }
  reconcile(null);
  if (mirrors.length === 0) report('none');

  floor.addBakeHooks({
    before() { for (const m of mirrors) m.mesh.visible = false; },
    after() { /* pre() sets visibility again this frame */ },
  });

  return {
    name: 'weather',
    available: () => mirrors.length > 0,
    setSimple(on) { simple = on; },
    pre(ctx: FrameCtx) {
      if (!events && s.weather.children.length !== childCount) dirty = true;
      if (dirty) { dirty = false; reconcile(ctx.ov); }
      // Never past the Detail distance (the game's cull radius): no standing weather where pets and avatars are culled.
      const radius = Math.max(TILE, Math.min(detail.px, tune.radiusTiles * TILE));
      u.uRadius = radius; u.uThinPx = tune.thinTiles * TILE; u.uStandScale = tune.standScale;
      // First person by the push-in fade of your own body: 0 in third person, 1 once it is gone.
      u.uNearTall = 1 - ctx.selfAlpha; u.uNearPx = Math.max(1, tune.nearTiles * TILE);
      const w = ctx.tilt;
      const exact = ctx.exactKeys;
      const px = !simple && tune.slabTiles > 0 ? tune.slabTiles * TILE : 0;
      let bolt: BoltSource | null = null;
      let boltAlpha = 0;
      let anySlabs = false;
      for (let i = mirrors.length - 1; i >= 0; i--) {
        const m = mirrors[i]!.game.destroyed ? mirrors[i]! : sync(i);
        if (!m) continue;
        const on = !m.game.destroyed && ctx.ov.gameValue<boolean>('visible', m.game);
        if (!m.game.destroyed) ctx.ov.put('visible', m.game, false);
        let mode: WeatherMode = on && tune.on ? weatherModeOf(keyOf(m)) : 'flat';
        // Only the first storm mirror gets the bolts; a later one, one without a phase path, or simple mode stands in its mesh.
        if (mode === 'bolts' && (simple || bolt !== null || !m.bolt || !bolts.prepare(m.bolt, ctx.frameNo))) mode = 'stand';
        m.last = mode;
        const bl = weatherBlend(mode, w, exact);
        const mu = m.mode.uniforms as unknown as ModeUniforms;
        const foot = vecAt(gameUniforms(m), 'uFrameSizePx', 1) ?? TILE;
        const tiles = m.tall ? Math.max(1, tune.standTiles) : 1;
        if (mu.uStand !== bl.stand || mu.uFlatAlpha !== bl.flatAlpha || mu.uFootPx !== foot || mu.uStandTiles !== tiles) {
          mu.uStand = bl.stand; mu.uFlatAlpha = bl.flatAlpha; mu.uFootPx = foot; mu.uStandTiles = tiles;
          m.mode.update();
        }
        m.wantSlabs = px > 0 && bl.slabs && on;
        anySlabs ||= m.wantSlabs;
        if (!m.wantSlabs) {
          const parent = bl.overWorld || bl.slabs ? s.weather : s.ground;
          if (m.mesh.parent !== parent) parent.addChild(m.mesh);
        }
        const vis = on && bl.flatAlpha > 0 && !m.wantSlabs;
        if (m.mesh.visible !== vis) m.mesh.visible = vis;
        if (mode === 'bolts' && !bolt) { bolt = m.bolt; boltAlpha = bl.boltAlpha; }
      }
      placeSlabs(ctx, px, radius, anySlabs);
      CU.update();
      bolts.update(ctx, bolt, boltAlpha, radius);
      // Without a mirror (drift) a Weather child would draw in 2D screen space.
      for (const c of unmirrored) if (!c.destroyed) ctx.ov.put('visible', c, false);
    },
    drop() {
      for (const m of mirrors) { m.mesh.visible = false; m.slabs?.attach(s.world, false); }
      k0 = NaN;
      bolts.drop();
    },
    destroy() {
      if (events) { s.weather.off!('childAdded', onChildren); s.weather.off!('childRemoved', onChildren); }
      for (const m of mirrors) dispose(m);
      mirrors.length = 0;
      unmirrored.length = 0;
      bolts.destroy();
    },
    stats: () => {
      let slabs = 0;
      for (const m of mirrors) if (m.slabs?.on) slabs += m.slabs.n;
      return {
        mirrors: mirrors.length, modes: mirrors.map((m) => m.last).join(','), keys: mirrors.map((m) => m.key ?? '-').join(','), fadeOk, tallOk, simple,
        slabs, slabReKeys: reKeys, slabForced: forced, unmirrored: unmirrored.length, ...bolts.stats(),
      };
    },
  };
}
