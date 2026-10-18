import { readSync, writeSync } from '../../core/gameState';
import { recordProbe } from '../../diagnostics/perfMonitor';
import type { GridPosition } from '../../types/gameAtoms';
import type { FollowSource } from './follow';
import type { SpecHandles } from './handles';
import { createFlyTo, panPose2d, stepFlight2d, type Flight2dCtx, type FlightInput, type FlightVel, type FlyTo } from './pose/flight';
import type { PauseReason, SpectatorPose, SpectatorStore } from './state';
import { sameGrid, stepAsideReason, targetKeyFor, type CameraWriteKey } from './stepAside';

// Before the engine's onTick (priority 0, live 1448): the engine reads the target in the same frame.
const BEFORE_ENGINE = 1;
const OWNER_NAME = 'qpm-spectator';
const MAX_DISPLACED = 3;
const COST_EMA = 0.05;
// A waypoint's tile size this close to the zoom shown now is the same zoom: no stepped ease, no intent write.
const SAME_ZOOM_PX = 0.5;

export interface DriverHooks {
  input(): FlightInput;
  /** CSS px per second on screen. */
  speed(): number;
  /** A new step-aside episode (cutscene, tram, foreign). */
  onPause(reason: PauseReason): void;
  /** QPM's capture owner was found removed by someone else; n counts per install. */
  onDisplaced(n: number): void;
  /** Spectating must end (home reached, seat lost, a frame threw): once, from a microtask outside the game's frame. */
  onEnd(reason: string, error?: unknown): void;
  /** WASD dropped the follow where the camera is (S D3). */
  onDetach(): void;
  /** After each step, on the game's frame clock: the director's movement read and timing (S §7). A throw ends spectating. */
  frame?(nowMs: number): void;
}

export interface Driver2d {
  pose(): SpectatorPose;
  /** Average spectator frame cost (ms), null before the first frame. */
  frameMs(): number | null;
  homing(): boolean;
  /** The game's keyboard zoom step: -1 out, +1 in. */
  stepZoom(dir: -1 | 0 | 1): void;
  /** Flies to `home` (input no longer steers), then ends with 'home'. */
  flyHome(home: GridPosition): void;
  /** Fly to the source's point, then stay on it; null leaves the camera where it is, in free cam. */
  setFollowSource(src: FollowSource | null): void;
  /** A waypoint: drops any follow and flies there in free cam; steering or a drag stops it where it is. tileSize eases
   * the game's zoom there (the game clamps it to this window); null keeps the zoom. False while homing, ending, or while
   * the game has the camera. */
  flyTo(p: GridPosition, tileSize: number | null): boolean;
  following(): boolean;
  /** A drag in screen px, applied in free cam on the next frame. */
  panBy(dx: number, dy: number): void;
  uninstall(): void;
}

let tokenSeq = 0;

export function installDriver2d(store: SpectatorStore, hs: SpecHandles, hooks: DriverHooks): Driver2d {
  const { ticker, zoomSys } = hs;
  const zoom = zoomSys.zoom;
  const saved = { atom: readSync('zoomIntent'), intent: zoom.intentTileSize, effective: zoom.effective };
  // The game's own owners have this shape and are removed by token (live 1448); QPM's is removed by identity.
  const owner = { ownerName: OWNER_NAME, token: `${OWNER_NAME}:${++tokenSeq}`, allowMovementKeys: 'none' };
  const start = hs.cameraPoint() ?? readSync('cameraTarget') ?? { x: 0, y: 0 };
  let pose: SpectatorPose = { x: start.x, y: start.y, alt: zoom.effective, yaw: 0, pitch: 0 };
  let vel: FlightVel = { x: 0, y: 0 };
  const key: CameraWriteKey = 'cutsceneCameraTarget';
  let lastWritten: GridPosition | null = null;
  let fly: FlyTo | null = null;
  let home: GridPosition | null = null;
  let follow: FollowSource | null = null;
  let lockOn = false;
  let goTo: GridPosition | null = null;
  // A fly key already held when a waypoint fly starts is the flight before it, not input that cancels the fly.
  let heldAtFly = false;
  let pan = { x: 0, y: 0 };
  let resume = false;
  let paused: PauseReason | null = null;
  let placed = false;
  let displaced = 0;
  let cost: number | null = null;
  let ended = false;
  let installed = true;

  const end = (reason: string, error?: unknown): void => {
    if (ended) return;
    ended = true;
    queueMicrotask(() => { hooks.onEnd(reason, error); });
  };

  const syncOwner = (want: boolean): void => {
    const list = readSync('keyboardCaptureOwners') ?? [];
    const has = list.includes(owner);
    if (want === has) { placed = has; return; }
    if (want && placed) {
      hooks.onDisplaced(++displaced);
      if (displaced >= MAX_DISPLACED) { end('owner-displaced'); return; }
    }
    if (!writeSync('keyboardCaptureOwners', want ? [...list, owner] : list.filter((o) => o !== owner))) {
      throw new Error('spectator: capture owner write refused');
    }
    placed = want;
  };

  const write = (p: GridPosition): void => {
    if (sameGrid(p, lastWritten)) return;
    const v = { x: p.x, y: p.y };
    if (!writeSync(key, v)) throw new Error(`spectator: ${key} write refused`);
    lastWritten = v;
  };
  // Only a value QPM wrote: the game's own writers (cutscene end, the arrival pan) are never overwritten.
  const release = (): void => {
    if (lastWritten && sameGrid(readSync(key), lastWritten)) writeSync(key, null);
    lastWritten = null;
  };

  const dropFollow = (): void => {
    follow = null;
    lockOn = false;
    goTo = null;
    fly = null;
    vel = { x: 0, y: 0 };
  };

  const setPaused = (r: PauseReason | null): void => {
    if (r === paused) return;
    if (r !== null && r !== 'ui' && (paused === null || paused === 'ui')) hooks.onPause(r);
    paused = r;
    store.patch({ paused: r });
  };

  const step = (): void => {
    const presence = readSync('localPresence');
    // Phase A drives the seated cutscene target only; a real spectator's freelook target is Phase C.
    if ((presence ? targetKeyFor(presence) : null) !== key) { end('presence'); return; }
    const ui = zoomSys.shouldBlockZoom();
    // The game's Esc and window keys only work with no capture owner (live 1448), and it blocks world input itself.
    syncOwner(!ui);
    if (ended) return;
    const reason = stepAsideReason({
      cutsceneActive: readSync('activeCutscene') !== null, tramActive: readSync('tramJourney') !== null,
      targetKey: key, targetValue: readSync(key), lastWritten, uiOwnsInput: ui,
    });
    setPaused(reason);
    if (reason !== null && reason !== 'ui') {
      // Let go so the game's camera runs the scene; the tram zoom also waits for a null target (QuinoaCanvas, live 1448).
      release();
      vel = { x: 0, y: 0 };
      fly = null;
      goTo = null;
      resume = true;
      if (home) end('home');
      return;
    }
    const now = ticker.lastTime;
    const input = hooks.input();
    const steer = input.fx !== 0 || input.fy !== 0;
    const drag = pan;
    pan = { x: 0, y: 0 };
    if (follow && !home && steer) { dropFollow(); hooks.onDetach(); }
    // The game's frame time (onTick stamps lastTime + elapsedMS, live 1448): the clock avatars glide on.
    const fp = follow && !home ? follow(now + ticker.elapsedMS) : null;
    const dest = fp ? { ...pose, x: fp.x, y: fp.y, alt: zoom.effective } : null;
    if (home && !fly) fly = createFlyTo(pose, { ...pose, x: home.x, y: home.y }, now);
    else if (resume) {
      const from = hs.cameraPoint() ?? readSync('cameraTarget') ?? pose;
      fly = createFlyTo({ ...pose, x: from.x, y: from.y }, dest ?? pose, now);
      lockOn = false;
      heldAtFly = false;
    } else if (lockOn && dest) {
      fly = createFlyTo(pose, dest, now);
      lockOn = false;
    } else if (goTo) {
      fly = createFlyTo(pose, { ...pose, x: goTo.x, y: goTo.y }, now);
      heldAtFly = steer;
    }
    resume = false;
    goTo = null;
    if (!steer) heldAtFly = false;
    // Any new steering input cancels a fly-to (S §3.1); the fly home cannot be cancelled.
    if (fly && !home && !follow && ((steer && !heldAtFly) || drag.x !== 0 || drag.y !== 0)) {
      pose = fly.at(now);
      fly = null;
    }
    if (fly) {
      // 2D height is the game's zoom (effective is its target at once, live 1448); the fly's height blend is for 3D.
      pose = { ...fly.at(now, home ? undefined : dest ?? undefined), alt: zoom.effective };
      if (fly.done(now)) {
        fly = null;
        if (home) { write(pose); end('home'); return; }
      }
    } else if (dest) {
      pose = dest;
    } else if (follow || lockOn) {
      return;
    } else if (reason === 'ui') {
      vel = { x: 0, y: 0 };
    } else {
      const view = hs.viewSize();
      const ctx: Flight2dCtx = {
        tilePx: zoom.effective, viewW: view.w, viewH: view.h, mapCols: zoom.region.w, mapRows: zoom.region.h,
        speedCssPxPerSec: hooks.speed(),
      };
      if (drag.x !== 0 || drag.y !== 0) {
        pose = { ...panPose2d(pose, drag.x, drag.y, ctx), alt: zoom.effective };
        vel = { x: 0, y: 0 };
      } else {
        const r = stepFlight2d(pose, vel, input, ticker.deltaMS, ctx);
        pose = { ...r.pose, alt: zoom.effective };
        vel = r.vel;
      }
    }
    write(pose);
  };

  const frame = (): void => {
    if (ended) return;
    const t0 = performance.now();
    try {
      step();
      if (!ended) hooks.frame?.(ticker.lastTime);
    } catch (e) { end('error', e); }
    const ms = performance.now() - t0;
    recordProbe('spectator.frame', ms);
    cost = cost === null ? ms : cost + (ms - cost) * COST_EMA;
  };

  // A new engine builds its controller from zoomIntentAtom (live 1448), so after a swap the live one is restored.
  const restoreZoom = (): void => {
    const z = hs.liveZoom() ?? zoom;
    if (z.intentTileSize !== saved.intent) z.setIntent(saved.intent);
    if (readSync('zoomIntent') !== saved.atom) writeSync('zoomIntent', saved.atom);
  };

  const api: Driver2d = {
    pose: () => ({ ...pose }),
    frameMs: () => cost,
    homing: () => home !== null,
    stepZoom(dir) {
      if (dir === 0 || home || ended || zoomSys.shouldBlockZoom()) return;
      try { zoom.stepKeyboard(dir); } catch (e) { end('error', e); }
    },
    setFollowSource(src) {
      if (home || ended) return;
      dropFollow();
      follow = src;
      lockOn = src !== null;
    },
    following: () => follow !== null,
    flyTo(p, tileSize) {
      if (home || ended || (paused !== null && paused !== 'ui') || !Number.isFinite(p.x) || !Number.isFinite(p.y)) return false;
      dropFollow();
      goTo = { x: p.x, y: p.y };
      if (tileSize !== null && tileSize > 0 && Math.abs(tileSize - zoom.effective) >= SAME_ZOOM_PX && !zoom.inputBlocked) {
        try { zoom.applySteppedZoom(tileSize); } catch (e) { end('error', e); }
      }
      return !ended;
    },
    panBy(dx, dy) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy)) return;
      pan = { x: pan.x + dx, y: pan.y + dy };
    },
    flyHome(p) {
      if (home || ended) return;
      home = { x: p.x, y: p.y };
      follow = null;
      lockOn = false;
      fly = null;
      // Eased by the game's stepped-zoom smoothing alongside the fly; uninstall makes it exact.
      if (zoom.intentTileSize !== saved.intent && !zoom.inputBlocked) {
        try { zoom.applySteppedZoom(saved.effective); } catch { /* restored exactly at uninstall */ }
      }
    },
    uninstall() {
      if (!installed) return;
      installed = false;
      ended = true;
      try { ticker.remove(frame, null); } catch { /* the ticker is gone with its app */ }
      try { release(); } catch { /* isolate */ }
      try {
        const list = readSync('keyboardCaptureOwners');
        if (list?.includes(owner)) writeSync('keyboardCaptureOwners', list.filter((o) => o !== owner));
      } catch { /* isolate */ }
      try { restoreZoom(); } catch { /* isolate */ }
    },
  };

  try {
    syncOwner(!zoomSys.shouldBlockZoom());
    ticker.add(frame, null, BEFORE_ENGINE);
  } catch (e) {
    api.uninstall();
    throw e;
  }
  return api;
}
