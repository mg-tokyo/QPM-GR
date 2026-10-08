import { springStep, type SpringPoint } from '../math/spring';
import { S_LAST_THIRD, S_TILT_END, pitchRange, wrapDeg, type CurveKey, type PitchRange } from '../math/zoomCurve';

// Calibrated live 2026-10-02 (build 1370): one mouse-wheel notch and one keyboard step both request effective × 1.30.
// The wheel factor is linear in the game (1 − deltaPx·0.003, live 2026-10-04), keyboard steps are multiplicative.
const L_NOTCH = Math.log(1.3);
const LINEAR_NOTCH = 0.3;
/** One notch moves the curve 0.08 (the spike's approved feel: 100 px × 0.0008). */
export const S_PER_NOTCH = 0.08;
export const GESTURE_BREAK_MS = 250;
export const ACC_IDLE_MS = 1000;
export const DETENT_NOTCHES = 2;
/** Input past an edge (the cap, first person, the end of the tilt) that switches mode: one wheel notch, ~6 trackpad ticks. */
export const SWITCH_NOTCHES = 0.25;
/** The entry move 0 → end of the tilt, and its mirror on the way out (P1 a). */
export const ENTRY_MS = 500;
/** The push-in through the head S_LAST_THIRD → 1, and its mirror (P2 a). */
export const PUSH_MS = 300;
/** Forced out (a shop opened, a cutscene; P4 a): quicker than the entry's mirror, from anywhere on the curve. */
export const FORCED_EXIT_MS = 350;
// Resuming takes the entry's time for the tilt plus this much across the rest of the curve.
const RESUME_DOLLY_MS = 400;
/** Spring time constant; a critically damped spring settles to 2 % in ≈ 5.8 τ. User hand test 2026-10-04 chose 45
 *  over 30 and 60 (per-frame velocity jump 0.57 of peak on 150 ms notches; the old τ 90 first-order was 0.88). */
export const DEFAULT_TAU_MS = 45;
const MAX_DT_MS = 100;
const MIN_TURN_MS = 150;
// The stop is below a tenth of a pixel anywhere on the curve, so landing never pops (A S7).
const STOP_S = 2e-5;
const STOP_V = 2e-3;
/** Look input below this orbit would build up turns nobody can see (A T7). */
export const LOOK_MIN_ORBIT = 0.05;

export type ZoomInputKind = 'wheel' | 'keyboard' | 'pinch' | 'gesture';

/** Live 2026-10-04: wheel = 'stepped' + pointer anchor, keyboard/gamepad = 'stepped' + null, ctrl+wheel pinch = 'direct';
 *  touch pinch and Safari gestures are 'direct' while the game's own gesture state is set. */
export function classifyZoomInput(kind: string, ctx: unknown, gesture: boolean): ZoomInputKind {
  if (kind === 'stepped') return ctx !== null && typeof ctx === 'object' ? 'wheel' : 'keyboard';
  if (kind === 'direct') return gesture ? 'gesture' : 'pinch';
  return 'keyboard';
}

/** Signed notches for one zoom request, symmetric in and out per input kind (A S2). */
export class ZoomInput {
  // A gesture requests (start size × total scale); the previous request turns that into per-call steps.
  private base = 0;

  notches(kind: ZoomInputKind, requested: number, effective: number): number {
    if (!(requested > 0) || !(effective > 0)) return 0;
    if (kind === 'gesture') {
      const from = this.base > 0 ? this.base : effective;
      this.base = requested;
      return Math.log(requested / from) / L_NOTCH;
    }
    const r = requested / effective;
    return kind === 'keyboard' ? Math.log(r) / L_NOTCH : (r - 1) / LINEAR_NOTCH;
  }

  inGesture(): boolean { return this.base > 0; }
  endGesture(): void { this.base = 0; }
}

/** D1: the gesture that reaches max zoom never enters 3D; a later one must push 2 notches' worth at the clamp. */
export class Detent {
  private lastInput = -Infinity;
  private reached = false;
  private acc = 0;

  input(now: number, notches: number, clamped: boolean, changed: boolean): boolean {
    const idle = now - this.lastInput;
    if (idle > GESTURE_BREAK_MS) this.reached = false;
    if (idle > ACC_IDLE_MS) this.acc = 0;
    this.lastInput = now;
    if (changed) { this.reached = true; this.acc = 0; return false; }
    if (!clamped || this.reached) return false;
    this.acc += notches;
    if (this.acc < DETENT_NOTCHES - 1e-9) return false;
    this.acc = 0;
    this.reached = true;
    return true;
  }

  engaged(): boolean { return this.acc > 0; }

  reset(): void { this.lastInput = -Infinity; this.reached = false; this.acc = 0; }
}

const settle = (p: SpringPoint, target: number): void => {
  if (Math.abs(p.s - target) < STOP_S && Math.abs(p.v) < STOP_V) { p.s = target; p.v = 0; }
};

/** Quintic Hermite from (s0, v0, a 0) to (s1, 0, 0): eased ends, and it picks up whatever velocity it starts from. */
class Move {
  s0 = 0; v0 = 0; s1 = 0; ms = 1; t = 0;

  set(s0: number, v0: number, s1: number, ms: number): void {
    this.s0 = s0; this.s1 = s1; this.ms = Math.max(1, ms); this.t = 0;
    this.v0 = v0 > 0 ? Math.min(v0, this.maxSpeed(true)) : v0 < 0 ? -Math.min(-v0, this.maxSpeed(false)) : 0;
  }
  done(): boolean { return this.t >= this.ms - 1e-6; }

  // The fastest start toward an end of the curve whose path stays clear of it: tick's clamp would park the camera there
  // for frames (a turn-back right after a fast exit dipped below 0, review 2026-10-04). It only binds on reversals.
  private maxSpeed(up: boolean): number {
    let k = Infinity;
    for (let i = 1; i < 32; i++) {
      const u = i / 32, w = 1 - u;
      const base = this.s0 + (this.s1 - this.s0) * u * u * u * (10 - 15 * u + 6 * u * u);
      k = Math.min(k, (up ? 1 - base : base) / (u * w * w * w * (1 + 3 * u)));
    }
    return (0.95 * Math.max(0, k)) / (this.ms / 1000);
  }

  pos(): number {
    const u = Math.min(1, this.t / this.ms), u3 = u * u * u, u4 = u3 * u, u5 = u4 * u;
    const h5 = 10 * u3 - 15 * u4 + 6 * u5;
    return this.s0 * (1 - h5) + (this.ms / 1000) * this.v0 * (u - 6 * u3 + 8 * u4 - 3 * u5) + this.s1 * h5;
  }

  vel(): number {
    const u = Math.min(1, this.t / this.ms), u2 = u * u, u3 = u2 * u, u4 = u3 * u;
    const d5 = 30 * u2 - 60 * u3 + 30 * u4;
    return ((this.s1 - this.s0) * d5) / (this.ms / 1000) + this.v0 * (1 - 18 * u2 + 32 * u3 - 15 * u4);
  }
}

export type SPhase = 'spring' | 'leaving' | 'enter' | 'exit' | 'push' | 'pull' | 'resume';
type MovePhase = 'enter' | 'exit' | 'push' | 'pull' | 'resume';

/** Curve position s. The tilt band [0, S_TILT_END] and the push-in band [S_LAST_THIRD, 1] are only ever crossed by a
 *  timed move (P1 a, P2 a); between them a critically damped spring keeps velocity continuous across notches (A S1). */
export class SState {
  s = 0;
  v = 0;
  target = 0;
  tauMs = DEFAULT_TAU_MS;
  private ph: 'spring' | MovePhase = 'spring';
  private leaving = false;
  private clock = true;
  private readonly move = new Move();
  // Zoom input during the entry move or the pull-out rides on top of it, so it acts at once and carries on after it.
  private readonly off: SpringPoint = { s: 0, v: 0 };
  private offTarget = 0;
  private offMin = 0;
  private offMax = 0;
  // A leave asked for while the pull is still in the push-in band: the spring must never start inside the band.
  private leaveAfterPull = false;
  // > 0: pushed past the top edge (cap / out of first person); < 0: past the end of the tilt.
  private edgeAcc = 0;
  private edgeAt = -Infinity;

  phase(): SPhase { return this.leaving || this.leaveAfterPull ? 'leaving' : this.ph; }

  /** Entering from 2D: s holds at 0 until startClock() (the first 3D frame has drawn, A T2). */
  start(): void {
    this.reset();
    this.target = S_TILT_END;
    this.move.set(0, 0, S_TILT_END, ENTRY_MS);
    this.ride(0, S_LAST_THIRD - S_TILT_END);
    this.ph = 'enter';
    this.clock = false;
  }

  startClock(): void { this.clock = true; }

  reset(): void {
    this.s = 0; this.v = 0; this.target = 0; this.ph = 'spring'; this.leaving = false; this.clock = true;
    this.ride(0, 0); this.edgeAcc = 0;
  }

  /** Forced out of 3D (P4 a): one eased move to 0 from wherever s is, picking up its velocity. */
  forceOut(): void {
    let ms = FORCED_EXIT_MS * Math.min(1, this.s / S_TILT_END);
    if (this.v < 0) ms = Math.min(ms, (2000 * this.s) / -this.v);
    this.moveTo(0, ms, 'exit');
    this.ride(0, 0);
  }

  /** Back to a remembered pose (P4 a): from 2D it waits for the first 3D frame like start(); mid-exit it turns back. */
  resume(to: number): void {
    const fresh = !this.moving() && this.s === 0;
    if (fresh) this.reset();
    const span = Math.abs(to - this.s);
    let ms = (ENTRY_MS + (RESUME_DOLLY_MS * Math.max(0, to - S_TILT_END)) / (1 - S_TILT_END)) * (to > 0 ? span / to : 1);
    if (this.v > 0 && to > this.s) ms = Math.min(ms, (2000 * span) / this.v);
    this.moveTo(to, fresh ? ms : Math.max(MIN_TURN_MS, ms), 'resume');
    this.ride(0, 0);
    if (fresh) this.clock = false;
  }

  input(notches: number, firstPerson: boolean, now: number): void {
    if (now - this.edgeAt > ACC_IDLE_MS) this.edgeAcc = 0;
    this.edgeAt = now;
    if (this.ph === 'resume' && this.handOver(notches, firstPerson)) return;
    if (this.ph === 'exit') { if (notches > 0) this.turnBack(); return; }
    if (this.ph === 'enter') {
      const want = this.offTarget + S_PER_NOTCH * notches;
      this.offTarget = Math.min(this.offMax, Math.max(this.offMin, want));
      this.target = S_TILT_END + this.offTarget;
      if (this.pushDown(notches, -want)) this.exitFrom(this.s, this.v);
      return;
    }
    if (this.ph === 'pull') { this.pullInput(notches, firstPerson); return; }
    if (this.ph === 'push' || this.target >= 1) {
      this.edgeAcc = notches > 0 ? 0 : this.edgeAcc - notches;
      if (this.edgeAcc >= SWITCH_NOTCHES - 1e-9) this.pullOut();
      return;
    }
    if (this.leaving) {
      if (notches <= 0) return;
      this.leaving = false;
      this.edgeAcc = 0;
      this.target = Math.min(S_LAST_THIRD, Math.max(S_TILT_END, this.s + S_PER_NOTCH * notches));
      return;
    }
    const want = this.target + S_PER_NOTCH * notches;
    this.target = Math.min(S_LAST_THIRD, Math.max(S_TILT_END, want));
    if (notches <= 0) {
      if (this.pushDown(notches, S_TILT_END - want)) this.leave();
      return;
    }
    if (!firstPerson) { this.edgeAcc = 0; return; }
    if (this.edgeAcc < 0) this.edgeAcc = 0;
    this.edgeAcc += Math.max(0, want - S_LAST_THIRD) / S_PER_NOTCH;
    if (this.edgeAcc >= SWITCH_NOTCHES - 1e-9) this.pushIn();
  }

  /** The setting went off: animate out of first person (once; a pull already under way carries on). */
  leaveFirstPerson(): void { if (this.ph === 'push' || (this.ph === 'spring' && this.target >= 1)) this.pullOut(); }

  moving(): boolean { return this.ph !== 'spring' || this.s !== this.target || this.v !== 0; }

  tick(dtMs: number): void {
    if (!this.moving()) return;
    const dtClamped = Math.min(MAX_DT_MS, Math.max(0, dtMs));
    const dt = dtClamped / 1000, w = 1000 / this.tauMs;
    if (this.ph !== 'spring') {
      if (!this.clock) return;
      this.move.t += dtClamped;
      let s = this.move.pos(), v = this.move.vel();
      if (this.ph === 'enter' || this.ph === 'pull') {
        springStep(this.off, this.offTarget, dt, w);
        settle(this.off, this.offTarget);
        s += this.off.s;
        v += this.off.v;
      }
      this.s = Math.min(1, Math.max(0, s));
      this.v = v;
      if (!this.move.done()) return;
      if (this.ph === 'exit') { this.s = 0; this.v = 0; this.target = 0; return; }
      this.ph = 'spring';
      this.s = this.move.s1 + this.off.s;
      this.v = this.off.v;
      this.target = this.move.s1 + this.offTarget;
      if (this.leaveAfterPull) { this.leaveAfterPull = false; this.leave(); }
      return;
    }
    springStep(this, this.target, dt, w);
    if (this.leaving) {
      if (this.s <= S_TILT_END) this.exitFrom(this.s, this.v);
      return;
    }
    const max = this.target >= 1 ? 1 : S_LAST_THIRD;
    if (this.s <= S_TILT_END) { this.s = S_TILT_END; this.v = Math.max(0, this.v); }
    else if (this.s >= max) { this.s = max; this.v = Math.min(0, this.v); }
    settle(this, this.target);
  }

  done(): boolean { return this.ph === 'exit' && this.move.done(); }

  // Input below the end of the tilt accumulates (in notches) until it is a switch's worth; input the other way resets.
  private pushDown(notches: number, pastS: number): boolean {
    if (notches > 0) { if (this.edgeAcc < 0) this.edgeAcc = 0; return false; }
    if (this.edgeAcc > 0) this.edgeAcc = 0;
    this.edgeAcc -= Math.max(0, pastS) / S_PER_NOTCH;
    return this.edgeAcc <= -SWITCH_NOTCHES + 1e-9;
  }

  // Deep in the dolly the spring carries s down first (toward 0, so it arrives moving), then the tilt plays out.
  private leave(): void {
    if (this.s <= S_TILT_END) { this.exitFrom(this.s, this.v); return; }
    this.leaving = true;
    this.target = 0;
  }

  // The mirror of the entry. Arriving fast shortens it: below 2·s/|v| the Hermite never undershoots 0.
  private exitFrom(s: number, v: number): void {
    let ms = ENTRY_MS * Math.min(1, s / S_TILT_END);
    if (v < 0) ms = Math.min(ms, (2000 * s) / -v);
    this.move.set(s, v, 0, ms);
    this.ph = 'exit';
    this.leaving = false;
    this.clock = true;
    this.edgeAcc = 0;
    this.target = 0;
    this.s = s;
    this.v = v;
  }

  private turnBack(): void {
    this.move.set(this.s, this.v, S_TILT_END, Math.max(MIN_TURN_MS, ENTRY_MS * (1 - this.s / S_TILT_END)));
    this.ride(0, S_LAST_THIRD - S_TILT_END);
    this.ph = 'enter';
    this.target = S_TILT_END;
  }

  // From wherever s is (a fast scroll switches before the spring reaches the cap), picking up its velocity. Arriving fast
  // shortens it: below 2·span/v the Hermite never overshoots the eye.
  private pushIn(): void {
    const span = 1 - this.s;
    let ms = PUSH_MS * Math.min(2, span / (1 - S_LAST_THIRD));
    if (this.v > 0) ms = Math.min(ms, (2000 * span) / this.v);
    this.moveTo(1, ms, 'push');
    this.ride(0, 0);
  }

  private pullOut(): void {
    const span = this.s - S_LAST_THIRD;
    // A push that started below the cap and turned back before reaching it: just the dolly spring from here.
    if (span <= 0) { this.ph = 'spring'; this.edgeAcc = 0; this.target = Math.max(S_TILT_END, this.s); return; }
    let ms = PUSH_MS * Math.min(1, span / (1 - S_LAST_THIRD));
    if (this.v < 0) ms = Math.min(ms, (2000 * span) / -this.v);
    this.moveTo(S_LAST_THIRD, ms, 'pull');
    this.ride(S_TILT_END - S_LAST_THIRD, 0);
  }

  // During the pull, scroll-out rides on top (to the end of the tilt; a switch's worth past it leaves 3D). Scroll-in takes
  // that back first; a switch's worth past it pushes in again.
  private pullInput(notches: number, firstPerson: boolean): void {
    const want = this.offTarget + S_PER_NOTCH * notches;
    this.offTarget = Math.min(this.offMax, Math.max(this.offMin, want));
    this.target = this.move.s1 + this.offTarget;
    if (notches <= 0) {
      if (!this.pushDown(notches, this.offMin - want)) return;
      if (this.s > S_LAST_THIRD) this.leaveAfterPull = true;
      else { this.ph = 'spring'; this.leave(); }
      return;
    }
    this.leaveAfterPull = false;
    if (this.edgeAcc < 0) this.edgeAcc = 0;
    if (!firstPerson) return;
    this.edgeAcc += Math.max(0, want - this.offMax) / S_PER_NOTCH;
    if (this.edgeAcc >= SWITCH_NOTCHES - 1e-9) this.pushIn();
  }

  // Zoom input during a resume takes over from where the camera is, as if the user had zoomed there. The push-in band
  // is never a rest point: the input's direction (and the setting) picks its end, and that input is spent. True: spent.
  private handOver(notches: number, firstPerson: boolean): boolean {
    if (this.s < S_TILT_END) this.turnBack();
    else if (this.s <= S_LAST_THIRD) { this.ph = 'spring'; this.target = this.s; }
    else {
      if (notches > 0 && firstPerson) this.pushIn(); else this.pullOut();
      return true;
    }
    return false;
  }

  private moveTo(s1: number, ms: number, ph: MovePhase): void {
    this.move.set(this.s, this.v, s1, ms);
    this.ph = ph;
    this.leaving = false;
    this.clock = true;
    this.edgeAcc = 0;
    this.target = s1;
  }

  private ride(min: number, max: number): void {
    this.off.s = 0; this.off.v = 0; this.offTarget = 0; this.offMin = min; this.offMax = max; this.leaveAfterPull = false;
  }
}

/** The free-look offsets (P5 a: one pitch offset shared by both modes), kept inside what the current mode can show. */
export class LookState {
  yaw = 0;
  pitch = 0;
  private readonly range: PitchRange = { base: 0, lo: 0, hi: 0, orbit: 1 };

  reset(): void { this.yaw = 0; this.pitch = 0; }

  input(dYawDeg: number, dPitchDeg: number, s: number, scratch: CurveKey): void {
    const r = pitchRange(s, this.range, scratch);
    if (r.orbit < LOOK_MIN_ORBIT) return;
    this.yaw += dYawDeg;
    this.pitch += dPitchDeg;
    this.clamp(r);
  }

  /** Per frame: s moves the visible range, so a stored offset never sits in a dead zone (A I2). */
  settle(s: number, scratch: CurveKey): void { this.clamp(pitchRange(s, this.range, scratch)); }

  renderedYaw(orbit: number): number { return wrapDeg(this.yaw * orbit); }

  // The wrap is invisible only at orbit 1; below it the unwrapped value keeps a turn past ±180° continuous.
  private clamp(r: PitchRange): void {
    if (r.orbit >= 1) this.yaw = wrapDeg(this.yaw);
    if (r.orbit >= LOOK_MIN_ORBIT) this.pitch = Math.min((r.hi - r.base) / r.orbit, Math.max((r.lo - r.base) / r.orbit, this.pitch));
  }
}
