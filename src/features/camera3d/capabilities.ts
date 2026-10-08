import { readSync } from '../../core/gameState';
import { getPixiRefs } from '../../core/pixiCapture';
import { findStageLayer } from '../../core/pixiScene';
import { getCtors } from '../../sprite-v2/utils';
import { getEngineSystem } from '../../utils/quinoaEngine';
import { isRecord } from '../../utils/typeGuards';
import { checkDepthKeys } from './math/depth';
import { checkTileLayout } from './scene/tileArt';
import type { Caps, EngineSystems, Node3, PixiClasses, RendererLike, SceneRefs, TileDataLike } from './types';

export type CapsResult = { ok: true; caps: Caps } | { ok: false; missing: string[]; ready: boolean };

export function ownerOf(ctor: unknown, key: string): unknown {
  for (let c: unknown = ctor; typeof c === 'function'; c = Object.getPrototypeOf(c)) {
    const proto = (c as { prototype?: object }).prototype;
    if (proto && Object.prototype.hasOwnProperty.call(proto, key)) return c;
  }
  return null;
}

const childByLabel = (n: unknown, label: string): Node3 | null => {
  if (!isRecord(n) || !Array.isArray(n.children)) return null;
  return (n.children as Node3[]).find((c) => c.label === label) ?? null;
};

function findNode(root: unknown, pred: (n: Record<string, unknown>) => boolean, maxNodes = 20000): Record<string, unknown> | null {
  const stack: unknown[] = [root];
  let seen = 0;
  while (stack.length && seen++ < maxNodes) {
    const n = stack.pop();
    if (!isRecord(n)) continue;
    if (pred(n)) return n;
    if (Array.isArray(n.children)) for (const c of n.children as unknown[]) stack.push(c);
  }
  return null;
}

export interface SceneParts { camera: Node3 | null; world: Node3 | null; ground: Node3 | null; weather: Node3 | null; tilemap: Node3 | null; tileData: TileDataLike | null }

/** The Camera layers by label and the tilemap by its points buffer, null where absent (no checks). */
export function findSceneParts(stage: unknown): SceneParts {
  const camera = findStageLayer(stage, 'Camera') as Node3 | null;
  const world = childByLabel(camera, 'World'), ground = childByLabel(camera, 'Ground'), weather = childByLabel(camera, 'Weather');
  const tilemap = ground?.children.find((c) => isRecord(c.children?.[0]) && 'pointsBuf' in (c.children[0] as object)) ?? null;
  return { camera, world, ground, weather, tilemap, tileData: tilemap ? (tilemap.children[0] as unknown as TileDataLike) : null };
}

const SCENE_LAYERS = new Set(['camera', 'world', 'ground', 'weather', 'tilemap']);
/** Only scene layers missing (resolveScene's names): the stage exists but the game is still building its scene. */
export const sceneNotBuilt = (missing: readonly string[]): boolean => missing.length > 0 && missing.every((m) => SCENE_LAYERS.has(m));

export function resolveScene(stage: unknown, renderer: unknown, app: unknown): SceneRefs | string[] {
  const missing: string[] = [];
  const { camera, world, ground, weather, tilemap, tileData } = findSceneParts(stage);
  if (!camera) return ['camera'];
  if (!world) missing.push('world');
  if (!ground) missing.push('ground');
  if (!weather) missing.push('weather');
  if (!tilemap) missing.push('tilemap');
  // Layouts the 3D scene reads by position (A V8): a drift draws a broken 3D, so it stays 2D with QPM-CAM3D-001.
  if (tileData && checkTileLayout(tileData.pointsBuf).verdict === 'drift') missing.push('tilemap-layout');
  if (world && checkDepthKeys(world.children).verdict === 'drift') missing.push('depth-keys');
  const r = isRecord(renderer) ? renderer : null;
  const gl = r?.gl;
  if (!isRecord(gl) || typeof gl.texStorage2D !== 'function') missing.push('webgl2');
  // The render hook and the pointer remap wrap these; a drifted shape is 2D with a diagnostic, not a throw at install.
  if (typeof r?.render !== 'function') missing.push('render');
  const ev = r?.events;
  const root = isRecord(ev) ? ev.rootBoundary : null;
  if (!isRecord(ev) || typeof ev.mapPositionToPoint !== 'function' || !isRecord(root) || typeof root.hitTest !== 'function') missing.push('events');
  if (missing.length || !world || !ground || !weather || !tilemap || !tileData) return missing;
  const ticker = isRecord(app) ? app.ticker : null;
  return {
    app: isRecord(app) ? app : {},
    renderer: renderer as RendererLike,
    stage: stage as Node3,
    camera, world, ground, weather, tilemap, tileData,
    ticker: isRecord(ticker) && typeof ticker.maxFPS === 'number' ? (ticker as unknown as SceneRefs['ticker']) : null,
  };
}

export function resolveClasses(app: unknown, renderer: unknown, scene: SceneRefs): PixiClasses | string[] {
  const missing: string[] = [];
  let base: { Sprite?: unknown; Container?: unknown; Texture?: unknown; Rectangle?: unknown } = {};
  try { base = getCtors(app, renderer) as typeof base; } catch { missing.push('sprite'); }
  const Matrix = scene.camera.localTransform?.constructor;
  const g = findNode(scene.world, (n) => typeof n.rect === 'function' && 'context' in n)
    ?? findNode(scene.stage, (n) => typeof n.rect === 'function' && 'context' in n);
  // The Mesh/Shader precedent is a WeatherPatternMesh (present in clear weather); fall back to any stage mesh (spec §9.2).
  const isMesh = (n: unknown): boolean => isRecord(n) && isRecord(n.geometry) && isRecord((n.shader as { glProgram?: unknown } | undefined)?.glProgram);
  const mesh = (scene.weather.children.find(isMesh) ?? findNode(scene.stage, isMesh) ?? null) as Node3 | null;
  const shader = mesh?.shader as { constructor: unknown; glProgram: { constructor: unknown }; groups?: Record<string, { resources?: Record<string, unknown> }> } | undefined;
  const ug = shader ? Object.values(shader.groups ?? {}).flatMap((gr) => Object.values(gr?.resources ?? {})).find((r) => isRecord(r) && r.isUniformGroup === true) : null;
  // literal-list-justified: PIXI class names (PixiClasses interface keys) resolved from live instances; structural, not game data
  const out = {
    Sprite: base.Sprite, Container: base.Container, Texture: base.Texture, Rectangle: base.Rectangle,
    Matrix, Graphics: g?.constructor,
    Mesh: mesh ? ownerOf(mesh.constructor, 'geometry') : null,
    Geometry: mesh ? ownerOf((mesh.geometry as { constructor: unknown }).constructor, 'addAttribute') : null,
    Shader: shader ? ownerOf(shader.constructor, '_buildResourceAccessor') : null,
    GlProgram: shader?.glProgram.constructor ?? null,
    UniformGroup: isRecord(ug) ? (ug as { constructor: unknown }).constructor : null,
  };
  for (const [k, v] of Object.entries(out)) if (typeof v !== 'function') missing.push(k);
  const T = out.Texture as { WHITE?: unknown; EMPTY?: unknown } | undefined;
  if (!T?.WHITE || !T.EMPTY) missing.push('textureStatics');
  if (missing.length) return missing;
  return { ...out, MeshGeometry: resolveMeshGeometry(scene.stage) } as unknown as PixiClasses;
}

// Optional, looked up when first person needs it (live 2026-10-05 v1419: the in-canvas hotbar panel, frame + count badge;
// its slot row alone stops 18 px short of the frame. Responsive: x 132–772, top 201 on 903×303). The held item keeps
// clear of it (A W5); without it, it only stays inside the canvas.
export function resolveHotbar(stage: unknown): Node3 | null {
  const panel = childByLabel(childByLabel(findStageLayer(stage, 'UI'), 'InventoryModal'), 'InventoryContent');
  return panel && typeof panel.getBounds === 'function' ? panel : null;
}

// Optional (live 1411: the hunger bar fill and 311 NineSliceSprites carry one): PIXI's batched mesh geometry, through a
// live instance's prototype. Without it every fence wall draws as a perspective mesh, one draw call each.
export function resolveMeshGeometry(stage: unknown): unknown {
  const geomOf = (n: Record<string, unknown>): unknown => {
    if (isRecord(n.geometry)) return n.geometry;
    if (!isRecord(n._gpuData)) return null;
    for (const d of Object.values(n._gpuData)) {
      if (!isRecord(d)) continue;
      if (isRecord(d.geometry)) return d.geometry;
      if (isRecord(d.batchableMesh) && isRecord(d.batchableMesh.geometry)) return d.batchableMesh.geometry;
    }
    return null;
  };
  let cls: unknown = null;
  findNode(stage, (n) => {
    const g = geomOf(n);
    cls = isRecord(g) ? ownerOf((g as { constructor: unknown }).constructor, 'positions') : null;
    return cls !== null;
  });
  return cls;
}

export function resolveSystems(engine: unknown): EngineSystems | string[] {
  if (!isRecord(engine)) return ['engine'];
  const missing: string[] = [];
  const zoomSys = getEngineSystem(engine, 'zoom') as Record<string, unknown> | null;
  const zoom = isRecord(zoomSys) ? zoomSys.zoom : null;
  // The bridge reads effective/intentTileSize/overrideTileSize on every input (live 2026-10-04: numbers, override null);
  // a renamed overrideTileSize would read as "always blocked" and leave 3D silently dead.
  const zoomOk = isRecord(zoomSys) && isRecord(zoom) && typeof zoom.applyInputZoom === 'function' && typeof zoomSys.shouldBlockZoom === 'function'
    && typeof zoom.effective === 'number' && typeof zoom.intentTileSize === 'number' && 'overrideTileSize' in zoom;
  if (!zoomOk) missing.push('zoom');
  const di = getEngineSystem(engine, 'directionalInput') as Record<string, unknown> | null;
  if (!isRecord(di) || typeof di.updateDirectionState !== 'function' || !Array.isArray(di.keysPressed)) missing.push('directionalInput');
  const router = getEngineSystem(engine, 'worldTapRouter') as Record<string, unknown> | null;
  const mf = isRecord(router) ? router.movementFallback : null;
  if (!isRecord(mf) || typeof mf.isTapInBounds !== 'function') missing.push('worldTapRouter');
  const mv = getEngineSystem(engine, 'movement') as Record<string, unknown> | null;
  // The map's size sizes the floor, the far plane and the cull box.
  const map = isRecord(mv) && isRecord(mv.map) ? (mv.map as { cols?: unknown; rows?: unknown }) : null;
  if (!map || typeof map.cols !== 'number' || typeof map.rows !== 'number') missing.push('movement');
  const pet = getEngineSystem(engine, 'pet') as Record<string, unknown> | null;
  if (!isRecord(pet) || typeof pet.preDraw !== 'function') missing.push('pet');
  if (missing.length) return missing;
  return {
    zoomSys: zoomSys as unknown as EngineSystems['zoomSys'],
    directionalInput: di as unknown as EngineSystems['directionalInput'],
    mover: isRecord(mv) && typeof mv.movePlayer === 'function' ? (mv as unknown as EngineSystems['mover']) : null,
    movementFallback: mf as unknown as EngineSystems['movementFallback'],
    map: (mv as { map: unknown }).map as EngineSystems['map'],
    petSystem: pet as unknown as EngineSystems['petSystem'],
    activity: resolveActivity(engine),
    // Optional (live 2026-10-04 build 1395, 17 claimants; beta 3668 WorldTapRouter.resolveClaimAt): without it a 3D tap
    // on a non-building goes to its foot point even when a claim covers that point in 2D.
    tapRouter: isRecord(router) && typeof router.resolveClaimAt === 'function' ? (router as unknown as EngineSystems['tapRouter']) : null,
    avatar: resolveAvatar(engine),
    clock: typeof engine.lastFrameTimeMs === 'number' ? (engine as unknown as EngineSystems['clock']) : null,
  };
}

// Optional (live 2026-10-05 v1419: getSystem('avatar').views, a Map of AvatarView per player and NPC). Each view is
// shape-checked where it is read (scene/avatarSource.ts).
function resolveAvatar(engine: Record<string, unknown>): EngineSystems['avatar'] {
  const sys = getEngineSystem(engine, 'avatar');
  return isRecord(sys) && sys.views instanceof Map ? (sys as unknown as EngineSystems['avatar']) : null;
}

// Optional: the Automatic-FPS idle throttle (live 2026-10-04 build 1395 at page.rendererScope.performancePolicy; beta
// 3668 PerformancePolicy.ts). Without it 3D still works, at the game's idle rate while you only look around.
function resolveActivity(engine: Record<string, unknown>): EngineSystems['activity'] {
  const page = engine.page;
  const scope = isRecord(page) ? page.rendererScope : null;
  const policy = isRecord(scope) ? scope.performancePolicy : null;
  return isRecord(policy) && typeof policy.notifyActivity === 'function' ? (policy as unknown as EngineSystems['activity']) : null;
}

export function resolveCapabilities(): CapsResult {
  const refs = getPixiRefs();
  let engine: unknown = null;
  try { engine = readSync('quinoaEngine'); } catch { engine = null; }
  if (!refs?.stage || !refs.app || !isRecord(engine)) return { ok: false, missing: ['not-ready'], ready: false };
  const scene = resolveScene(refs.stage, refs.renderer, refs.app);
  if (Array.isArray(scene)) return { ok: false, missing: scene, ready: true };
  const classes = resolveClasses(refs.app, refs.renderer, scene);
  const systems = resolveSystems(engine);
  const missing = [...(Array.isArray(classes) ? classes : []), ...(Array.isArray(systems) ? systems : [])];
  if (Array.isArray(classes) || Array.isArray(systems)) return { ok: false, missing, ready: true };
  return { ok: true, caps: { scene, classes, systems } };
}
