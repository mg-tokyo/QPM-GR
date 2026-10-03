import { readSync, subscribe } from '../../core/gameState';
import { onPixiCaptureChange } from '../../core/pixiCapture';
import type { PixiBounds } from '../../core/pixiScene';
import { setCamera3dLineSource } from '../../diagnostics/copyPayload';
import { startGameTextures } from '../../sprite-v2/gameTextures';
import { resolveCapabilities, resolveSystems } from './capabilities';
import { camera3dDiag, formatCamera3dLine, type Camera3dStatus } from './diagnostics';
import { installCameraRelativeMovement } from './engine/movement';
import { applyDetail } from './engine/viewport';
import { installZoomBridge, type ZoomBridge } from './engine/zoomBridge';
import { chainMatrix } from './frame/drawn';
import { installRenderHook, uninstallRenderHook } from './frame/renderHook';
import { installLook } from './input/look';
import { createPicker, type Picker } from './input/picking';
import { installPointerRemap } from './input/remap';
import { buildPasses, type PassSet } from './passes';
import { createRuntime, type Runtime } from './runtime';
import { getCamera3dSettings, onCamera3dSettingsChange } from './settings';
import type { Node3 } from './types';
import { createViewEmitter, type Camera3dView } from './view';

export { getCamera3dSettings, setCamera3dSetting, onCamera3dSettingsChange, markCamera3dHint } from './settings';
export type { Camera3dSettings, DetailPreset } from './settings';
export type { Camera3dView } from './view';

let started = false;
let rt: Runtime | null = null;
let passSet: PassSet | null = null;
let capsNote = 'not-ready';
let warnedNote = '';
let playerId: string | null = null;
const cleanups: Array<() => void> = [];
const addonCleanups: Array<() => void> = [];
let zoom: ZoomBridge | null = null;
export const getZoomBridge = (): ZoomBridge | null => zoom;
let picker: Picker | null = null;
export const getCamera3dPicker = (): Picker | null => picker;
const view = createViewEmitter();
const publishView = (): void => view.publish({ ready: rt !== null, live: rt?.isLive() ?? false, fp: zoom?.state().fp ?? false });
export const getCamera3dView = (): Camera3dView => view.get();
export const onCamera3dViewChange = (cb: (v: Camera3dView) => void): (() => void) => view.on(cb);

function installAddons(runtime: Runtime, passes: PassSet): Array<() => void> {
  const z = installZoomBridge(runtime);
  zoom = z;
  const p = createPicker(runtime, passes.floor, passes.isAreaMark);
  picker = p;
  const offRemap = installPointerRemap(runtime, p);
  const offLook = installLook(runtime, z);
  const offMove = installCameraRelativeMovement(runtime);
  // Cleanup runs in array order: look and movement first (look calls the bridge), then the remap (it destroys the
  // picker), then the zoom bridge.
  return [
    offLook,
    offMove,
    () => { offRemap(); picker = null; },
    () => { z.uninstall(); zoom = null; },
  ];
}

function tryInstall(): void {
  if (rt || !started || !getCamera3dSettings().enabled) return;
  const r = resolveCapabilities();
  if (!r.ok) {
    capsNote = r.ready ? `missing:${r.missing.join(',')}` : 'not-ready';
    if (r.ready && warnedNote !== capsNote) {
      warnedNote = capsNote;
      camera3dDiag.warnFeature('QPM-CAM3D-001', { missing: r.missing });
    }
    return;
  }
  try {
    passSet = buildPasses(r.caps);
    applyDetail(passSet.fog, getCamera3dSettings().detail);
    rt = createRuntime(r.caps, passSet.list, passSet.ground);
  } catch (e) {
    capsNote = 'missing:init';
    camera3dDiag.warnFeature('QPM-CAM3D-001', { missing: ['init'] }, e);
    passSet = null;
    rt = null;
    return;
  }
  capsNote = 'ok';
  rt.setPlayerId(playerId);
  installRenderHook(r.caps.scene.renderer, r.caps.scene.stage, rt.onStage);
  addonCleanups.push(...installAddons(rt, passSet));
  const runtime = rt;
  let lastCheck = 0;
  // No gameState key reports the replacement (`player` and `position` stayed silent after live reconnects), so 2D
  // stage renders check at most once a second; deferred out of the render call.
  addonCleanups.push(runtime.onStageRender(() => {
    const now = performance.now();
    if (runtime.isLive() || now - lastCheck < 1000) return;
    lastCheck = now;
    queueMicrotask(revalidateSystems);
  }));
  addonCleanups.push(runtime.onExit(() => { queueMicrotask(revalidateSystems); }));
  // Registered after the zoom bridge's exit hook, which resets s, so fp reads false here.
  addonCleanups.push(runtime.onFrame(publishView), runtime.onExit(publishView));
  camera3dDiag.publishOk('ready');
  publishView();
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
  if (now.zoomSys === was.zoomSys && now.directionalInput === was.directionalInput && now.movementFallback === was.movementFallback && now.petSystem === was.petSystem) return;
  camera3dDiag.diag.info('QPM-CAM3D-002', { hook: 'systems' });
  teardown('systems');
  tryInstall();
}

function teardown(reason: string): void {
  for (const off of addonCleanups.splice(0)) {
    try { off(); } catch { /* isolate */ }
  }
  if (rt) {
    rt.exit(reason);
    uninstallRenderHook();
    rt.destroy();
    rt = null;
    passSet = null;
  }
  publishView();
}

export function startCamera3d(): void {
  if (started) return;
  started = true;
  camera3dDiag.ensureBusRegistered();
  startGameTextures();
  setCamera3dLineSource(() => (getCamera3dSettings().enabled ? formatCamera3dLine(getCamera3dStatus()) : null));
  cleanups.push(onCamera3dSettingsChange((s) => {
    if (passSet) applyDetail(passSet.fog, s.detail);
    if (s.enabled) tryInstall(); else teardown('disabled');
  }));
  cleanups.push(onPixiCaptureChange(() => { teardown('capture'); tryInstall(); }));
  cleanups.push(subscribe('quinoaEngine', () => { teardown('engine'); tryInstall(); }));
  cleanups.push(subscribe('player', (p) => {
    playerId = p && typeof p.id === 'string' ? p.id : null;
    rt?.setPlayerId(playerId);
    revalidateSystems();
  }));
  tryInstall();
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
    enabled: s.enabled, live: st?.live ?? false, s: zoom?.state().s ?? 0, fp: zoom?.state().fp ?? false, detail: s.detail, caps: missing ? `${capsNote} tiles-missing:${missing}` : capsNote,
    fails: st?.fails ?? 0, pickMs: picker && picker.stats().picks ? picker.stats().p95Ms : null, jsMs: st && st.frames ? st.jsAvg : null,
  };
}

/** Gamepad D-pad snap: maps a World node's 2D bounds to where 3D draws it. */
export function mapWorldBoundsFor3d(node: unknown, b: PixiBounds): PixiBounds | null {
  if (!rt || !rt.isLive() || typeof node !== 'object' || node === null) return b;
  const world = rt.caps.scene.world;
  let top = node as Node3 | null;
  while (top && top.parent !== world) top = top.parent;
  if (!top) return b;
  const table = rt.frame.published();
  let e = null;
  for (let n: Node3 | null = node as Node3; n && n !== world && !e; n = n.parent) e = table.entryFor(n);
  const w2g = chainMatrix(world);
  if (!e || !w2g) return null;
  const c = w2g.clone().invert().apply({ x: b.x + b.width / 2, y: b.y + b.height / 2 });
  const k = w2g.a || 1;
  const w = (b.width / k) * e.mm, h = (b.height / k) * e.mm;
  return { x: e.px + (c.x - e.x) * e.mm - w / 2, y: e.py + (c.y - e.y) * e.mm - h / 2, width: w, height: h };
}
