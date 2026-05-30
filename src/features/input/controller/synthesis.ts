/**
 * Keyboard and pointer event synthesis.
 * Dispatches synthetic events to the window/document so the game's input
 * listeners pick them up (they do not check isTrusted).
 */

// ---------------------------------------------------------------------------
// Keyboard synthesis
// ---------------------------------------------------------------------------

const KEY_INIT: Record<string, KeyboardEventInit> = {
  // Directions
  ArrowUp:    { key: 'ArrowUp',    code: 'ArrowUp',    keyCode: 38 },
  ArrowDown:  { key: 'ArrowDown',  code: 'ArrowDown',  keyCode: 40 },
  ArrowLeft:  { key: 'ArrowLeft',  code: 'ArrowLeft',  keyCode: 37 },
  ArrowRight: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 39 },
  // Actions
  ' ':        { key: ' ',          code: 'Space',       keyCode: 32 },
  Escape:     { key: 'Escape',     code: 'Escape',      keyCode: 27 },
  e:          { key: 'e',          code: 'KeyE',        keyCode: 69 },
  r:          { key: 'r',          code: 'KeyR',        keyCode: 82 },
  x:          { key: 'x',          code: 'KeyX',        keyCode: 88 },
  c:          { key: 'c',          code: 'KeyC',        keyCode: 67 },
  '-':        { key: '-',          code: 'Minus',       keyCode: 189 },
  '=':        { key: '=',          code: 'Equal',       keyCode: 187 },
  // Hotbar slots 1-9
  '1': { key: '1', code: 'Digit1', keyCode: 49 },
  '2': { key: '2', code: 'Digit2', keyCode: 50 },
  '3': { key: '3', code: 'Digit3', keyCode: 51 },
  '4': { key: '4', code: 'Digit4', keyCode: 52 },
  '5': { key: '5', code: 'Digit5', keyCode: 53 },
  '6': { key: '6', code: 'Digit6', keyCode: 54 },
  '7': { key: '7', code: 'Digit7', keyCode: 55 },
  '8': { key: '8', code: 'Digit8', keyCode: 56 },
  '9': { key: '9', code: 'Digit9', keyCode: 57 },
};

function makeKeyInit(key: string): KeyboardEventInit {
  return KEY_INIT[key] ?? { key, code: `Key${key.toUpperCase()}` };
}

/** Hold a key down (fires keydown). */
export function pressKey(key: string): void {
  window.dispatchEvent(
    new KeyboardEvent('keydown', { ...makeKeyInit(key), bubbles: true, cancelable: true }),
  );
}

/** Release a held key (fires keyup). */
export function releaseKey(key: string): void {
  window.dispatchEvent(
    new KeyboardEvent('keyup', { ...makeKeyInit(key), bubbles: true, cancelable: true }),
  );
}

/** Press and immediately release a key (tap). */
export function tapKey(key: string): void {
  pressKey(key);
  // Small async gap so the game's keydown handler runs before keyup
  requestAnimationFrame(() => releaseKey(key));
}

// ---------------------------------------------------------------------------
// Hotbar slot cycling (1-9)
// ---------------------------------------------------------------------------

let currentHotbarSlot = 1;

/**
 * Re-presses the currently active hotbar slot key, deselecting it.
 * Same effect as pressing the slot number again while it's selected.
 */
export function deselectHotbarSlot(): void {
  tapKey(String(currentHotbarSlot));
}

/**
 * Cycles the active hotbar slot (keys 1-9) by one step in the given direction,
 * wrapping around at the ends.
 */
export function cycleHotbar(direction: 'next' | 'prev'): void {
  if (direction === 'next') {
    currentHotbarSlot = currentHotbarSlot >= 9 ? 1 : currentHotbarSlot + 1;
  } else {
    currentHotbarSlot = currentHotbarSlot <= 1 ? 9 : currentHotbarSlot - 1;
  }
  tapKey(String(currentHotbarSlot));
}

// ---------------------------------------------------------------------------
// Movement — tracks which direction keys are currently held
// ---------------------------------------------------------------------------

const DIRECTION_KEYS = {
  up:    'ArrowUp',
  down:  'ArrowDown',
  left:  'ArrowLeft',
  right: 'ArrowRight',
} as const;

type Direction = keyof typeof DIRECTION_KEYS;

const heldDirections = new Set<Direction>();

/**
 * Updates held direction keys based on a direction vector from the gamepad.
 * `dx`/`dy` are in the range [-1, 1]; values outside the dead-zone activate
 * the corresponding direction key.
 */
export function setMoveDirection(dx: number, dy: number): void {
  const DEAD_ZONE = 0.25;

  const want: Record<Direction, boolean> = {
    up:    dy < -DEAD_ZONE,
    down:  dy >  DEAD_ZONE,
    left:  dx < -DEAD_ZONE,
    right: dx >  DEAD_ZONE,
  };

  for (const dir of Object.keys(want) as Direction[]) {
    const active = want[dir];
    if (active && !heldDirections.has(dir)) {
      heldDirections.add(dir);
      pressKey(DIRECTION_KEYS[dir]);
    } else if (!active && heldDirections.has(dir)) {
      heldDirections.delete(dir);
      releaseKey(DIRECTION_KEYS[dir]);
    }
  }
}

/** Releases all currently held direction keys (call on disconnect/pause). */
export function releaseAllDirectionKeys(): void {
  for (const dir of heldDirections) {
    releaseKey(DIRECTION_KEYS[dir]);
  }
  heldDirections.clear();
}

// ---------------------------------------------------------------------------
// Pointer / click synthesis
// ---------------------------------------------------------------------------

/**
 * Fires a full pointer+mouse click sequence at `(x, y)` in viewport coords.
 * Finds the topmost element at that point and dispatches events on it.
 */
export function clickAt(x: number, y: number): void {
  const target = document.elementFromPoint(x, y);
  if (!target) return;

  // NOTE: `view` is intentionally omitted — passing `window` here crashes in
  // Tampermonkey's sandbox because the proxy object is not a valid WindowProxy.
  const baseOpts = { clientX: x, clientY: y, bubbles: true, cancelable: true };

  // PointerEvent first (Pixi uses pointer events on the canvas)
  target.dispatchEvent(new PointerEvent('pointerdown', { ...baseOpts, pointerId: 1 }));
  target.dispatchEvent(new PointerEvent('pointerup',   { ...baseOpts, pointerId: 1 }));
  // Then mouse events (DOM UI elements)
  target.dispatchEvent(new MouseEvent('mousedown', baseOpts));
  target.dispatchEvent(new MouseEvent('mouseup',   baseOpts));
  target.dispatchEvent(new MouseEvent('click',     baseOpts));
}
