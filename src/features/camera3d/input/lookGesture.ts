export interface PressLike { button: number; onCanvas: boolean; shift: boolean }
type Pending = 'none' | 'promise' | 'event';

/** Right-button look and pointer-lock bookkeeping, free of the DOM. Deltas land in dx/dy (no per-move allocation). */
export class LookGesture {
  dragging = false;
  dx = 0;
  dy = 0;
  private lx = 0;
  private ly = 0;
  private ctxArmed = false;
  private pending: Pending = 'none';

  /** Every window pointerdown. 'lock' also drags, so a refused lock still looks. */
  down(e: PressLike, live: boolean, fp: boolean, x: number, y: number): 'none' | 'drag' | 'lock' {
    this.ctxArmed = false;
    if (!live || e.button !== 2 || !e.onCanvas) return 'none';
    // On Windows the menu fires after the release, over whatever is under the pointer then (a QPM window).
    this.ctxArmed = true;
    this.dragging = true;
    this.lx = x;
    this.ly = y;
    return e.shift && fp ? 'lock' : 'drag';
  }

  move(buttons: number, x: number, y: number): boolean {
    if (!this.dragging) return false;
    if ((buttons & 2) === 0) { this.dragging = false; return false; } // missed button-2 release (spike input 13)
    this.dx = x - this.lx;
    this.dy = y - this.ly;
    this.lx = x;
    this.ly = y;
    return true;
  }

  /** True: our drag's release, swallow it. */
  up(button: number): boolean {
    if (button !== 2 || !this.dragging) return false;
    this.dragging = false;
    return true;
  }

  cancel(): void { this.dragging = false; }

  /** True: prevent the native menu. */
  contextMenu(onCanvas: boolean, live: boolean): boolean {
    const ours = this.ctxArmed || (live && onCanvas);
    this.ctxArmed = false;
    return ours;
  }

  /** viaPromise: requestPointerLock returned a promise, which then carries the failure (not the document event). */
  lockRequested(viaPromise: boolean): void { this.pending = viaPromise ? 'promise' : 'event'; }

  /** True: a lock that answers our own request (another script may lock the canvas too). */
  lockChanged(locked: boolean): boolean {
    if (!locked) return false;
    const ours = this.pending !== 'none';
    this.pending = 'none';
    return ours;
  }

  /** True once for a failure of our own request; another script's lock error is not ours (A I7, U8). */
  lockFailed(source: 'promise' | 'event'): boolean {
    if (this.pending !== source) return false;
    this.pending = 'none';
    return true;
  }
}
