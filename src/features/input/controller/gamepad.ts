/**
 * Gamepad polling loop.
 * Runs via requestAnimationFrame. Detects button presses/releases and stick
 * movement, then calls the provided action handlers.
 *
 * Standard Gamepad API button layout (W3C):
 *   0  A/×      1  B/○      2  X/□      3  Y/△
 *   4  LB       5  RB       6  LT       7  RT
 *   8  Select   9  Start   10  L3      11  R3
 *  12  D-Up    13  D-Down  14  D-Left  15  D-Right
 *
 * Axes: 0=LX, 1=LY, 2=RX, 3=RY
 */

import { setMoveDirection, releaseAllDirectionKeys } from './synthesis';
import { Cursor } from './cursor';
import { detectProfile, type ControllerProfile } from './controller-profile';
import { snapCursorToNearest } from './navigation';
import { getPixiInteractives } from './controllerContext';
import type { Action } from './bindings';

export type ActionHandler = (action: Action) => void;
export type ProfileChangeHandler = (profile: ControllerProfile | null) => void;

const AXIS_LX = 0;
const AXIS_LY = 1;
const AXIS_RX = 2;
const AXIS_RY = 3;

// D-Pad buttons — hardcoded to movement (or snap in modal mode)
const DPAD_INDICES = { up: 12, down: 13, left: 14, right: 15 } as const;

// Direction vectors for D-pad snap navigation [dx, dy]
const DPAD_SNAP_VECTORS: Array<[keyof typeof DPAD_INDICES, number, number]> = [
  ['up',     0, -1],
  ['down',   0,  1],
  ['left',  -1,  0],
  ['right',  1,  0],
];

// Analog trigger threshold (LT/RT fire at this deflection)
const TRIGGER_THRESHOLD = 0.5;
const STICK_DEAD_ZONE = 0.15;

// LB and RB button indices (used for chord detection)
const LB_INDEX = 4;
const RB_INDEX = 5;

/**
 * Returns the list of gamepads, guarding against browsers where the Gamepad
 * API is absent or unavailable before the first button press (e.g. Firefox).
 */
function getGamepadsSafe(): readonly (Gamepad | null)[] {
  if (!('getGamepads' in navigator)) return [];
  return navigator.getGamepads();
}

export class GamepadPoller {
  private bindings: Record<number, Action>;
  private onAction: ActionHandler;
  private cursor: Cursor;
  private onProfileChange: ProfileChangeHandler;

  private rafId: number | null = null;
  private prevButtons: Map<number, boolean> = new Map();
  private prevDpad: Map<number, boolean> = new Map();
  private lastTimestamp: number = 0;
  private connectedGamepadIndex: number | null = null;
  private currentProfile: ControllerProfile | null = null;

  constructor(
    bindings: Record<number, Action>,
    cursor: Cursor,
    onAction: ActionHandler,
    onProfileChange: ProfileChangeHandler,
  ) {
    this.bindings = bindings;
    this.cursor = cursor;
    this.onAction = onAction;
    this.onProfileChange = onProfileChange;
  }

  updateBindings(bindings: Record<number, Action>): void {
    this.bindings = bindings;
  }

  start(): void {
    if (this.rafId !== null) return;

    window.addEventListener('gamepadconnected', this.onConnect);
    window.addEventListener('gamepaddisconnected', this.onDisconnect);

    // Check if a gamepad is already connected (e.g. plugged in before script ran)
    for (const gp of getGamepadsSafe()) {
      if (gp) {
        this.connectedGamepadIndex = gp.index;
        this.currentProfile = detectProfile(gp);
        this.onProfileChange(this.currentProfile);
        break;
      }
    }

    this.scheduleFrame();
  }

  stop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    window.removeEventListener('gamepadconnected', this.onConnect);
    window.removeEventListener('gamepaddisconnected', this.onDisconnect);
    releaseAllDirectionKeys();
  }

  getProfile(): ControllerProfile | null {
    return this.currentProfile;
  }

  private onConnect = (ev: GamepadEvent): void => {
    if (this.connectedGamepadIndex === null) {
      this.connectedGamepadIndex = ev.gamepad.index;
      this.currentProfile = detectProfile(ev.gamepad);
      this.onProfileChange(this.currentProfile);
      console.log(`[QPM Controller] Gamepad connected: ${ev.gamepad.id}`);
    }
  };

  private onDisconnect = (ev: GamepadEvent): void => {
    if (ev.gamepad.index === this.connectedGamepadIndex) {
      this.connectedGamepadIndex = null;
      this.currentProfile = null;
      this.prevButtons.clear();
      this.prevDpad.clear();
      releaseAllDirectionKeys();
      this.onProfileChange(null);
      console.log(`[QPM Controller] Gamepad disconnected.`);
    }
  };

  private scheduleFrame(): void {
    this.rafId = requestAnimationFrame(this.frame);
  }

  private frame = (timestamp: number): void => {
    const dt = this.lastTimestamp > 0 ? Math.min((timestamp - this.lastTimestamp) / 1000, 0.1) : 0.016;
    this.lastTimestamp = timestamp;

    const gp = this.getActiveGamepad();
    if (gp) {
      this.processGamepad(gp, dt);
    }

    this.scheduleFrame();
  };

  private getActiveGamepad(): Gamepad | null {
    if (this.connectedGamepadIndex === null) return null;
    return getGamepadsSafe()[this.connectedGamepadIndex] ?? null;
  }

  private processGamepad(gp: Gamepad, dt: number): void {
    if (!gp.buttons.length) return;
    this.processMoveAxes(gp);
    this.processMoveButtons(gp);
    this.processCursorAxes(gp, dt);
    this.processActionButtons(gp);
  }

  // Left stick → character movement
  private processMoveAxes(gp: Gamepad): void {
    const lx = applyDeadZone(gp.axes[AXIS_LX] ?? 0, STICK_DEAD_ZONE);
    const ly = applyDeadZone(gp.axes[AXIS_LY] ?? 0, STICK_DEAD_ZONE);
    setMoveDirection(lx, ly);
  }

  // D-Pad → cursor snap (rising-edge only; left stick handles character movement)
  private processMoveButtons(gp: Gamepad): void {
    for (const [dir, dx, dy] of DPAD_SNAP_VECTORS) {
      const idx = DPAD_INDICES[dir];
      const pressed = gp.buttons[idx]?.pressed ?? false;
      const wasPressed = this.prevDpad.get(idx) ?? false;
      if (pressed && !wasPressed) {
        snapCursorToNearest(dx, dy, this.cursor, getPixiInteractives());
      }
      this.prevDpad.set(idx, pressed);
    }
  }

  // Right stick → cursor
  private processCursorAxes(gp: Gamepad, dt: number): void {
    const rx = applyDeadZone(gp.axes[AXIS_RX] ?? 0, STICK_DEAD_ZONE);
    const ry = applyDeadZone(gp.axes[AXIS_RY] ?? 0, STICK_DEAD_ZONE);
    this.cursor.update(rx, ry, dt);
  }

  // All action buttons (with rising-edge detection)
  private processActionButtons(gp: Gamepad): void {
    // LB+RB chord → deselectSlot
    // Fires when both are held and at least one is newly pressed this frame.
    // Pre-sets prevButtons for LB/RB so the normal loop won't also fire them.
    const lbNow = gp.buttons[LB_INDEX]?.pressed ?? false;
    const rbNow = gp.buttons[RB_INDEX]?.pressed ?? false;
    const lbWas = this.prevButtons.get(LB_INDEX) ?? false;
    const rbWas = this.prevButtons.get(RB_INDEX) ?? false;

    if (lbNow && rbNow && (!lbWas || !rbWas)) {
      this.onAction('deselectSlot');
      // Mark both as already-pressed so the loop below sees no rising edge
      this.prevButtons.set(LB_INDEX, true);
      this.prevButtons.set(RB_INDEX, true);
    }

    for (let i = 0; i < gp.buttons.length; i++) {
      // Skip D-Pad (handled as movement or snap)
      if (i === DPAD_INDICES.up || i === DPAD_INDICES.down ||
          i === DPAD_INDICES.left || i === DPAD_INDICES.right) continue;

      const btn = gp.buttons[i];
      if (!btn) continue;

      // Triggers (6=LT, 7=RT): use analog value with threshold
      const pressed = (i === 6 || i === 7)
        ? btn.value > TRIGGER_THRESHOLD
        : btn.pressed;

      const wasPressed = this.prevButtons.get(i) ?? false;

      if (pressed && !wasPressed) {
        // Rising edge — fire action
        const action = this.bindings[i];
        if (action) this.onAction(action);
      }

      this.prevButtons.set(i, pressed);
    }
  }
}

function applyDeadZone(value: number, deadZone: number): number {
  if (Math.abs(value) < deadZone) return 0;
  // Rescale so the range just past the dead-zone maps to 0→1
  return (value - Math.sign(value) * deadZone) / (1 - deadZone);
}
