import type { SpectatorAction } from '../settings';

// The router's fixed keys (plan Global constraints): arrows mirror WASD, Esc, the seat digits, photo Enter/Space.
export const ARROW_FOR: Partial<Record<SpectatorAction, string>> = { forward: 'arrowup', back: 'arrowdown', left: 'arrowleft', right: 'arrowright' };
export const ARROW_KEYS: ReadonlySet<string> = new Set(Object.values(ARROW_FOR));
export const MOVE_ACTIONS: ReadonlySet<SpectatorAction> = new Set(['forward', 'back', 'left', 'right']);
export const HELD_ONLY: ReadonlySet<SpectatorAction> = new Set([...MOVE_ACTIONS, 'fast']);
export const SEAT_DIGIT = /^[1-9]$/;
export const CAPTURE_KEYS: ReadonlySet<string> = new Set(['enter', 'space']);

/** Another QPM keybind in normalizeKeybind form. loose: it fires on its key with any modifiers (the Pet Hutch's). */
export interface OtherKeybind { name: string; combo: string; loose?: boolean }
export type KeyClash = { kind: 'spectator'; action: SpectatorAction } | { kind: 'other'; name: string };
export type KeyRefusal = 'fixed' | 'holdModifier';

interface Parsed { base: string; ctrlAlt: boolean; shift: boolean }

function parse(combo: string): Parsed {
  const parts = combo.split('+');
  const base = parts.pop() ?? '';
  return { base, ctrlAlt: parts.includes('ctrl') || parts.includes('alt'), shift: parts.includes('shift') };
}

// keys.ts matching: a bare binding also fires with Shift held and a hold key on its base key, both never with Ctrl/Alt,
// so every binding without Ctrl/Alt on one base key fires on one press. A Ctrl/Alt binding fires on its exact combo only.
function slotOf(action: SpectatorAction, binding: string): string {
  const p = parse(binding);
  return HELD_ONLY.has(action) || !p.ctrlAlt ? `~${p.base}` : `=${binding}`;
}

function firesOn(action: SpectatorAction, binding: string, press: string): boolean {
  const b = parse(binding);
  const p = parse(press);
  if (HELD_ONLY.has(action)) return b.base === p.base && !p.ctrlAlt;
  return binding === press || (!binding.includes('+') && binding === p.base && !p.ctrlAlt);
}

/** Every shown action that shares a press with another shown action or another QPM keybind; unlisted = no clash. */
export function findKeyClashes(
  keys: Readonly<Record<SpectatorAction, string>>, shown: readonly SpectatorAction[], others: readonly OtherKeybind[],
): Map<SpectatorAction, KeyClash[]> {
  const out = new Map<SpectatorAction, KeyClash[]>();
  for (const a of shown) {
    const binding = keys[a];
    if (!binding) continue;
    const list: KeyClash[] = [];
    const slot = slotOf(a, binding);
    for (const b of shown) {
      if (b !== a && keys[b] && slotOf(b, keys[b]) === slot) list.push({ kind: 'spectator', action: b });
    }
    for (const o of others) {
      if (!o.combo) continue;
      const hit = o.loose ? parse(binding).base === parse(o.combo).base : firesOn(a, binding, o.combo);
      if (hit) list.push({ kind: 'other', name: o.name });
    }
    if (list.length > 0) out.set(a, list);
  }
  return out;
}

/** Keys the router keeps for itself (Esc, seat digits, arrows, photo Enter/Space) and Ctrl/Alt on a hold key,
 * which the router never holds. */
export function refuseKey(action: SpectatorAction, combo: string): KeyRefusal | null {
  const { base, ctrlAlt, shift } = parse(combo);
  if (base === 'escape') return 'fixed';
  if (HELD_ONLY.has(action) && ctrlAlt) return 'holdModifier';
  if (!ctrlAlt && ARROW_KEYS.has(base)) return 'fixed';
  if (!ctrlAlt && !shift && (SEAT_DIGIT.test(base) || CAPTURE_KEYS.has(base))) return 'fixed';
  return null;
}

/** A hold key matches its base key, so Shift is dropped when recording one. */
export const holdKeyOf = (combo: string): string => (combo.startsWith('shift+') ? combo.slice('shift+'.length) : combo);

export const isHoldAction = (a: SpectatorAction): boolean => HELD_ONLY.has(a);
