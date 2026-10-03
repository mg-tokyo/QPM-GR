import type { Runtime } from '../runtime';
import { getCamera3dSettings } from '../settings';
import type { DirectionalInputLike } from '../types';

type Dir = 'up' | 'right' | 'down' | 'left';
const DIRS: readonly Dir[] = ['up', 'right', 'down', 'left'];
// literal-list-justified: the game's directional key ids (e.key for arrows, e.code otherwise), not game data
const DIR_OF: Readonly<Record<string, Dir>> = { KeyW: 'up', KeyA: 'left', KeyS: 'down', KeyD: 'right', ArrowUp: 'up', ArrowLeft: 'left', ArrowDown: 'down', ArrowRight: 'right' };
const KEY_OF: Readonly<Record<Dir, string>> = { up: 'ArrowUp', right: 'ArrowRight', down: 'ArrowDown', left: 'ArrowLeft' };

// D5: the game's directionalInput maps the last pressed key to one of four directions (no diagonals). While 3D is
// live the stack is rotated by the camera yaw, snapped to a quarter turn, so W walks away from the camera.
export function installCameraRelativeMovement(rt: Runtime): () => void {
  const di = rt.caps.systems.directionalInput;
  const host = di as unknown as { updateDirectionState: (this: DirectionalInputLike) => void };
  const hadOwn = Object.prototype.hasOwnProperty.call(host, 'updateDirectionState');
  const orig = host.updateDirectionState;
  let lastQ = 0;

  const quarter = (): number => {
    const c = rt.frame.ctx();
    return c ? ((Math.round(c.params.yaw / (Math.PI / 2)) % 4) + 4) % 4 : 0;
  };
  const active = (): boolean => rt.isLive() && getCamera3dSettings().camMove;

  host.updateDirectionState = function (this: DirectionalInputLike): void {
    if (!active()) { orig.call(this); return; }
    const q = quarter();
    const saved = this.keysPressed;
    this.keysPressed = saved.map((k) => {
      const d = DIR_OF[k];
      return d ? KEY_OF[DIRS[(DIRS.indexOf(d) + q) % 4]!] : k;
    });
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
