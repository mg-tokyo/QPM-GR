import { findStageLayer } from '../../../core/pixiScene';
import { t } from '../../../i18n';
import { camera3dDiag } from '../diagnostics';
import { RewrapBudget } from '../frame/rewrap';
import { showCamera3dHint } from '../hints';
import { CURVE_KEYS, lookScale, viewForS, type CurveKey } from '../math/zoomCurve';
import type { Runtime, ViewSource } from '../runtime';
import { getCamera3dSettings, onCamera3dSettingsChange } from '../settings';
import type { Node3 } from '../types';
import { ResumeWindow, gameTakesCamera, resumeTarget, type ResumePose } from './resume';
import { Detent, LookState, SState, ZoomInput, classifyZoomInput, type SPhase } from './zoomState';

type ApplyFn = (this: unknown, requested: number, kind: string, ctx?: unknown) => unknown;
type Wrapped = ApplyFn & { __qpmWrapped?: true; __qpmLabel?: string; __qpmRetired?: boolean };

export interface ZoomBridgeState {
  s: number; v: number; target: number; phase: SPhase; fp: boolean; detentEngaged: boolean; yaw: number; pitch: number; resumePending: boolean;
}
export interface ZoomTune { tauMs: number }
export interface ZoomBridge {
  state(): ZoomBridgeState;
  /** 3D runs on the bridge's own view, not the debug camera's. */
  drives(): boolean;
  /** A timed camera move (entry, exit, resume, first-person push or pull) or the spring heading out of 3D. */
  inTimedMove(): boolean;
  look(dYawDeg: number, dPitchDeg: number): void;
  /** Debug tuning (polish Task 3): lasts until the page reloads. */
  tune(t?: Partial<ZoomTune>): ZoomTune;
  uninstall(): void;
}

/** One unit of 3D setup done ahead of entry; true while more remain (the floor bakes, A T2). */
export type Prewarm = () => boolean;

// Every zoom input (wheel, pinch, keyboard/gamepad step) reaches zoom.applyInputZoom (live 2026-10-02). In 3D it
// moves s and the game's intent never changes, so leaving at s = 0 is pixel-exact. In 2D it feeds the detent.
export function installZoomBridge(rt: Runtime, prewarm: Prewarm | null = null): ZoomBridge {
  const sys = rt.caps.systems.zoomSys;
  const z = sys.zoom;
  const host = z as unknown as { applyInputZoom: ApplyFn };
  const detent = new Detent();
  const st = new SState();
  const zin = new ZoomInput();
  const look = new LookState();
  const resume = new ResumeWindow();
  const scratch: CurveKey = { ...CURVE_KEYS[0]! };
  // Read on change, not per frame or per look move (offSettings below).
  let fovDeg = getCamera3dSettings().fov;
  // P4 a: the pose a block found 3D in, kept while its animated exit plays (null: the user was leaving 3D anyway).
  let forced: ResumePose | null = null;
  let forcing = false;
  let kEntry = 0;
  let lastNow = 0;
  let firstFrame = false;
  let warming = false;
  // The game's Automatic FPS drops its ticker to 30 after 4 s with no canvas input; look input never reaches the canvas
  // (look.ts swallows it) and the settle moves no game camera (A S4). Dropped if the policy ever throws.
  let policy = rt.caps.systems.activity;
  const active = (): void => {
    if (!policy) return;
    try { policy.notifyActivity(); } catch { policy = null; }
  };
  let hadOwn = Object.prototype.hasOwnProperty.call(host, 'applyInputZoom');
  let original: ApplyFn = host.applyInputZoom;
  const budget = new RewrapBudget();
  const cutscene = findStageLayer(rt.caps.scene.stage, 'CutsceneRoot') as Node3 | null;
  const tramScrim = findStageLayer(rt.caps.scene.stage, 'TramTravelScrim') as Node3 | null;

  // CutsceneRoot always holds the game's `Cutscene` container (letterbox bars + skip button, hidden while idle; live
  // 2026-10-03, cutscene system in installWorldSystems): a cutscene is playing when one of its parts is visible.
  const inCutscene = (): boolean => cutscene?.children.some((c) => c.visible && c.children.some((g) => g.visible)) ?? false;
  const blocked = (): boolean =>
    gameTakesCamera(z, sys) || z.overrideTileSize !== null || inCutscene() || tramScrim?.visible === true;
  // Touch pinch and Safari gestures request (start size × total scale) while these are set (live 2026-10-04).
  const gestureActive = (): boolean => sys.initialPinchDistance != null || (sys.initialTileSizeOnGesture ?? 0) > 0;

  const poseNow = (): ResumePose | null => {
    const s = resumeTarget(st.phase(), st.target, getCamera3dSettings().firstPerson);
    return s === null ? null : { s, yaw: look.yaw, pitch: look.pitch };
  };

  const source: ViewSource = (i) => {
    // A cutscene or tram animates out instead of cutting (A T5); clearing before the move ends turns it back.
    const isBlocked = blocked();
    if (isBlocked !== forcing) {
      forcing = isBlocked;
      if (isBlocked) { forced = poseNow(); st.forceOut(); }
      else if (forced) { look.yaw = forced.yaw; look.pitch = forced.pitch; st.resume(forced.s); forced = null; }
    }
    if (!getCamera3dSettings().firstPerson) st.leaveFirstPerson();
    st.tick(lastNow ? i.now - lastNow : 0);
    lastNow = i.now;
    if (st.done()) return forcing ? 'blocked' : 'zoomed-out';
    if (kEntry <= 0) kEntry = i.k;
    if (st.moving()) active();
    look.settle(st.s, scratch);
    return viewForS({ s: st.s, W: i.W, H: i.H, k: kEntry, viewCentre: i.viewCentre, ground: i.ground, groundH: i.ground?.h ?? 0, userYawDeg: look.yaw, userPitchDeg: look.pitch, fovDeg, far: i.far });
  };

  // The entry move's clock starts once the first 3D frame (s = 0, the 2D image) has drawn: that frame's own cost never
  // eats into the move (A T2).
  const afterFrame = (): void => {
    if (!firstFrame) return;
    firstFrame = false;
    st.startClock();
    lastNow = performance.now();
  };

  // pose: back from a forced exit (P4 a) to where 3D was, heading included (A T6); no detent, no hint.
  const enter = (pose: ResumePose | null = null): void => {
    if (!getCamera3dSettings().enabled) return;
    resume.clear();
    if (pose) st.resume(pose.s); else st.start();
    kEntry = 0;
    lastNow = 0;
    firstFrame = true;
    warming = false;
    forced = null;
    forcing = false;
    if (pose) { look.yaw = pose.yaw; look.pitch = pose.pitch; } else look.reset();
    if (!rt.enter(source)) { st.reset(); firstFrame = false; return; }
    if (!pose) showCamera3dHint('firstEntry', () => t('feature.camera3d.hint.firstEntry'));
  };

  const make = (inner: ApplyFn): Wrapped => {
    const w: Wrapped = function (this: unknown, requested: number, kind: string, ctx?: unknown): unknown {
      if (w.__qpmRetired) return inner.call(this, requested, kind, ctx);
      // Runs inside the game's wheel/key/pinch handler: our errors leave 3D, never the game's call. A 3D input that
      // failed is dropped, so the game's zoom intent never changes under 3D.
      if (rt.isLive()) {
        if (forcing) return undefined;
        try {
          const n = zin.notches(classifyZoomInput(kind, ctx, gestureActive()), requested, z.effective);
          st.input(n, getCamera3dSettings().firstPerson, performance.now());
        } catch (e) { rt.fail('zoom', e); }
        return undefined;
      }
      let n = 0;
      try { n = zin.notches(classifyZoomInput(kind, ctx, gestureActive()), requested, z.effective); } catch (e) { rt.fail('zoom', e); }
      const before = z.intentTileSize;
      const r = inner.call(this, requested, kind, ctx);
      try {
        const changed = z.intentTileSize !== before;
        const clamped = n > 0 && !changed && z.overrideTileSize === null && !sys.shouldBlockZoom();
        const enters = getCamera3dSettings().enabled && detent.input(performance.now(), n, clamped, changed);
        if (enters) enter();
        else if (clamped) {
          // Any push at max zoom, including the gesture that reached it (which never enters, D1): that is where people
          // got stuck (A U2). The 2D view stands still at the clamp, so a bake per frame there is invisible.
          showCamera3dHint('detent', () => t('feature.camera3d.hint.detent'));
          warming = prewarm !== null;
        }
      } catch (e) { rt.fail('zoom', e); }
      return r;
    };
    w.__qpmWrapped = true;
    w.__qpmLabel = 'camera3d.zoom';
    return w;
  };
  let wrapper = make(original);
  host.applyInputZoom = wrapper;

  const ensure = (): void => {
    if (zin.inGesture() && !gestureActive()) zin.endGesture();
    // Cleared first: a throwing unit must not repeat every 2D frame (three strikes would pause 3D for the session).
    if (warming && prewarm && !rt.isLive()) { warming = false; warming = prewarm(); }
    // Only while a resume waits (≤ RESUME_WINDOW_MS): the block clearing has no event of its own (cutscene camera, cutscene
    // bars, tram scrim).
    if (resume.pending() && !rt.isLive()) {
      const pose = resume.take(performance.now(), !blocked() && rt.blockedReason() === null, z.intentTileSize);
      if (pose) enter(pose);
    }
    if (host.applyInputZoom === wrapper) return;
    const b = budget.take(performance.now());
    if (b === 'capped') rt.hookFight('applyInputZoom');
    if (b !== 'ok') return;
    wrapper.__qpmRetired = true;
    hadOwn = Object.prototype.hasOwnProperty.call(host, 'applyInputZoom');
    original = host.applyInputZoom;
    wrapper = make(original);
    host.applyInputZoom = wrapper;
    camera3dDiag.diag.info('QPM-CAM3D-002', { hook: 'applyInputZoom' });
  };
  const offStage = rt.onStageRender(ensure);
  const offPost = rt.onPostRender(afterFrame);
  const offExit = rt.onExit((reason) => {
    // QPM's own Battleship / Tower Defense layers under Camera cut 3D (runtime 'camera-overlay'), but come back too. One
    // that cuts a forced exit short keeps the pose that exit saved (poseNow() reads the exit as "leaving").
    const pose = reason === 'blocked' || (reason === 'camera-overlay' && forcing) ? forced : reason === 'camera-overlay' ? poseNow() : null;
    if (pose) resume.arm(pose, performance.now(), z.intentTileSize);
    else resume.clear();
    forced = null;
    forcing = false;
    st.reset(); detent.reset(); zin.endGesture(); firstFrame = false; warming = false;
  });
  // A new FOV re-culls on the next frame: epochKey only buckets fov by 5°.
  const offSettings = onCamera3dSettingsChange((n) => {
    if (n.fov === fovDeg) return;
    fovDeg = n.fov;
    rt.frame.resetEpoch();
  });

  return {
    state: () => ({
      s: st.s, v: st.v, target: st.target, phase: st.phase(), fp: st.s >= 1, detentEngaged: detent.engaged(), yaw: look.yaw, pitch: look.pitch,
      resumePending: resume.pending(),
    }),
    drives: () => rt.drivenBy(source),
    inTimedMove: () => st.phase() !== 'spring',
    look(dYaw, dPitch) {
      active();
      const k = lookScale(st.s, fovDeg, scratch);
      look.input(dYaw * k, dPitch * k, st.s, scratch);
    },
    tune(tn) {
      if (tn?.tauMs !== undefined && tn.tauMs >= 5 && tn.tauMs <= 500) st.tauMs = tn.tauMs;
      return { tauMs: st.tauMs };
    },
    uninstall() {
      offSettings();
      offStage();
      offPost();
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
