export interface PointerContext {
  active(): boolean;
  /** The game's own UI owns input (a window is open): presses stay with the game. */
  uiOwnsInput(): boolean;
  /** The game canvas: QPM panels and the game's DOM overlays are never world presses. */
  isWorldTarget(t: EventTarget | null): boolean;
  /** Client px → PIXI global point (CSS px of the stage); null when it can't be mapped. */
  toGlobal(clientX: number, clientY: number): { x: number; y: number } | null;
  overUi(x: number, y: number): boolean;
  /** The game's idle frame-rate tracker counts canvas pointer events, and it no longer sees these presses. */
  activity?(): void;
}

export interface PointerActions {
  /** The press moved past the click threshold: following stops. */
  dragStart(): void;
  /** Screen px moved since the last call. */
  drag(dx: number, dy: number): void;
  /** A press released within the threshold, at the global press point. */
  click(x: number, y: number): void;
}

const CLICK_PX = 6;
// Left and right drag both pan (S §3.5); the middle button stays with the browser.
const PAN_BUTTONS: ReadonlySet<number> = new Set([0, 2]);

interface Press { id: number; x0: number; y0: number; x: number; y: number; dragging: boolean }

/** World presses belong to the spectator (S §4.6). PIXI's pointerdown listener is on the canvas, so this window
 * capture listener runs first and the game's tap router never owns the press. Moves and releases are only read, so
 * hover and the release reach the game as before. */
export function installPointer(ctx: PointerContext, actions: PointerActions, target: Window = window): () => void {
  let press: Press | null = null;
  let on = true;

  const onDown = (e: PointerEvent): void => {
    // A press whose release went outside the window (the Discord frame) is over once the same pointer presses again.
    if (press && e.pointerId !== press.id) return;
    press = null;
    if (!ctx.active() || !PAN_BUTTONS.has(e.button) || !ctx.isWorldTarget(e.target) || ctx.uiOwnsInput()) return;
    const g = ctx.toGlobal(e.clientX, e.clientY);
    if (!g || ctx.overUi(g.x, g.y)) return;
    // No preventDefault: focus still leaves a text field the player clicked away from.
    e.stopPropagation();
    ctx.activity?.();
    press = { id: e.pointerId, x0: g.x, y0: g.y, x: g.x, y: g.y, dragging: false };
  };
  const onMove = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    if (e.buttons === 0) { press = null; return; }
    const g = ctx.toGlobal(e.clientX, e.clientY);
    if (!g) return;
    if (!press.dragging) {
      if (Math.hypot(g.x - press.x0, g.y - press.y0) < CLICK_PX) return;
      press.dragging = true;
      actions.dragStart();
    }
    actions.drag(g.x - press.x, g.y - press.y);
    press.x = g.x;
    press.y = g.y;
    ctx.activity?.();
  };
  const onUp = (e: PointerEvent): void => {
    if (!press || e.pointerId !== press.id) return;
    const p = press;
    press = null;
    if (!p.dragging) actions.click(p.x0, p.y0);
  };
  const cancel = (): void => { press = null; };

  target.addEventListener('pointerdown', onDown, true);
  target.addEventListener('pointermove', onMove, true);
  target.addEventListener('pointerup', onUp, true);
  target.addEventListener('pointercancel', cancel, true);
  target.addEventListener('blur', cancel);
  return () => {
    if (!on) return;
    on = false;
    press = null;
    target.removeEventListener('pointerdown', onDown, true);
    target.removeEventListener('pointermove', onMove, true);
    target.removeEventListener('pointerup', onUp, true);
    target.removeEventListener('pointercancel', cancel, true);
    target.removeEventListener('blur', cancel);
  };
}
