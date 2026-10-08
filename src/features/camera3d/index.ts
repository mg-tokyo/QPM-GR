import { readSync, subscribe } from '../../core/gameState';
import { onPixiCaptureChange } from '../../core/pixiCapture';
import type { PixiBounds } from '../../core/pixiScene';
import { setCamera3dLineSource } from '../../diagnostics/copyPayload';
import { t } from '../../i18n';
import { startGameTextures } from '../../sprite-v2/gameTextures';
import { resolveCapabilities, resolveSystems, sceneNotBuilt } from './capabilities';
import { camera3dDiag, formatCamera3dLine, type Camera3dStatus } from './diagnostics';
import { installCameraRelativeMovement } from './engine/movement';
import { installSlowProbe, type SlowProbe } from './engine/slowProbe';
import { installZoomBridge, type ZoomBridge } from './engine/zoomBridge';
import { chainMatrix, type ScreenMap } from './frame/drawn';
import { removeOverrideAccessors } from './frame/overrides';
import { installRenderHook, uninstallRenderHook } from './frame/renderHook';
import { showCamera3dSlowOffer, showCamera3dWarning } from './hints';
import { installLook } from './input/look';
import { createPicker, type Picker } from './input/picking';
import { installPointerRemap } from './input/remap';
import { InstallStack } from './installStack';
import { applyGraphics, buildPasses, type PassSet } from './passes';
import { createRuntime, type FailGuard, type Runtime } from './runtime';
import { getCamera3dSettings, graphicsPresetOf, onCamera3dSettingsChange } from './settings';
import type { Caps, Node3 } from './types';
import { createViewEmitter, type Camera3dView } from './view';

export {
  getCamera3dSettings, setCamera3dSetting, onCamera3dSettingsChange, markCamera3dHint, resetCamera3dSettings,
  CAMERA3D_DEFAULTS, DETAIL_PRESETS, FOV_RANGE, SENSITIVITY_RANGE,
  FAR_ANIM_MODES, GROUND_LEVELS, WEATHER3D_MODES, GRAPHICS_PRESETS, GRAPHICS_PRESET_NAMES, graphicsPresetOf, applyGraphicsPreset,
} from './settings';
export type { Camera3dSettings, DetailPreset, Ground, Weather3d, GraphicsPreset, GraphicsRows } from './settings';
export type { FarAnim } from './engine/farAnim';
export type { Camera3dView } from './view';

const MAX_FAILS = 3;
const RETRY_MS = 1000;
const REBUILD_PROBES = 30;

let started = false;
let rt: Runtime | null = null;
// The stage whose nodes may carry override pass-throughs, kept past a reinstall that fails.
let accessorStage: object | null = null;
let passSet: PassSet | null = null;
let capsNote = 'not-ready';
// The last probe found no stage, engine or scene yet (not a game change): probeRebuild may try again.
let awaitingScene = false;
let warnedNote = '';
let playerId: string | null = null;
const cleanups: Array<() => void> = [];
let installed = new InstallStack();
let installFault: string | null = null;
let lastRetry = 0;
let fails = 0;
let paused = false;
let zoom: ZoomBridge | null = null;
export const getZoomBridge = (): ZoomBridge | null => zoom;
let picker: Picker | null = null;
export const getCamera3dPicker = (): Picker | null => picker;
let slowProbe: SlowProbe | null = null;
export const getCamera3dSlowProbe = (): SlowProbe | null => slowProbe;
const view = createViewEmitter();
const publishView = (): void => view.publish({ ready: rt !== null, live: rt?.isLive() ?? false, fp: zoom?.state().fp ?? false, paused });
export const getCamera3dView = (): Camera3dView => view.get();
export const onCamera3dViewChange = (cb: (v: Camera3dView) => void): (() => void) => view.on(cb);

// One count per page session (the copy says "until reload"): a reinstall must not reset it. Tripping it removes every
// hook, out of the game call that failed, so the game runs plain 2D.
const guard: FailGuard = {
  fail(phase, e) {
    fails++;
    camera3dDiag.warnFeature('QPM-CAM3D-003', { phase, n: fails }, e);
    if (fails < MAX_FAILS || paused) return;
    paused = true;
    camera3dDiag.diag.info('QPM-CAM3D-004', { fails });
    queueMicrotask(() => {
      teardown('errors');
      showCamera3dWarning(t('feature.camera3d.pausedNotify'));
    });
  },
  paused: () => paused,
};

const call = (off: () => void): void => off();

// A layout found changed after install (the sky band, once the tile textures resolve; A V8). Found inside a 3D frame,
// so 3D is left after it, and only the runtime it was found under is blocked.
function driftFound(owner: Runtime, what: string): void {
  queueMicrotask(() => {
    if (rt !== owner) return;
    const note = `drift:${what}`;
    if (warnedNote !== note) { warnedNote = note; camera3dDiag.warnFeature('QPM-CAM3D-001', { missing: [note] }); }
    owner.block(note, true);
    publishView();
  });
}

/** Every piece lands on `tx` with its undo before the next one starts (undo runs last in, first out). */
function install(tx: InstallStack, caps: Caps): void {
  let owner: Runtime | null = null;
  const onDrift = (what: string): void => { if (owner) driftFound(owner, what); };
  const passes = tx.add('passes', () => buildPasses(caps, tx, getCamera3dSettings(), onDrift), () => { passSet = null; });
  passSet = passes;
  const runtime = tx.add('runtime', () => createRuntime(caps, passes.list, passes.ground, guard), (x) => { x.destroy(); rt = null; });
  rt = runtime;
  owner = runtime;
  accessorStage = caps.scene.stage;
  runtime.setPlayerId(playerId);
  tx.add('render', () => {
    if (!installRenderHook(caps.scene.renderer, caps.scene.stage, runtime.onStage)) throw new Error('camera3d: renderer.render is not a function');
  }, uninstallRenderHook);
  // One unit of pass setup per 2D frame while the detent is engaged (A T2).
  const prewarm = (): boolean => {
    const at = runtime.ground();
    for (const p of passes.list) if (p.warm?.(runtime.ov, at)) return true;
    return false;
  };
  const z = tx.add('zoom', () => installZoomBridge(runtime, prewarm), (x) => { x.uninstall(); zoom = null; });
  zoom = z;
  const p = tx.add('picker', () => createPicker(runtime, passes.floor, passes.isAreaMark), (x) => { x.destroy(); picker = null; });
  picker = p;
  // Undone before the picker it calls, and look before the bridge it calls.
  tx.add('remap', () => installPointerRemap(runtime, p), call);
  tx.add('look', () => installLook(runtime, z), call);
  tx.add('movement', () => installCameraRelativeMovement(runtime), call);
  slowProbe = tx.add('slowProbe', () => installSlowProbe(runtime, z, showCamera3dSlowOffer), (x) => { x.off(); slowProbe = null; }).probe;
  // A lost WebGL context takes the floor bakes with it (render textures have no CPU copy): 2D until it is back, then
  // the next entry rebakes (A R5). PIXI's own canvas listeners, added first, restore its state before ours run.
  tx.add('context', () => {
    const cv = caps.scene.renderer.canvas;
    const lost = (): void => { runtime.block('context-lost', true); publishView(); };
    const restored = (): void => { passes.floor.releaseBakes(); runtime.block('context-lost', false); publishView(); };
    cv.addEventListener('webglcontextlost', lost);
    cv.addEventListener('webglcontextrestored', restored);
    return () => { cv.removeEventListener('webglcontextlost', lost); cv.removeEventListener('webglcontextrestored', restored); };
  }, call);
  tx.add('listeners', () => {
    let lastCheck = 0;
    return [
      // No gameState key reports the replacement (`player` and `position` stayed silent after live reconnects), so 2D
      // stage renders check at most once a second; deferred out of the render call.
      runtime.onStageRender(() => {
        const now = performance.now();
        if (runtime.isLive() || now - lastCheck < 1000) return;
        lastCheck = now;
        queueMicrotask(revalidateSystems);
      }),
      runtime.onExit(() => { queueMicrotask(revalidateSystems); }),
      // Registered after the zoom bridge's exit hook, which resets s, so fp reads false here.
      runtime.onFrame(publishView),
      runtime.onExit(publishView),
    ];
  }, (offs) => { for (const off of offs) off(); });
}

function noteCaps(note: string, missing: string[] | null, cause?: unknown): void {
  capsNote = note;
  if (!missing || warnedNote === note) return;
  warnedNote = note;
  camera3dDiag.warnFeature('QPM-CAM3D-001', { missing }, cause);
}

function tryInstall(): void {
  if (rt || !started || paused || !getCamera3dSettings().enabled) return;
  const tx = new InstallStack(installFault);
  installFault = null;
  try {
    tx.step = 'caps';
    const r = resolveCapabilities();
    awaitingScene = !r.ok && (!r.ready || sceneNotBuilt(r.missing));
    if (!r.ok) {
      noteCaps(r.ready ? `missing:${r.missing.join(',')}` : 'not-ready', r.ready ? r.missing : null);
      return;
    }
    install(tx, r.caps);
  } catch (e) {
    tx.unwind();
    noteCaps(`missing:init:${tx.step}`, [`init:${tx.step}`], e);
    publishView();
    return;
  }
  installed = tx;
  capsNote = 'ok';
  camera3dDiag.publishOk('ready');
  publishView();
}

/** Clears the session error pause and installs again (the settings card's Retry). */
export function retryCamera3d(): void {
  fails = 0;
  paused = false;
  warnedNote = '';
  tryInstall();
  publishView();
}

/** Debug only: the next install throws at `step` (an InstallStack step name, e.g. 'zoom' or 'pass:weather'). */
export function injectCamera3dInstallFault(step: string): string {
  installFault = step;
  teardown('debug-fault');
  tryInstall();
  installFault = null;
  return capsNote;
}

// A room reconnect can replace per-player engine systems (directionalInput, the tap router's movementFallback) while
// the engine object stays (live 2026-10-03, WS 1006): our wraps would sit on dead instances. Reinstall when one was
// replaced; while 3D is live, wait for the exit. A system that is absent for now is not a replacement.
function revalidateSystems(): void {
  if (!rt || rt.isLive()) return;
  let engine: unknown = null;
  try { engine = readSync('quinoaEngine'); } catch { return; }
  const now = resolveSystems(engine);
  if (Array.isArray(now)) return;
  const was = rt.caps.systems;
  if (now.zoomSys === was.zoomSys && now.directionalInput === was.directionalInput && now.mover === was.mover && now.movementFallback === was.movementFallback
    && now.petSystem === was.petSystem && now.activity === was.activity && now.tapRouter === was.tapRouter && now.avatar === was.avatar) return;
  camera3dDiag.diag.info('QPM-CAM3D-002', { hook: 'systems' });
  teardown('systems');
  tryInstall();
}

// The exit listeners still see the reason; then every piece comes off, last installed first. Override accessors stay as
// pass-throughs across exits and scene changes (P20); turning 3D off takes them off too, even after a failed reinstall.
function teardown(reason: string): void {
  rt?.exit(reason);
  installed.unwind();
  if (accessorStage && (reason === 'stop' || reason === 'disabled' || reason === 'errors')) {
    removeOverrideAccessors(accessorStage);
    accessorStage = null;
  }
  publishView();
}

// A probe that ran before the scene was built (Camera/World/Weather absent) gets another go on the next player event
// (A R6). An install that threw does not: it waits for a capture, engine or settings change.
function retryOnPlayer(): void {
  const now = performance.now();
  if (now - lastRetry < RETRY_MS || capsNote.startsWith('missing:init')) return;
  lastRetry = now;
  tryInstall();
}

let rebuildTimer: ReturnType<typeof setTimeout> | null = null;
let rebuildProbes = 0;
const clearRebuildProbe = (): void => { if (rebuildTimer) clearTimeout(rebuildTimer); rebuildTimer = null; rebuildProbes = 0; };
// polling-justified: after a lost WebGL context the game re-creates its renderer and builds the new scene with no event
// (live 2026-10-05: the capture change came before World existed, and an idle room sends no player event), so a capture
// or engine change that finds no scene (no stage or engine, or only scene layers missing) re-probes once a second, for
// at most REBUILD_PROBES seconds.
function probeRebuild(): void {
  if (rebuildTimer || rt || !awaitingScene || rebuildProbes >= REBUILD_PROBES) return;
  rebuildTimer = setTimeout(() => {
    rebuildTimer = null;
    rebuildProbes++;
    tryInstall();
    probeRebuild();
  }, RETRY_MS);
}
const onSceneChange = (reason: string): void => {
  teardown(reason);
  clearRebuildProbe();
  tryInstall();
  probeRebuild();
};

export function startCamera3d(): void {
  if (started) return;
  started = true;
  try {
    camera3dDiag.ensureBusRegistered();
    startGameTextures();
    setCamera3dLineSource(() => formatCamera3dLine(getCamera3dStatus()));
    cleanups.push(onCamera3dSettingsChange((s) => {
      if (passSet) applyGraphics(passSet, s);
      if (s.enabled) tryInstall(); else teardown('disabled');
    }));
    cleanups.push(onPixiCaptureChange(() => { onSceneChange('capture'); }));
    cleanups.push(subscribe('quinoaEngine', () => { onSceneChange('engine'); }));
    cleanups.push(clearRebuildProbe);
    cleanups.push(subscribe('player', (p) => {
      playerId = p && typeof p.id === 'string' ? p.id : null;
      if (!rt) { retryOnPlayer(); return; }
      rt.setPlayerId(playerId);
      revalidateSystems();
    }));
    tryInstall();
  } catch (e) {
    // Called from QPM's boot phases: a camera3d bug must not stop the rest of QPM starting.
    camera3dDiag.warnFeature('QPM-CAM3D-001', { missing: ['start'] }, e);
    stopCamera3d();
  }
}

export function stopCamera3d(): void {
  if (!started) return;
  started = false;
  teardown('stop');
  for (const off of cleanups.splice(0)) {
    try { off(); } catch { /* isolate */ }
  }
  setCamera3dLineSource(null);
  capsNote = 'not-ready';
  awaitingScene = false;
  warnedNote = '';
}

export const getCamera3dRuntime = (): Runtime | null => rt;
export const getCamera3dPasses = (): PassSet | null => passSet;
export const isCamera3dLive = (): boolean => rt?.isLive() ?? false;

export function getCamera3dStatus(): Camera3dStatus {
  const s = getCamera3dSettings();
  const st = rt?.stats();
  const missing = passSet?.scanMissing().length ?? 0;
  return {
    enabled: s.enabled, live: st?.live ?? false, s: zoom?.state().s ?? 0, fp: zoom?.state().fp ?? false, blocked: rt?.blockedReason() ?? null,
    fov: s.fov, firstPerson: s.firstPerson, camMove: s.camMove, invertY: s.invertY,
    gfx: graphicsPresetOf(s), detail: s.detail, farAnim: s.farAnim, ground: s.ground, weather3d: s.weather3d,
    caps: missing ? `${capsNote} tiles-missing:${missing}` : capsNote,
    fails, pickMs: picker && picker.stats().picks ? picker.stats().p95Ms : null, jsMs: st && st.frames ? st.jsAvg : null,
  };
}

/** The console debug API (src/debug/mainApi/lateExposure.ts), loaded on demand: debugApi.ts imports this module. */
export const loadCamera3dDebugApi = async () => (await import('./debugApi')).getCamera3dDebugApi();

/** Gamepad D-pad snap: maps a World node's 2D bounds to where 3D draws it. */
export function mapWorldBoundsFor3d(node: unknown, b: PixiBounds): PixiBounds | null {
  if (!rt || !rt.isLive() || typeof node !== 'object' || node === null) return b;
  const world = rt.caps.scene.world;
  let top = node as Node3 | null;
  while (top && top.parent !== world) top = top.parent;
  if (!top) return b;
  const table = rt.frame.published();
  // A lifted produce unit is drawn on its own ground point, not through its card (A I6).
  let e: ScreenMap | null = null;
  for (let n: Node3 | null = node as Node3; n && n !== world && !e; n = n.parent) e = table.liftFor(n) ?? table.entryFor(n);
  const w2g = chainMatrix(world);
  if (!e || !w2g || !(e.mm > 0)) return null;
  const c = w2g.clone().invert().apply({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const k = w2g.a || 1;
  const w = (b.width / k) * e.mm, h = (b.height / k) * e.mm;
  return { x: e.px + (c.x - e.x) * e.mm - w / 2, y: e.py + (c.y - e.y) * e.mm - h / 2, width: w, height: h };
}
