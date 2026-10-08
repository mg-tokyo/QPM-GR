import { TILE } from '../constants';
import type { XY } from '../math/camera';
import { DIR_OF, STEP_OF, StepPlanner, keyAxes, steerStep, walkHeading, type StepDir } from '../math/walk';
import type { Runtime, SteerSource } from '../runtime';
import { getCamera3dSettings } from '../settings';
import type { DirectionalInputLike, MovementLike } from '../types';

const DIRS: readonly StepDir[] = ['up', 'right', 'down', 'left'];
const KEY_OF: Readonly<Record<StepDir, string>> = { up: 'ArrowUp', right: 'ArrowRight', down: 'ArrowDown', left: 'ArrowLeft' };
// A step later than the game's 300 ms first-step pause plus a frame starts a new walk (and a new heading line).
const NEW_WALK_MS = 400;

/** The camera yaw (radians) snapped to a quarter turn, 0-3. */
export const quarterOf = (yaw: number): number => ((Math.round(yaw / (Math.PI / 2)) % 4) + 4) % 4;

/** Each direction key turned q quarter turns clockwise, as the arrow key the game reads; other keys unchanged. */
export function rotateDirKeys(keys: readonly string[], q: number): string[] {
  return keys.map((k) => {
    const d = DIR_OF[k];
    return d ? KEY_OF[DIRS[(DIRS.indexOf(d) + q) % 4]!] : k;
  });
}

const hasDirKey = (keys: readonly string[]): boolean => {
  for (const k of keys) if (DIR_OF[k] !== undefined) return true;
  return false;
};

export function installCameraRelativeMovement(rt: Runtime): () => void {
  const mover = rt.caps.systems.mover;
  return mover ? installSteering(rt, mover) : installQuarterSnap(rt);
}

type MoveFn = (this: unknown, dir: string, pos: XY) => boolean;
type WrappedMove = MoveFn & { __qpmRetired?: boolean };

// P15 a (M1, M2): while 3D is live, each step the game takes goes along the camera heading. The game still decides when
// (its cadence and 300 ms first-step pause, P17 b) and whether (its own collision check, a mount's mode); QPM only picks
// the direction, inside the game's movePlayer. The direction state keeps the game's value, so the overlay's input check,
// camMove off and leaving 3D mid-walk need nothing.
function installSteering(rt: Runtime, mover: MovementLike): () => void {
  const di = rt.caps.systems.directionalInput;
  const host = mover as unknown as { movePlayer: MoveFn };
  const hadOwn = Object.prototype.hasOwnProperty.call(host, 'movePlayer');
  const orig = host.movePlayer;
  const planner = new StepPlanner();
  const h: XY = { x: 0, y: 0 };
  const axes: XY = { x: 0, y: 0 };
  // The tiles the last two steered steps landed on and their planned points (tiles; NaN: none). The avatar view reads
  // the frame-start position, so it can still show the previous landing on the frame a step is taken (review 2026-10-06).
  const landed = { x: NaN, y: NaN, ox: 0, oy: 0 };
  const prev = { x: NaN, y: NaN, ox: 0, oy: 0 };
  const clearLanded = (): void => { landed.x = NaN; prev.x = NaN; };
  let lastAt = -Infinity;
  const active = (): boolean => rt.isLive() && getCamera3dSettings().camMove;

  // 'game': no direction key is down (the touch D-pad writes the direction itself), the game's own step.
  const prepare = (): 'game' | 'cancel' | 'steer' => {
    const c = rt.frame.ctx();
    if (!c || !hasDirKey(di.keysPressed)) return 'game';
    if (!walkHeading(c.params.yaw, di.keysPressed, h)) { planner.reset(); clearLanded(); return 'cancel'; }
    const now = performance.now();
    if (now - lastAt > NEW_WALK_MS) planner.reset();
    lastAt = now;
    return 'steer';
  };

  const wrapper: WrappedMove = function (this: unknown, dir: string, pos: XY): boolean {
    if (wrapper.__qpmRetired || !active()) return orig.call(this, dir, pos);
    let mode: 'game' | 'cancel' | 'steer';
    // Runs inside the game's input tick: a planning error leaves 3D and the step goes the game's way.
    try { mode = prepare(); } catch (e) { rt.fail('move', e); return orig.call(this, dir, pos); }
    if (mode === 'game') return orig.call(this, dir, pos);
    if (mode === 'cancel') return false;
    const took = steerStep(planner, h.x, h.y, (d) => orig.call(this, d, pos));
    if (took) {
      const s = STEP_OF[took];
      Object.assign(prev, landed);
      landed.x = pos.x + s.x; landed.y = pos.y + s.y; landed.ox = planner.ox; landed.oy = planner.oy;
    } else clearLanded();
    return took !== null;
  };

  const steer: SteerSource = {
    offsetAt(tile, out) {
      keyAxes(di.keysPressed, axes);
      // Keys up ends the walk: matched through `prev`, its last point steered a new walk's first, frame-lagged step
      // from the same tile (review 2026-10-06).
      if (axes.x === 0 && axes.y === 0) { clearLanded(); return false; }
      const at = landed.x === tile.x && landed.y === tile.y ? landed : prev.x === tile.x && prev.y === tile.y ? prev : null;
      if (!at || !active()) return false;
      out.x = at.ox * TILE; out.y = at.oy * TILE;
      return true;
    },
  };

  host.movePlayer = wrapper;
  rt.setSteer(steer);
  const offExit = rt.onExit(() => { planner.reset(); clearLanded(); });
  return () => {
    offExit();
    rt.setSteer(null);
    if (host.movePlayer === wrapper) {
      if (hadOwn) host.movePlayer = orig;
      else delete (host as unknown as Record<string, unknown>).movePlayer;
    } else wrapper.__qpmRetired = true;
  };
}

// Spec D5, the fallback when the movement system has no movePlayer: the game's directionalInput maps the last pressed
// key to one of four directions; while 3D is live the keys are rotated by the camera yaw snapped to a quarter turn.
function installQuarterSnap(rt: Runtime): () => void {
  const di = rt.caps.systems.directionalInput;
  const host = di as unknown as { updateDirectionState: (this: DirectionalInputLike) => void };
  const hadOwn = Object.prototype.hasOwnProperty.call(host, 'updateDirectionState');
  const orig = host.updateDirectionState;
  let lastQ = 0;

  const quarter = (): number => {
    const c = rt.frame.ctx();
    return c ? quarterOf(c.params.yaw) : 0;
  };
  const active = (): boolean => rt.isLive() && getCamera3dSettings().camMove;

  // Runs inside the game's key handler: a rotation error leaves 3D and the keys resolve unrotated.
  host.updateDirectionState = function (this: DirectionalInputLike): void {
    if (!active()) { orig.call(this); return; }
    const saved = this.keysPressed;
    let rotated: string[];
    try {
      rotated = rotateDirKeys(saved, quarter());
    } catch (e) {
      rt.fail('move', e);
      orig.call(this);
      return;
    }
    this.keysPressed = rotated;
    try { orig.call(this); } finally { this.keysPressed = saved; }
  };

  // A held key re-resolves when the camera crosses into another quarter turn, and once on exit.
  const offFrame = rt.onFrame(() => {
    const q = quarter();
    if (q === lastQ) return;
    lastQ = q;
    if (di.keysPressed.length) di.updateDirectionState();
  });
  const offExit = rt.onExit(() => { lastQ = 0; if (di.keysPressed.length) di.updateDirectionState(); });

  return () => {
    offFrame();
    offExit();
    if (hadOwn) host.updateDirectionState = orig;
    else delete (host as unknown as Record<string, unknown>).updateDirectionState;
    di.updateDirectionState();
  };
}
