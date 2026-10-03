import { S_FIRST_PERSON, S_LAST_THIRD } from '../math/zoomCurve';

// Calibrated live 2026-10-02 (build 1370): one mouse-wheel notch and one keyboard step both request effective × 1.30.
export const L_NOTCH = Math.log(1.3);
// One notch moves the curve 0.08 (the spike's approved feel: 100 px × 0.0008).
export const K_S = 0.08 / L_NOTCH;
export const GESTURE_BREAK_MS = 250;
export const ACC_IDLE_MS = 1000;
export const DETENT_NOTCHES = 2;
const TAU_MS = 90;

/** D1: the gesture that reaches max zoom never enters 3D; a later one must push 2 notches' worth at the clamp. */
export class Detent {
  private lastInput = -Infinity;
  private reached = false;
  private acc = 0;

  input(now: number, ln: number, clamped: boolean, changed: boolean): boolean {
    const idle = now - this.lastInput;
    if (idle > GESTURE_BREAK_MS) this.reached = false;
    if (idle > ACC_IDLE_MS) this.acc = 0;
    this.lastInput = now;
    if (changed) { this.reached = true; this.acc = 0; return false; }
    if (!clamped || this.reached) return false;
    this.acc += ln;
    if (this.acc < DETENT_NOTCHES * L_NOTCH - 1e-9) return false;
    this.acc = 0;
    this.reached = true;
    return true;
  }

  engaged(): boolean { return this.acc > 0; }

  reset(): void { this.lastInput = -Infinity; this.reached = false; this.acc = 0; }
}

/** Curve position s with exponential smoothing toward its target (spike: τ 90 ms). */
export class SState {
  s = 0;
  target = 0;

  start(ln: number): void {
    this.s = 0;
    this.target = Math.min(S_FIRST_PERSON - 0.01, Math.max(0.001, K_S * ln));
  }

  input(ln: number, firstPerson: boolean): void {
    const ds = K_S * ln;
    if (this.target >= 1) {
      if (ds < 0) { this.target = S_LAST_THIRD; this.s = S_LAST_THIRD; }
      return;
    }
    this.target = Math.min(1, Math.max(0, this.target + ds));
    if (!firstPerson) this.target = Math.min(this.target, S_LAST_THIRD);
    else if (this.target >= S_FIRST_PERSON) { this.target = 1; this.s = 1; }
  }

  tick(dtMs: number): void {
    if (this.s === this.target) return;
    const dt = Math.min(100, Math.max(0, dtMs));
    this.s += (this.target - this.s) * (1 - Math.exp(-dt / TAU_MS));
    if (Math.abs(this.target - this.s) < 2e-3) this.s = this.target;
  }

  done(): boolean { return this.s <= 0 && this.target <= 0; }
}
