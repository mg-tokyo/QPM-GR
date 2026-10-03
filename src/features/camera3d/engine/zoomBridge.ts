import { notify } from '../../../core/notifications';
import { findStageLayer } from '../../../core/pixiScene';
import { t } from '../../../i18n';
import { camera3dDiag } from '../diagnostics';
import { S_LAST_THIRD, viewForS, wrapDeg } from '../math/zoomCurve';
import type { Runtime, ViewSource } from '../runtime';
import { getCamera3dHints, getCamera3dSettings, markCamera3dHint } from '../settings';
import type { Node3 } from '../types';
import { Detent, SState } from './zoomState';

type ApplyFn = (this: unknown, requested: number, kind: string, ctx?: unknown) => unknown;
type Wrapped = ApplyFn & { __qpmWrapped?: true; __qpmLabel?: string; __qpmRetired?: boolean };

export interface ZoomBridgeState { s: number; target: number; fp: boolean; detentEngaged: boolean }
export interface ZoomBridge { state(): ZoomBridgeState; look(dYawDeg: number, dPitchDeg: number): void; uninstall(): void }

// Every zoom input (wheel, pinch, keyboard/gamepad step) reaches zoom.applyInputZoom (live 2026-10-02). In 3D it
// moves s and the game's intent never changes, so leaving at s = 0 is pixel-exact. In 2D it feeds the detent.
export function installZoomBridge(rt: Runtime): ZoomBridge {
  const sys = rt.caps.systems.zoomSys;
  const z = sys.zoom;
  const host = z as unknown as { applyInputZoom: ApplyFn };
  const detent = new Detent();
  const st = new SState();
  const look = { yaw: 0, pitch: 0 };
  let kEntry = 0;
  let lastNow = 0;
  let cullS = -1;
  let cullPitch = 0;
  let hadOwn = Object.prototype.hasOwnProperty.call(host, 'applyInputZoom');
  let original: ApplyFn = host.applyInputZoom;
  const cutscene = findStageLayer(rt.caps.scene.stage, 'CutsceneRoot') as Node3 | null;
  const tramScrim = findStageLayer(rt.caps.scene.stage, 'TramTravelScrim') as Node3 | null;

  // CutsceneRoot always holds the game's `Cutscene` container (letterbox bars + skip button, hidden while idle; live
  // 2026-10-03, cutscene system in installWorldSystems): a cutscene is playing when one of its parts is visible.
  const inCutscene = (): boolean => cutscene?.children.some((c) => c.visible && c.children.some((g) => g.visible)) ?? false;
  const blocked = (): boolean =>
    sys.shouldBlockZoom() || z.overrideTileSize !== null || inCutscene() || tramScrim?.visible === true;

  const source: ViewSource = (i) => {
    if (blocked()) return null;
    if (!getCamera3dSettings().firstPerson && st.target >= 1) { st.target = S_LAST_THIRD; st.s = S_LAST_THIRD; }
    st.tick(lastNow ? i.now - lastNow : 16);
    lastNow = i.now;
    if (st.done()) return null;
    if (kEntry <= 0) kEntry = i.k;
    // The frame runner re-culls everything only on its own view buckets (frame.ts epochKey); a curve or look-pitch move
    // inside one kept stale visibility (live: 481 shown vs 564 fresh at s 0.24). Re-cull per 0.02 s, 5° pitch, settle.
    if (Math.abs(st.s - cullS) >= 0.02 || (st.s === st.target && st.s !== cullS) || Math.abs(look.pitch - cullPitch) >= 5) {
      cullS = st.s;
      cullPitch = look.pitch;
      rt.frame.resetEpoch();
    }
    return viewForS({ s: st.s, W: i.W, H: i.H, k: kEntry, viewCentre: i.viewCentre, ground: i.ground, userYawDeg: look.yaw, userPitchDeg: look.pitch });
  };

  const hint = (key: 'detent' | 'firstEntry', msg: () => string): void => {
    if (getCamera3dHints()[key]) return;
    markCamera3dHint(key);
    notify({ feature: 'camera3d', level: 'info', message: msg() });
  };

  const enter = (ln: number): void => {
    if (!getCamera3dSettings().enabled) return;
    st.start(ln);
    kEntry = 0;
    lastNow = 0;
    cullS = -1;
    look.yaw = 0;
    look.pitch = 0;
    if (!rt.enter(source)) { st.s = 0; st.target = 0; return; }
    hint('firstEntry', () => t('feature.camera3d.hint.firstEntry'));
  };

  const make = (inner: ApplyFn): Wrapped => {
    const w: Wrapped = function (this: unknown, requested: number, kind: string, ctx?: unknown): unknown {
      if (w.__qpmRetired) return inner.call(this, requested, kind, ctx);
      const eff = z.effective;
      const ln = eff > 0 && requested > 0 ? Math.log(requested / eff) : 0;
      if (rt.isLive()) { st.input(ln, getCamera3dSettings().firstPerson); return undefined; }
      const before = z.intentTileSize;
      const r = inner.call(this, requested, kind, ctx);
      const changed = z.intentTileSize !== before;
      const clamped = ln > 0 && !changed && z.overrideTileSize === null && !sys.shouldBlockZoom();
      const enters = getCamera3dSettings().enabled && detent.input(performance.now(), ln, clamped, changed);
      if (detent.engaged()) hint('detent', () => t('feature.camera3d.hint.detent'));
      if (enters) enter(ln);
      return r;
    };
    w.__qpmWrapped = true;
    w.__qpmLabel = 'camera3d.zoom';
    return w;
  };
  let wrapper = make(original);
  host.applyInputZoom = wrapper;

  const ensure = (): void => {
    if (host.applyInputZoom === wrapper) return;
    wrapper.__qpmRetired = true;
    hadOwn = Object.prototype.hasOwnProperty.call(host, 'applyInputZoom');
    original = host.applyInputZoom;
    wrapper = make(original);
    host.applyInputZoom = wrapper;
    camera3dDiag.diag.info('QPM-CAM3D-002', { hook: 'applyInputZoom' });
  };
  const offStage = rt.onStageRender(ensure);
  const offExit = rt.onExit(() => { st.s = 0; st.target = 0; detent.reset(); });

  return {
    state: () => ({ s: st.s, target: st.target, fp: st.s >= 1, detentEngaged: detent.engaged() }),
    look(dYaw, dPitch) {
      look.yaw = wrapDeg(look.yaw + dYaw);
      look.pitch = Math.min(70, Math.max(-60, look.pitch + dPitch));
    },
    uninstall() {
      offStage();
      offExit();
      if (host.applyInputZoom === wrapper) {
        if (hadOwn) host.applyInputZoom = original;
        else delete (host as unknown as Record<string, unknown>).applyInputZoom;
      } else {
        wrapper.__qpmRetired = true;
      }
    },
  };
}
