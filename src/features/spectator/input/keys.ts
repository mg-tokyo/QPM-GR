import { canonicalKeyFromEvent, isEditableTarget, isKeybindRecording, normalizeKeybind } from '../../../ui/pets/petsWindow/helpers';
import type { FlightInput } from '../pose/flight';
import type { SpectatorAction } from '../settings';
import { ARROW_FOR, ARROW_KEYS, CAPTURE_KEYS, HELD_ONLY, MOVE_ACTIONS, SEAT_DIGIT } from './keyRules';

export interface KeyContext {
  active(): boolean;
  /** False (Enabled off, or off for the session): the toggle key stays with everyone else. Absent = on. */
  enabled?(): boolean;
  /** The game's own UI owns input (a window is open): its keys, Esc included, stay with the game. */
  uiOwnsInput(): boolean;
  bindings(): Readonly<Record<SpectatorAction, string>>;
  /** The game's idle frame-rate tracker, which counts window keydowns: told about every key kept from it. */
  activity?(): void;
}

export interface KeyActions {
  /** Once per press. An action with no handler yet (a later task's) is ignored. */
  press: Partial<Record<SpectatorAction, () => void>>;
  escape(): void;
  /** A seat digit (fixed keys): true when it acted, which keeps the key from everyone else. */
  seat?(n: number): boolean;
  /** A movement key went down: an edge, so a tap released before the next frame still counts (S D3 detach). */
  steer?(): void;
  /** Enter or Space (fixed keys, PS3): true while photo mode owns them, which keeps the key from everyone else. */
  capture?(repeat: boolean): boolean;
}

export interface KeyRouter { input(): FlightInput; release(): void; off(): void }

const MODIFIER_KEYS: ReadonlySet<string> = new Set(['shift', 'control', 'alt', 'meta']);

const baseOf = (binding: string): string => binding.slice(binding.lastIndexOf('+') + 1);
const isControl = (t: EventTarget | null): boolean => t instanceof Element && t.closest('button, a[href], [role="button"]') !== null;

// A bare binding also matches with Shift held (the fast key), never with Ctrl/Alt/Meta (browser shortcuts).
function matches(binding: string, combo: string, base: string, plain: boolean): boolean {
  if (!binding) return false;
  if (binding === combo) return true;
  return plain && !binding.includes('+') && binding === base;
}

/** One window capture-phase router for the life of the feature: the toggle key while idle, everything while spectating.
 * A key it acts on stops here: other QPM keybinds share bare keys (pet teams on G, Shift+S, live 2026-10-09), and
 * observer mode owns the keyboard (S D2). Keyups always pass, so held-key trackers let go. */
export function installKeys(ctx: KeyContext, actions: KeyActions, target: Window = window): KeyRouter {
  const held = new Set<string>();
  let seatHeld: string | null = null;
  let on = true;

  const take = (e: KeyboardEvent): void => {
    e.preventDefault();
    e.stopPropagation();
    ctx.activity?.();
  };

  const isHeld = (a: SpectatorAction): boolean => {
    const b = ctx.bindings()[a];
    const arrow = ARROW_FOR[a];
    return (!!b && held.has(baseOf(b))) || (arrow !== undefined && held.has(arrow));
  };
  const axis = (pos: SpectatorAction, neg: SpectatorAction): number => (isHeld(pos) ? 1 : 0) - (isHeld(neg) ? 1 : 0);

  const onDown = (e: KeyboardEvent): void => {
    // A keybind being recorded (any QPM card) is that recorder's, which listens after this router.
    if (isEditableTarget(e.target) || isKeybindRecording()) return;
    const base = canonicalKeyFromEvent(e);
    if (!base) return;
    const binds = ctx.bindings();
    const combo = normalizeKeybind(e);
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
    if (!ctx.active()) {
      // The key match comes first: the UI check resolves the engine, and idle keydowns should stay cheap. The toggle
      // key is spectator's even when another QPM keybind shares it (user decision 2026-10-09).
      if (e.repeat || !matches(binds.toggle, combo, base, plain) || ctx.enabled?.() === false || ctx.uiOwnsInput()) return;
      take(e);
      actions.press.toggle?.();
      return;
    }
    if (ctx.uiOwnsInput()) return;
    if (base === 'escape') {
      if (document.pointerLockElement) return;
      take(e);
      if (!e.repeat) actions.escape();
      return;
    }
    // A focused button or link keeps Enter and Space: a keyboard user is pressing it, not taking a photo.
    if (plain && !e.shiftKey && CAPTURE_KEYS.has(base) && !isControl(e.target) && actions.capture?.(e.repeat)) { take(e); return; }
    // Which digits are seats is the game's (userSlots); a digit with no other player there stays with everyone else.
    if (plain && !e.shiftKey && actions.seat && SEAT_DIGIT.test(base)) {
      if (e.repeat ? seatHeld === base : actions.seat(Number(base))) { seatHeld = base; take(e); return; }
    }
    let used = false;
    let steer = false;
    if (plain) { held.add(base); used = steer = ARROW_KEYS.has(base); }
    for (const a of Object.keys(binds) as SpectatorAction[]) {
      if (HELD_ONLY.has(a)) {
        if (plain && baseOf(binds[a]) === base) { used = true; steer ||= MOVE_ACTIONS.has(a); }
        continue;
      }
      // An action a later task adds has no handler yet: its key stays with whoever else listens.
      const run = actions.press[a];
      if (!run || !matches(binds[a], combo, base, plain)) continue;
      used = true;
      if (!e.repeat) run();
    }
    if (steer && !e.repeat) actions.steer?.();
    if (used && !MODIFIER_KEYS.has(base)) take(e);
  };
  // A key let go anywhere is let go, even inside a text field or a game window.
  const onUp = (e: KeyboardEvent): void => {
    const base = canonicalKeyFromEvent(e);
    if (base) held.delete(base);
    if (base === seatHeld) seatHeld = null;
  };
  const release = (): void => { held.clear(); seatHeld = null; };
  const onVisibility = (): void => { if (document.visibilityState === 'hidden') release(); };

  target.addEventListener('keydown', onDown, true);
  target.addEventListener('keyup', onUp, true);
  target.addEventListener('blur', release);
  document.addEventListener('visibilitychange', onVisibility);

  return {
    input: () => (ctx.active()
      ? { fx: axis('right', 'left'), fy: axis('forward', 'back'), up: axis('up', 'down'), fast: isHeld('fast') }
      : { fx: 0, fy: 0, up: 0, fast: false }),
    release,
    off() {
      if (!on) return;
      on = false;
      target.removeEventListener('keydown', onDown, true);
      target.removeEventListener('keyup', onUp, true);
      target.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onVisibility);
      held.clear();
    },
  };
}
