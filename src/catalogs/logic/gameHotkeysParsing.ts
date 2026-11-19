// The game's own keyboard keys from bundle text (INP-1.3, spec F7), in QPM combo form (`ctrl+alt+shift+key`,
// lowercase, as `normalizeKeybind` writes them). Beta pr-4669-gke-2911 ships both tables as Map literals:
// hotkeys `new Map([[`Space`,()=>Uu()],…,[`9`,()=>PB(8)]])` (HotkeySystem.ts:73-111) and movement
// `new Map([[`KeyW`,`up`],…,[`ArrowRight`,`right`]])` (utils/keyboardLayout.ts:84-93).

// Fixed tokens only, so the scan stays linear (memory: bundle marker regexes can hang the tab).
export const GAME_HOTKEYS_MARKER = /\[[`'"]Shift\+Space[`'"],\(\)=>/;
export const MOVEMENT_KEYS_MARKER = /\[[`'"]KeyW[`'"],[`'"]up[`'"]\]/;

const MAP_OPEN = 'new Map([';
const MAP_CLOSE = ']])';
export const MAX_HOTKEY_MAP_CHARS = 4000;
const MAX_MOVEMENT_MAP_CHARS = 400;
const HOTKEY_ENTRY = /\[([`'"])([^`'"\\\s]{1,24})\1,\(\)=>/g;
const MOVEMENT_ENTRY = /\[([`'"])(Key[A-Z]|Arrow(?:Up|Down|Left|Right))\1,([`'"])(up|down|left|right)\3\]/g;
const MODIFIER_ORDER = ['ctrl', 'alt', 'shift'] as const;

export function mapBody(text: string, markerIndex: number, maxChars: number): string | null {
  const open = text.lastIndexOf(MAP_OPEN, markerIndex);
  if (open < 0 || markerIndex - open > maxChars) return null;
  const close = text.indexOf(MAP_CLOSE, markerIndex);
  if (close < 0 || close - open > maxChars) return null;
  return text.slice(open, close + MAP_CLOSE.length);
}

function modifierOf(part: string): (typeof MODIFIER_ORDER)[number] | null {
  switch (part.toLowerCase()) {
    case 'shift': return 'shift';
    case 'alt': return 'alt';
    case 'ctrl': case 'control': case 'meta': case 'cmd': return 'ctrl';
    default: return null;
  }
}

/** `Shift+r` → `shift+r`, `Escape` → `escape`, `Alt+Space` → `alt+space`; null for an unknown modifier. */
export function gameKeyToCombo(gameKey: string): string | null {
  const parts = gameKey.split('+');
  const key = parts.pop()?.toLowerCase();
  if (!key) return null;
  const mods = new Set<string>();
  for (const part of parts) {
    const mod = modifierOf(part);
    if (!mod) return null;
    mods.add(mod);
  }
  return [...MODIFIER_ORDER.filter(m => mods.has(m)), key].join('+');
}

/** The hotkey table as QPM combos, or null when the anchor, the Map bounds or the Escape entry are missing. */
export function parseGameHotkeys(text: string): string[] | null {
  const marker = GAME_HOTKEYS_MARKER.exec(text);
  if (!marker) return null;
  const body = mapBody(text, marker.index, MAX_HOTKEY_MAP_CHARS);
  if (!body) return null;
  const combos = new Set<string>();
  for (const m of body.matchAll(HOTKEY_ENTRY)) {
    const combo = m[2] ? gameKeyToCombo(m[2]) : null;
    if (combo) combos.add(combo);
  }
  return combos.has('escape') && combos.has('shift+space') ? [...combos] : null;
}

function movementCodeToKey(code: string): string {
  return code.startsWith('Key') ? code.slice(3).toLowerCase() : code.toLowerCase();
}

/** The movement keys as QPM key names (`w`, `arrowup`), or null unless all four directions are present. */
export function parseMovementKeys(text: string): string[] | null {
  const marker = MOVEMENT_KEYS_MARKER.exec(text);
  if (!marker) return null;
  const body = mapBody(text, marker.index, MAX_MOVEMENT_MAP_CHARS);
  if (!body) return null;
  const keys = new Set<string>();
  const directions = new Set<string>();
  for (const m of body.matchAll(MOVEMENT_ENTRY)) {
    if (!m[2] || !m[4]) continue;
    keys.add(movementCodeToKey(m[2]));
    directions.add(m[4]);
  }
  return directions.size === 4 ? [...keys] : null;
}

export interface GameKeys {
  hotkeys: ReadonlySet<string>;
  movement: ReadonlySet<string>;
}

// The game's key-string rules (beta HotkeySystem.ts:291-322 `generateKeyString`, DirectionalInputSystem.ts:239-243):
// Ctrl/Meta switch every game key off; under Alt only `Alt+<key>` entries count, Shift ignored; movement
// ignores Shift; Shift on a letter folds to the bare letter unless the table holds `Shift+<letter>` (today `r`).
export function isGameKeyCombo(keys: GameKeys, combo: string): boolean {
  const parts = combo.toLowerCase().split('+');
  const key = parts.pop();
  if (!key) return false;
  const mods = new Set(parts);
  if (mods.has('ctrl') || mods.has('meta')) return false;
  if (mods.has('alt')) return keys.hotkeys.has(`alt+${key}`);
  if (keys.movement.has(key)) return true;
  if (!mods.has('shift')) return keys.hotkeys.has(key);
  if (keys.hotkeys.has(`shift+${key}`)) return true;
  return /^[a-z]$/.test(key) && keys.hotkeys.has(key);
}
