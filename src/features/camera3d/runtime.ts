import { recordProbe } from '../../diagnostics/perfMonitor';
import { camera3dDiag } from './diagnostics';
import { chainMatrix } from './frame/drawn';
import { createFrameRunner, type FrameRunner, type Pass } from './frame/frame';
import { createOverrides, type Overrides } from './frame/overrides';
import { ensureRenderHook, type StageHandler } from './frame/renderHook';
import { TILE } from './constants';
import type { XY } from './math/camera';
import { sortYOf } from './math/depth';
import { StepFollower, type FollowStats, type FollowTune } from './math/follow';
import { farPlaneFor, type CameraView } from './math/zoomCurve';
import type { GroundTracker } from './scene/ground';
import type { Caps, Mat, Node3 } from './types';

/** The followed avatar's ground point and `h`, the height the camera rises by (the surface it stands on, the saddle). */
export interface GroundPoint extends XY { h: number }
/** The camera-steered walk (engine/movement.ts): the planned point, px from the centre of `tile`, while the last steered
 * step landed there and its keys are still down. */
export interface SteerSource { offsetAt(tile: XY, out: XY): boolean }
export interface WalkStats extends FollowTune, FollowStats { shiftX: number; shiftY: number }
/** ground: the steady follow point (P16 a), the game's own at rest. far: the far plane for this map (farPlaneFor). */
export interface ViewSourceInput { W: number; H: number; k: number; viewCentre: XY; ground: GroundPoint | null; now: number; far: number }
/** A string leaves 3D with that exit reason (e.g. 'blocked', 'zoomed-out'). requiresAvatar false (the spectator, S §5.1):
 * runs without your avatar and follows setFollow's, or none; absent or true, it needs yours and follows it. */
export interface ViewSource { (i: ViewSourceInput): CameraView | string; readonly requiresAvatar?: boolean }
export interface FrameInfo { jsMs: number; renderMs: number; frameNo: number }
export interface RuntimeStats { live: boolean; frames: number; jsAvg: number; jsP95: number; renderAvg: number; lastErr: string | null; lastExit: string | null; overrides: number }
/** Session-wide failure count (index.ts): a reinstall must not reset it. */
export interface FailGuard { fail(phase: string, e: unknown): void; paused(): boolean }

export interface Runtime {
  readonly caps: Caps;
  readonly ov: Overrides;
  readonly frame: FrameRunner;
  readonly onStage: StageHandler;
  enter(source: ViewSource): boolean;
  /** Whether `source` is the one driving 3D now (the zoom bridge's, or the debug camera's). */
  drivenBy(source: ViewSource): boolean;
  exit(reason: string): void;
  /** A camera3d error inside a game call: leave 3D, count it toward the session guard. */
  fail(phase: string, e: unknown): void;
  isLive(): boolean;
  /** Why `src` (default: the source driving now, else the normal camera) can't run. */
  blockedReason(src?: ViewSource): string | null;
  /** While on, 3D is left and refused with `reason` as the exit and blocked reason (a lost WebGL context, A R5). */
  block(reason: string, on: boolean): void;
  /** Another script keeps replacing `hook` (A R7): one diagnostic, then 3D stays off until the next install. */
  hookFight(hook: string): void;
  onExit(cb: (reason: string) => void): () => void;
  onFrame(cb: (f: FrameInfo) => void): () => void;
  onStageRender(cb: () => void): () => void;
  /** Live frames only: after the 3D render and the 2D restore, timed as frame work. */
  onPostRender(cb: () => void): () => void;
  /** Your own player id. */
  setPlayerId(id: string | null): void;
  /** The avatar a source without the avatar requirement follows (a player id; null: none) until 3D is left. A source
   * that needs your avatar always follows yours. */
  setFollow(id: string | null): void;
  /** Your own avatar. */
  avatar(): Node3 | null;
  /** The avatar 3D follows now (FrameCtx.avatar): yours under the normal camera. */
  followed(): Node3 | null;
  /** The game's own ground point for your avatar (no follow smoothing). */
  ground(): GroundPoint | null;
  setSteer(s: SteerSource | null): void;
  /** Debug tuning (polish Task 17): the follower's timing, until reinstall. */
  walk(t?: Partial<FollowTune>): WalkStats;
  stats(): RuntimeStats;
  destroy(): void;
}

const WATCHDOG_MS = 1000;

export function createRuntime(caps: Caps, passes: readonly Pass[], tracker: GroundTracker, guard: FailGuard): Runtime {
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
  let lastErr: string | null = null;
  let lastExit: string | null = null;
  let failing = false;
  let playerId: string | null = null;
  let avatarNode: Node3 | null = null;
  let watchdog: ReturnType<typeof setTimeout> | null = null;
  let lastFrameAt = 0;
  let frames = 0;
  let renderSum = 0;
  const blocks = new Set<string>();
  const M = caps.classes.Matrix as unknown as new () => Mat;
  const camM = M ? new M() : null, camInv = M ? new M() : null;
  const centre: XY = { x: 0, y: 0 };
  const far = farPlaneFor(caps.systems.map.cols, caps.systems.map.rows);
  const follower = new StepFollower();
  const clock = caps.systems.clock;
  let steer: SteerSource | null = null;
  const followPt: GroundPoint = { x: 0, y: 0, h: 0 };
  const shift: XY = { x: 0, y: 0 };
  const off: XY = { x: 0, y: 0 };
  let tileX = NaN, tileY = NaN;
  // Spectator Task 12: setFollow's player id (null: none), used only while a source without the avatar need drives.
  let followId: string | null = null;
  let followNode: Node3 | null = null;
  let lastFollowed: Node3 | null = null;
  let frameFollowed: Node3 | null = null;

  const needsAvatar = (src: ViewSource | null): boolean => src?.requiresAvatar !== false;
  const inWorld = (n: Node3 | null): n is Node3 => n !== null && n.parent === scene.world && !n.destroyed;
  const avatarOf = (id: string): Node3 | null => {
    const want = `AvatarContainer (${id})`;
    return scene.world.children.find((c) => c.label === want) ?? null;
  };

  const findAvatar = (): Node3 | null => {
    if (!playerId) return null;
    if (inWorld(avatarNode)) return avatarNode;
    avatarNode = avatarOf(playerId);
    return avatarNode;
  };

  // A followed player with no avatar (left, not spawned) is looked for again only once World's child count changes: an
  // arriving avatar is a new child, and a scan per frame walks every World root (thousands).
  let missLen = -1;
  const findFollowed = (): Node3 | null => {
    if (needsAvatar(source) || followId === playerId) return findAvatar();
    if (followId === null) return null;
    if (inWorld(followNode)) return followNode;
    const len = scene.world.children.length;
    if (len === missLen) return null;
    followNode = avatarOf(followId);
    missLen = followNode ? -1 : len;
    return followNode;
  };

  const groundOf = (a: Node3): GroundPoint => {
    const y = tracker.groundY(a, sortYOf(ov.gameValue<number>('zIndex', a), a.y), performance.now());
    return { x: a.x, y, h: tracker.eyeH(a) };
  };
  const ground = (): GroundPoint | null => {
    const a = findAvatar();
    return a ? groundOf(a) : null;
  };

  // P16 a: the camera and the followed avatar follow the step train at one speed (math/follow.ts), not the game's per-step
  // glide. `shift` (followed − game) is what the entity pass moves that avatar and mount by, times tilt, so s = 0 is 2D.
  // Only your own walk is camera-steered.
  const follow = (a: Node3 | null, now: number): GroundPoint | null => {
    shift.x = 0; shift.y = 0;
    if (a !== lastFollowed) { follower.reset(); tileX = NaN; lastFollowed = a; }
    const raw = a ? groundOf(a) : null;
    const tile = raw && a ? tracker.tileOf(a) : null;
    if (!raw || !tile) { follower.reset(); tileX = NaN; return raw; }
    const stepped = tile.x !== tileX || tile.y !== tileY;
    tileX = tile.x; tileY = tile.y;
    const steering = steer !== null && a === avatarNode && steer.offsetAt(tile, off);
    const tx = (tile.x + 0.5) * TILE + (steering ? off.x : 0), ty = (tile.y + 0.5) * TILE + (steering ? off.y : 0);
    follower.update(tx, ty, stepped, steering, raw, now, followPt);
    followPt.h = raw.h;
    shift.x = followPt.x - raw.x; shift.y = followPt.y - raw.y;
    return followPt;
  };

  const blockedReason = (src: ViewSource | null = source): string | null => {
    if (blocks.size > 0) for (const b of blocks) return b;
    const { camera, world, ground: g, weather } = scene;
    if (camera.children.some((c) => c !== world && c !== g && c !== weather)) return 'camera-overlay';
    if (needsAvatar(src) && !findAvatar()) return 'no-avatar';
    return null;
  };

  const exit = (reason: string): void => {
    if (!live) return;
    live = false;
    lastExit = reason;
    source = null;
    if (watchdog) { clearTimeout(watchdog); watchdog = null; }
    follower.reset(); tileX = NaN; shift.x = 0; shift.y = 0;
    followId = null; followNode = null; lastFollowed = null; frameFollowed = null; missLen = -1;
    frame.drop();
    for (const cb of exitCbs) {
      try { cb(reason); } catch (e) { if (!failing) guard.fail('exit', e); }
    }
  };

  // One incident counts once: a listener that throws while a failure exits is part of that failure.
  const fail = (phase: string, e: unknown): void => {
    lastErr = String((e as { stack?: unknown } | null)?.stack ?? e).slice(0, 400);
    failing = true;
    try { exit(`error:${phase}`); } finally { failing = false; }
    guard.fail(phase, e);
  };

  const hookFight = (hook: string): void => {
    camera3dDiag.diag.info('QPM-CAM3D-010', { hook });
    blocks.add('hook-fight');
    exit('hook-fight');
  };

  // Frames stamp the time; one timeout checks it about once a second while live (a clear + set per frame before, A PF4).
  // No 3D frame for WATCHDOG_MS: the render hook was displaced or lost. A hidden page or a fresh re-wrap re-checks: a
  // script that displaces ours again before any 3D frame left 3D "live" with no frames and no check (A R7).
  const checkWatchdog = (): void => {
    watchdog = null;
    if (!live) return;
    const idle = performance.now() - lastFrameAt;
    if (idle < WATCHDOG_MS) { watchdog = setTimeout(checkWatchdog, WATCHDOG_MS - idle); return; }
    if (document.visibilityState !== 'visible') { watchdog = setTimeout(checkWatchdog, WATCHDOG_MS); return; }
    const r = ensureRenderHook(performance.now());
    if (r === 'rewrapped') {
      camera3dDiag.diag.info('QPM-CAM3D-002', { hook: 'render' });
      watchdog = setTimeout(checkWatchdog, WATCHDOG_MS);
    } else if (r === 'capped') hookFight('render');
    else if (r !== 'ok') exit('hook-lost');
  };

  const readView = (): CameraView | string => {
    if (!source) return 'no-source';
    const blocked = blockedReason();
    if (blocked) return blocked;
    const W = scene.renderer.screen.width, H = scene.renderer.screen.height;
    const m = chainMatrix(scene.camera, camM ?? undefined);
    if (!m) return 'no-camera';
    centre.x = W / 2; centre.y = H / 2;
    const vc = (camInv ? camInv.copyFrom(m) : m.clone()).invert().apply(centre);
    const now = performance.now();
    // On the frame's own time (live 2026-10-06: the render call runs 10–15 ms after it, jittering ±3 ms), so a constant
    // speed advances the same distance every displayed frame.
    frameFollowed = findFollowed();
    const g = follow(frameFollowed, clock ? clock.lastFrameTimeMs : now);
    return source({ W, H, k: m.a, viewCentre: { x: vc.x, y: vc.y }, ground: g, now, far });
  };

  // After the 3D draw. A pass post error is thrown after the 2D restore ran, so it only has to leave 3D.
  const finishFrame = (t0: number, tPre: number): void => {
    const tRender = performance.now();
    try { frame.post(); } catch (e) { fail('post', e); return; }
    for (const cb of postCbs) {
      try { cb(); } catch (e) { fail('postRender', e); }
    }
    const js = (tPre - t0) + (performance.now() - tRender);
    recordProbe('camera3d.frame', js);
    ring[frames % ring.length] = js;
    frames++;
    renderSum += tRender - tPre;
    const info: FrameInfo = { jsMs: js, renderMs: tRender - tPre, frameNo: frame.ctx()?.frameNo ?? 0 };
    for (const cb of frameCbs) {
      try { cb(info); } catch (e) { fail('frame', e); }
    }
    lastFrameAt = performance.now();
    if (live && !watchdog) watchdog = setTimeout(checkWatchdog, WATCHDOG_MS);
  };

  // Runs inside the game's renderer.render for every stage frame: nothing may throw out of it (A R2). In 2D the cost is
  // the stage callbacks plus one branch.
  const onStage: StageHandler = (callOriginal) => {
    for (const cb of stageCbs) {
      try { cb(); } catch (e) { fail('stage', e); }
    }
    if (!live) return callOriginal();
    const t0 = performance.now();
    let view: CameraView | string;
    try { view = readView(); } catch (e) { fail('view', e); return callOriginal(); }
    if (typeof view === 'string') { exit(view); return callOriginal(); }
    try {
      frame.pre(view, frameFollowed, shift);
    } catch (e) {
      try { frame.post(); } catch { /* the pre error is the one reported */ }
      fail('pre', e);
      return callOriginal();
    }
    const tPre = performance.now();
    let failed = false;
    try {
      return callOriginal();
    } catch (e) {
      failed = true;
      try { frame.post(); } catch { /* the render error is the one reported */ }
      fail('render', e);
      return callOriginal();
    } finally {
      if (!failed) finishFrame(t0, tPre);
    }
  };

  return {
    caps, ov, frame, onStage,
    enter(src) {
      if (guard.paused() || blockedReason(src)) return false;
      source = src;
      if (!live) {
        live = true;
        frame.resetEpoch();
        // A hook displaced while in 2D gives no first frame to arm the check from.
        lastFrameAt = performance.now();
        watchdog ??= setTimeout(checkWatchdog, WATCHDOG_MS);
      }
      return true;
    },
    drivenBy: (src) => source === src,
    exit,
    fail,
    isLive: () => live,
    blockedReason,
    block(reason, on) {
      if (!on) { blocks.delete(reason); return; }
      blocks.add(reason);
      exit(reason);
    },
    hookFight,
    onExit(cb) { exitCbs.add(cb); return () => { exitCbs.delete(cb); }; },
    onFrame(cb) { frameCbs.add(cb); return () => { frameCbs.delete(cb); }; },
    onStageRender(cb) { stageCbs.add(cb); return () => { stageCbs.delete(cb); }; },
    onPostRender(cb) { postCbs.add(cb); return () => { postCbs.delete(cb); }; },
    setPlayerId(id) { playerId = id; avatarNode = null; },
    setFollow(id) { followId = id; followNode = null; missLen = -1; },
    avatar: findAvatar,
    followed: findFollowed,
    ground,
    setSteer(s) { steer = s; },
    walk(t) {
      const tn = follower.tune;
      if (t?.cadenceMs !== undefined && t.cadenceMs >= 50 && t.cadenceMs <= 400) tn.cadenceMs = t.cadenceMs;
      if (t?.marginMs !== undefined && t.marginMs >= 0 && t.marginMs <= 200) tn.marginMs = t.marginMs;
      if (t?.tauMs !== undefined && t.tauMs >= 5 && t.tauMs <= 300) tn.tauMs = t.tauMs;
      return { ...tn, ...follower.stats(), shiftX: shift.x, shiftY: shift.y };
    },
    stats() {
      const k = Math.min(frames, ring.length);
      const arr = Array.from(ring.subarray(0, k)).sort((a, b) => a - b);
      return {
        live, frames,
        jsAvg: k ? arr.reduce((a, b) => a + b, 0) / k : 0,
        jsP95: k ? arr[Math.floor(k * 0.95)]! : 0,
        renderAvg: frames ? renderSum / frames : 0,
        lastErr, lastExit, overrides: ov.count(),
      };
    },
    /** The passes belong to their PassSet: index.ts destroys them after this. */
    destroy() {
      exit('destroy');
      frame.drop();
      exitCbs.clear(); frameCbs.clear(); stageCbs.clear(); postCbs.clear();
    },
  };
}
