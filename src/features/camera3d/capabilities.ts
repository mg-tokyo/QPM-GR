import { readSync } from '../../core/gameState';
import { getPixiRefs } from '../../core/pixiCapture';
import { findStageLayer } from '../../core/pixiScene';
import { getCtors } from '../../sprite-v2/utils';
import { getEngineSystem } from '../../utils/quinoaEngine';
import { isRecord } from '../../utils/typeGuards';
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

export function resolveScene(stage: unknown, renderer: unknown, app: unknown): SceneRefs | string[] {
  const missing: string[] = [];
  const camera = findStageLayer(stage, 'Camera') as Node3 | null;
  if (!camera) return ['camera'];
  const world = childByLabel(camera, 'World'), ground = childByLabel(camera, 'Ground'), weather = childByLabel(camera, 'Weather');
  if (!world) missing.push('world');
  if (!ground) missing.push('ground');
  if (!weather) missing.push('weather');
  const tilemap = ground?.children.find((c) => isRecord(c.children?.[0]) && 'pointsBuf' in (c.children[0] as object)) ?? null;
  if (!tilemap) missing.push('tilemap');
  const gl = isRecord(renderer) ? (renderer as { gl?: unknown }).gl : null;
  if (!isRecord(gl) || typeof gl.texStorage2D !== 'function') missing.push('webgl2');
  if (missing.length || !world || !ground || !weather || !tilemap) return missing;
  return {
    app: isRecord(app) ? app : {},
    renderer: renderer as RendererLike,
    stage: stage as Node3,
    camera, world, ground, weather, tilemap,
    tileData: tilemap.children[0] as unknown as TileDataLike,
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
  return out as unknown as PixiClasses;
}

export function resolveSystems(engine: unknown): EngineSystems | string[] {
  if (!isRecord(engine)) return ['engine'];
  const missing: string[] = [];
  const zoomSys = getEngineSystem(engine, 'zoom') as Record<string, unknown> | null;
  const zoomOk = isRecord(zoomSys) && isRecord(zoomSys.zoom) && typeof (zoomSys.zoom as { applyInputZoom?: unknown }).applyInputZoom === 'function' && typeof zoomSys.shouldBlockZoom === 'function';
  if (!zoomOk) missing.push('zoom');
  const di = getEngineSystem(engine, 'directionalInput') as Record<string, unknown> | null;
  if (!isRecord(di) || typeof di.updateDirectionState !== 'function') missing.push('directionalInput');
  const router = getEngineSystem(engine, 'worldTapRouter') as Record<string, unknown> | null;
  const mf = isRecord(router) ? router.movementFallback : null;
  if (!isRecord(mf) || typeof mf.isTapInBounds !== 'function') missing.push('worldTapRouter');
  const mv = getEngineSystem(engine, 'movement') as Record<string, unknown> | null;
  if (!isRecord(mv) || !isRecord(mv.map) || typeof (mv.map as { cols?: unknown }).cols !== 'number') missing.push('movement');
  const pet = getEngineSystem(engine, 'pet') as Record<string, unknown> | null;
  if (!isRecord(pet) || typeof pet.preDraw !== 'function') missing.push('pet');
  if (missing.length) return missing;
  return {
    zoomSys: zoomSys as unknown as EngineSystems['zoomSys'],
    directionalInput: di as unknown as EngineSystems['directionalInput'],
    movementFallback: mf as unknown as EngineSystems['movementFallback'],
    map: (mv as { map: unknown }).map as EngineSystems['map'],
    petSystem: pet as unknown as EngineSystems['petSystem'],
  };
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
