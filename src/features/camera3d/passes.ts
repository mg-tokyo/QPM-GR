import { getAllInstances, isInstanceTrackerHooked } from '../../rive-engine';
import { resolveHotbar } from './capabilities';
import { camera3dDiag } from './diagnostics';
import { createFarAnim, type FarAnimPass } from './engine/farAnim';
import { DETAIL_RADIUS, applyDetail, createViewportPass } from './engine/viewport';
import type { DetailRadius, FrameCtx, Pass } from './frame/frame';
import type { InstallStack } from './installStack';
import { createAreaMesh } from './scene/areaMesh';
import { createAvatarSource } from './scene/avatarSource';
import { createBuildingPlacer, type PartFade } from './scene/buildings';
import { createCamUniforms } from './scene/camUniforms';
import { createDecor } from './scene/decor';
import { createEntityPass, type HeldHandler } from './scene/entities';
import { createFader, gameNodeFade, type Fader } from './scene/fades';
import { createFences } from './scene/fences';
import { createFlatPlacer, placeMask } from './scene/flat';
import { createFloor, type Floor } from './scene/floor';
import { createGroundTracker, type GroundTracker } from './scene/ground';
import { createHorizon } from './scene/horizon';
import { createLayerHandler } from './scene/layers';
import { createLifter } from './scene/lift';
import { scanTiles, type TileScan } from './scene/tileArt';
import { createHeldHandler, createHotbarProbe, defaultViewmodelTune, type ViewmodelTune } from './scene/viewmodel';
import { createWeatherMirror, defaultWeatherTuning, type WeatherMirror, type WeatherTuning } from './scene/weather';
import type { GraphicsRows } from './settings';
import type { Caps, Node3 } from './types';

export interface PassSet {
  list: Pass[]; floor: Floor; detail: DetailRadius; skip: WeakSet<Node3>; fader: Fader; ground: GroundTracker; scanMissing: () => string[];
  weather: WeatherTuning;
  weatherMirror: WeatherMirror;
  /** Game area-indicator tiles laid flat on the floor: the picker skips them in their owner's card. */
  isAreaMark: (n: Node3) => boolean;
  held: HeldHandler;
  viewmodel: ViewmodelTune;
  farAnim: FarAnimPass;
}

/** Pass order matters: floor (bakes read the untouched tilemap), then World content (fences before decor: the
 * fence cards fade against this frame's wall fade), then overlays. Each pass is destroyed through `tx` (R8: a throw
 * part-way frees the GPU objects and stage nodes of the passes already built). onDrift: a game layout found changed
 * after install (the sky band, once the tile textures resolve). */
export function buildPasses(caps: Caps, tx: InstallStack, gfx: GraphicsRows, onDrift: (what: string) => void): PassSet {
  const own = <P extends Pass>(name: string, make: () => P): P => tx.add(`pass:${name}`, make, (p) => p.destroy());
  const detail: DetailRadius = { px: DETAIL_RADIUS[gfx.detail] };
  const skip = new WeakSet<Node3>();
  // Written first each frame; every 3D program reads the camera from this one group.
  const cam = own('cam', () => createCamUniforms(caps.classes));
  const floor = own('floor', () => createFloor(caps, cam.group));
  const viewport = own('viewport', () => createViewportPass(caps, detail));
  // Area tiles in perspective while tilted; its pass runs right after the entity pass that feeds it.
  const areaMesh = own('areaMesh', () => createAreaMesh(caps, skip, cam.group));
  const layers = createLayerHandler(areaMesh);
  const viewmodel = defaultViewmodelTune();
  const held = createHeldHandler(
    viewmodel, (what) => camera3dDiag.diag.info('QPM-CAM3D-007', { missing: what }), (ctx, owner, lp) => layers.layAreas(ctx, owner, lp),
    createHotbarProbe(() => resolveHotbar(caps.scene.stage)),
  );
  const fader = createFader();
  // Tilted, building decals (the weather-shop rugs) draw in perspective through the area mesh, as ground markers do.
  const buildings = createBuildingPlacer(gameNodeFade(fader), createFlatPlacer(areaMesh));
  const ground = createGroundTracker(createAvatarSource(caps.systems.avatar, (info) => camera3dDiag.diag.info('QPM-CAM3D-009', info)));
  const lifter = createLifter((n) => layers.isLayerNode(n), ground.isAvatar);
  // Tiles and overlay markers (the top-anchored journal polaroid) stand on their base sprite (a bush, a trellis, a
  // decor), avatars on their gliding ground point (with their height above it), a ridden pet on its rider's.
  const standRow = (ctx: FrameCtx, n: Node3, sortY: number, isTile: boolean): number =>
    (isTile || layers.isOverlayNode(n) ? lifter.standRow(ctx, n, sortY) : ground.groundY(n, sortY, ctx.now));
  const billboardFade = gameNodeFade(fader, false);
  // The followed avatar's mount goes with its body: no proximity fade, the push-in fade, hidden in first person (its card
  // stands at the eye; live 2026-10-04 it drew at ×12 in front of the lens while riding).
  const fade: PartFade = (ctx, n, key, gx, gy) => {
    if (!ctx.avatar || ground.riderOf(n) !== ctx.avatar) billboardFade(ctx, n, key, gx, gy);
    else if (ctx.selfAlpha < 1) ctx.ov.put('alpha', n, ctx.selfAlpha * ctx.ov.gameValue<number>('alpha', n));
    else ctx.ov.drop('alpha', n);
  };
  const isSelf = (ctx: FrameCtx, n: Node3): boolean => ctx.avatar !== null && (n === ctx.avatar || ground.riderOf(n) === ctx.avatar);
  // Before the entity pass: it reads the walkers' 2D positions.
  const farAnim = own('farAnim', () => createFarAnim({
    world: caps.scene.world, isSelf,
    each: (fn) => { for (const inst of getAllInstances()) fn(inst.raw); }, tracking: isInstanceTrackerHooked,
    report: (info) => camera3dDiag.diag.info('QPM-CAM3D-011', info),
  }));
  const entities = own('entities', () => createEntityPass({
    skip, buildings, layers, standRow, afterPlace: lifter.afterPlace, fade, placeMask, held, feetHeight: ground.feetH, isSelf,
    standKey: (ctx, n) => lifter.scanOf(ctx, n), isFading: (ctx, n) => fader.isFading(ctx, n),
  }));
  let scan: TileScan | null = null;
  const getScan = (): TileScan => { scan = scanTiles(caps.scene.tileData, scan); return scan; };
  const decor = own('decor', () => createDecor(caps, skip, fader, getScan));
  const fences = own('fences', () => createFences(caps, skip, fader, getScan, (t) => decor.setFenceFade(t), cam.group));
  const horizon = own('horizon', () => createHorizon(caps, floor, getScan, cam.group, onDrift));
  const weatherTune = defaultWeatherTuning();
  const weather = own('weather', () => createWeatherMirror(caps, floor, skip, detail, weatherTune, cam.group));
  // State-only pass: fades and cached lift scans are forgotten on exit (frame numbers stand still while in 2D), and
  // fades of despawned cards go with the rolling passes (A R4).
  const faderPass = own<Pass>('fader', () => ({
    name: 'fader',
    pre(ctx) { if (ctx.reCull || ctx.roll === 0) fader.prune(); },
    drop: () => { fader.drop(); lifter.reset(); },
    destroy: () => fader.drop(),
  }));
  const list: Pass[] = [cam, floor, viewport, farAnim, entities, areaMesh, fences, decor, weather, horizon, faderPass];
  tx.add('compile', () => { for (const p of list) p.compile?.(); }, () => undefined);
  const set: PassSet = {
    list, floor, detail, skip, fader, ground, scanMissing: () => getScan().missing,
    weather: weatherTune, weatherMirror: weather, isAreaMark: (n) => layers.isAreaMark(n), held, viewmodel, farAnim,
  };
  applyGraphics(set, gfx);
  return set;
}

/** The four graphics rows onto a live or new pass set (each lever ignores an unchanged value; a new set starts at High). */
export function applyGraphics(p: PassSet, g: GraphicsRows): void {
  applyDetail(p.detail, g.detail);
  p.farAnim.setMode(g.farAnim);
  p.floor.setGround(g.ground);
  p.weatherMirror.setSimple(g.weather3d === 'simple');
}
