import { recordProbe } from '../../diagnostics/perfMonitor';
import { camera3dDiag } from './diagnostics';
import { chainMatrix } from './frame/drawn';
import { createFrameRunner, type FrameRunner, type Pass } from './frame/frame';
import { createOverrides, type Overrides } from './frame/overrides';
import { ensureRenderHook, type StageHandler } from './frame/renderHook';
import type { XY } from './math/camera';
import { sortYOf } from './math/depth';
import type { CameraView } from './math/zoomCurve';
import type { GroundTracker } from './scene/ground';
import type { Caps, Node3 } from './types';

export interface ViewSourceInput { W: number; H: number; k: number; viewCentre: XY; ground: XY | null; now: number }
export type ViewSource = (i: ViewSourceInput) => CameraView | null;
export interface FrameInfo { jsMs: number; renderMs: number; frameNo: number }
export interface RuntimeStats { live: boolean; fails: number; disabled: boolean; frames: number; jsAvg: number; jsP95: number; renderAvg: number; lastErr: string | null; overrides: number }

export interface Runtime {
  readonly caps: Caps;
  readonly ov: Overrides;
  readonly frame: FrameRunner;
  readonly onStage: StageHandler;
  enter(source: ViewSource): boolean;
  exit(reason: string): void;
  isLive(): boolean;
  blockedReason(): string | null;
  onExit(cb: (reason: string) => void): () => void;
  onFrame(cb: (f: FrameInfo) => void): () => void;
  onStageRender(cb: () => void): () => void;
  /** Live frames only: after the 3D render and the 2D restore, timed as frame work. */
  onPostRender(cb: () => void): () => void;
  setPlayerId(id: string | null): void;
  avatar(): Node3 | null;
  ground(): XY | null;
  stats(): RuntimeStats;
  destroy(): void;
}

const MAX_FAILS = 3;
const WATCHDOG_MS = 1000;

export function createRuntime(caps: Caps, passes: readonly Pass[], tracker: GroundTracker): Runtime {
  const { scene } = caps;
  const ov = createOverrides(scene.world);
  const frame = createFrameRunner(caps, ov, passes);
  const exitCbs = new Set<(reason: string) => void>();
  const frameCbs = new Set<(f: FrameInfo) => void>();
  const stageCbs = new Set<() => void>();
  const postCbs = new Set<() => void>();
  const ring = new Float64Array(600);
  let live = false;
  let source: ViewSource | null = null;
  let fails = 0;
  let disabled = false;
  let lastErr: string | null = null;
  let playerId: string | null = null;
  let avatarNode: Node3 | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let frames = 0;
  let renderSum = 0;

  const findAvatar = (): Node3 | null => {
    if (!playerId) return null;
    if (avatarNode && avatarNode.parent === scene.world && !avatarNode.destroyed) return avatarNode;
    const want = `AvatarContainer (${playerId})`;
    avatarNode = scene.world.children.find((c) => c.label === want) ?? null;
    return avatarNode;
  };

  const ground = (): XY | null => {
    const a = findAvatar();
    return a ? { x: a.x, y: tracker.groundY(a, sortYOf(ov.gameValue<number>('zIndex', a), a.y)) } : null;
  };

  const blockedReason = (): string | null => {
    const { camera, world, ground: g, weather } = scene;
    if (camera.children.some((c) => c !== world && c !== g && c !== weather)) return 'camera-overlay';
    if (!findAvatar()) return 'no-avatar';
    return null;
  };

  const exit = (reason: string): void => {
    if (!live) return;
    live = false;
    source = null;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    frame.drop();
    for (const cb of exitCbs) {
      try { cb(reason); } catch { /* isolate listeners */ }
    }
  };

  const fail = (phase: string, e: unknown): void => {
    fails++;
    lastErr = String((e as { stack?: unknown })?.stack ?? e).slice(0, 400);
    camera3dDiag.warnFeature('QPM-CAM3D-003', { phase, n: fails }, e);
    exit(`error:${phase}`);
    if (fails >= MAX_FAILS && !disabled) {
      disabled = true;
      camera3dDiag.diag.info('QPM-CAM3D-004', { fails });
    }
  };

  const armWatchdog = (): void => {
    if (watchdog) clearTimeout(watchdog);
    watchdog = setTimeout(() => {
      watchdog = null;
      if (!live || document.visibilityState !== 'visible') return;
      const r = ensureRenderHook();
      if (r === 'rewrapped') camera3dDiag.diag.info('QPM-CAM3D-002', { hook: 'render' });
      else if (r === 'absent') exit('hook-lost');
    }, WATCHDOG_MS);
  };

  const readView = (): CameraView | null => {
    if (!source || blockedReason()) return null;
    const W = scene.renderer.screen.width, H = scene.renderer.screen.height;
    const m = chainMatrix(scene.camera);
    if (!m) return null;
    const inv = m.clone().invert();
    const vc = inv.apply({ x: W / 2, y: H / 2 });
    return source({ W, H, k: m.a, viewCentre: { x: vc.x, y: vc.y }, ground: ground(), now: performance.now() });
  };

  const onStage: StageHandler = (callOriginal) => {
    for (const cb of stageCbs) cb();
    if (!live) return callOriginal();
    const t0 = performance.now();
    const view = readView();
    if (!view) { exit('source'); return callOriginal(); }
    try {
      frame.pre(view, findAvatar());
    } catch (e) {
      frame.post();
      fail('pre', e);
      return callOriginal();
    }
    const tPre = performance.now();
    let failed = false;
    try {
      return callOriginal();
    } catch (e) {
      failed = true;
      frame.post();
      fail('render', e);
      return callOriginal();
    } finally {
      if (!failed) {
        const tRender = performance.now();
        frame.post();
        for (const cb of postCbs) {
          try { cb(); } catch { /* isolate listeners */ }
        }
        const js = (tPre - t0) + (performance.now() - tRender);
        recordProbe('camera3d.frame', js);
        ring[frames % ring.length] = js;
        frames++;
        renderSum += tRender - tPre;
        const info: FrameInfo = { jsMs: js, renderMs: tRender - tPre, frameNo: frame.ctx()?.frameNo ?? 0 };
        for (const cb of frameCbs) {
          try { cb(info); } catch { /* isolate listeners */ }
        }
        armWatchdog();
      }
    }
  };

  return {
    caps, ov, frame, onStage,
    enter(src) {
      if (disabled || blockedReason()) return false;
      source = src;
      if (!live) { live = true; frame.resetEpoch(); }
      return true;
    },
    exit,
    isLive: () => live,
    blockedReason,
    onExit(cb) { exitCbs.add(cb); return () => { exitCbs.delete(cb); }; },
    onFrame(cb) { frameCbs.add(cb); return () => { frameCbs.delete(cb); }; },
    onStageRender(cb) { stageCbs.add(cb); return () => { stageCbs.delete(cb); }; },
    onPostRender(cb) { postCbs.add(cb); return () => { postCbs.delete(cb); }; },
    setPlayerId(id) { playerId = id; avatarNode = null; },
    avatar: findAvatar,
    ground,
    stats() {
      const k = Math.min(frames, ring.length);
      const arr = Array.from(ring.subarray(0, k)).sort((a, b) => a - b);
      return {
        live, fails, disabled, frames,
        jsAvg: k ? arr.reduce((a, b) => a + b, 0) / k : 0,
        jsP95: k ? arr[Math.floor(k * 0.95)]! : 0,
        renderAvg: frames ? renderSum / frames : 0,
        lastErr, overrides: ov.count(),
      };
    },
    destroy() {
      exit('destroy');
      frame.destroy();
      exitCbs.clear(); frameCbs.clear(); stageCbs.clear(); postCbs.clear();
    },
  };
}
