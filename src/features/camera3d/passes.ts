import { camera3dDiag } from './diagnostics';
import { createViewportPass } from './engine/viewport';
import type { Fog, FrameCtx, Pass } from './frame/frame';
import { createAreaMesh } from './scene/areaMesh';
import { createBuildingPlacer, type PartFade } from './scene/buildings';
import { createDecor } from './scene/decor';
import { createEntityPass, type HeldHandler } from './scene/entities';
import { createFader, gameNodeFade, type Fader } from './scene/fades';
import { createFences } from './scene/fences';
import { placeMask } from './scene/flat';
import { createFloor, type Floor } from './scene/floor';
import { createGroundTracker, type GroundTracker } from './scene/ground';
import { createHorizon } from './scene/horizon';
import { createLayerHandler } from './scene/layers';
import { createLifter } from './scene/lift';
import { scanTiles, type TileScan } from './scene/tileArt';
import { createHeldHandler, defaultViewmodelTune, type ViewmodelTune } from './scene/viewmodel';
import { createWeatherMirror, defaultWeatherTuning, type WeatherTuning } from './scene/weather';
import type { Caps, Node3 } from './types';

export interface PassSet {
  list: Pass[]; floor: Floor; fog: Fog; skip: WeakSet<Node3>; fader: Fader; ground: GroundTracker; scanMissing: () => string[];
  weather: WeatherTuning;
  /** Game area-indicator tiles laid flat on the floor: the picker skips them in their owner's card. */
  isAreaMark: (n: Node3) => boolean;
  held: HeldHandler;
  viewmodel: ViewmodelTune;
}

/** Pass order matters: floor (bakes read the untouched tilemap), then World content (fences before decor: the
 * fence cards fade against this frame's wall fade), then overlays. */
export function buildPasses(caps: Caps): PassSet {
  const fog: Fog = { start: 5500, end: 8500 };
  const skip = new WeakSet<Node3>();
  const floor = createFloor(caps);
  const viewport = createViewportPass(caps, fog);
  // Area tiles in perspective while tilted; its pass runs right after the entity pass that feeds it.
  const areaMesh = createAreaMesh(caps, skip);
  const layers = createLayerHandler(areaMesh);
  const viewmodel = defaultViewmodelTune();
  const held = createHeldHandler(viewmodel, (what) => camera3dDiag.diag.info('QPM-CAM3D-007', { missing: what }), (ctx, owner, lp) => layers.layAreas(ctx, owner, lp));
  const fader = createFader();
  const buildings = createBuildingPlacer(gameNodeFade(fader));
  const ground = createGroundTracker();
  const lifter = createLifter((n) => layers.isLayerNode(n), ground.isAvatar);
  // Tiles and overlay markers (the top-anchored journal polaroid) stand on their base sprite (a bush, a trellis, a
  // decor), avatars on their gliding ground point, a ridden pet on its rider's.
  const standRow = (ctx: FrameCtx, n: Node3, sortY: number, isTile: boolean): number =>
    (isTile || layers.isOverlayNode(n) ? lifter.standRow(ctx, n, sortY) : ground.groundY(n, sortY, ctx.now));
  const billboardFade = gameNodeFade(fader, false);
  // The followed avatar's mount goes with its body: never faded in third person, hidden in first person (its card stands
  // at the eye; live 2026-10-04 it drew at ×12 in front of the lens while riding).
  const fade: PartFade = (ctx, n, key, gx, gy) => {
    if (!ctx.avatar || ground.riderOf(n) !== ctx.avatar) billboardFade(ctx, n, key, gx, gy);
    else if (ctx.hideSelf) ctx.ov.put('alpha', n, 0);
    else ctx.ov.drop('alpha', n);
  };
  const entities = createEntityPass({ skip, buildings, layers, standRow, afterPlace: lifter.afterPlace, fade, placeMask, held });
  let scan: TileScan | null = null;
  const getScan = (): TileScan => { scan = scanTiles(caps.scene.tileData, scan); return scan; };
  const decor = createDecor(caps, skip, fader, getScan);
  const fences = createFences(caps, skip, fader, getScan, (t) => decor.setFenceFade(t));
  const horizon = createHorizon(caps, floor, getScan);
  const weatherTune = defaultWeatherTuning();
  const weather = createWeatherMirror(caps, floor, skip, fog, weatherTune);
  // State-only pass: fades and cached lift scans are forgotten on exit (frame numbers stand still while in 2D).
  const faderPass: Pass = { name: 'fader', pre() { /* state lives in the fader */ }, drop: () => { fader.drop(); lifter.reset(); }, destroy: () => fader.drop() };
  return {
    list: [floor, viewport, entities, areaMesh, fences, decor, weather, horizon, faderPass], floor, fog, skip, fader, ground, scanMissing: () => getScan().missing,
    weather: weatherTune, isAreaMark: (n) => layers.isAreaMark(n), held, viewmodel,
  };
}
