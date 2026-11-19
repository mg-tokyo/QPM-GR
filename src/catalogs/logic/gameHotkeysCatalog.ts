// The game's own keys as two catalog parts (INP-1.3). `isGameHotkey` answers null while either table is
// unread; callers then allow the key and show a may-clash note (INP-1 PD5, user 2026-11-17).

import { createBundlePartSource } from './bundlePartSource';
import type { BundlePartStatus } from './bundlePartSource';
import { GAME_HOTKEYS_MARKER, MOVEMENT_KEYS_MARKER, isGameKeyCombo, parseGameHotkeys, parseMovementKeys } from './gameHotkeysParsing';
import type { GameKeys } from './gameHotkeysParsing';
import { BAG_ATOM_MARKER, parseBagExports, parseHotkeyCallees, resolveHotkeyTargets } from './gameHotkeyTargets';
import { healthBus } from '../../diagnostics/healthBus';

export type { GameKeys } from './gameHotkeysParsing';
export { BAG_ATOM_TARGET } from './gameHotkeyTargets';

export interface GameHotkeysStatus {
  hotkeys: BundlePartStatus & { keys: string[] | null };
  movement: BundlePartStatus & { keys: string[] | null };
  unreadable: boolean;
  /** INP-1.6b: what the game's keys act on (target → combos); never degrades the clash check. */
  targets: { callees: BundlePartStatus; bagToggle: BundlePartStatus; resolved: Record<string, string[]> };
}

const HEALTH_SUBSYSTEM = 'feature:keybinds';

const hotkeySource = createBundlePartSource('game-hotkeys', GAME_HOTKEYS_MARKER, parseGameHotkeys);
const movementSource = createBundlePartSource('movement-keys', MOVEMENT_KEYS_MARKER, parseMovementKeys);
const sources = [hotkeySource, movementSource];
const calleeSource = createBundlePartSource('game-hotkey-callees', GAME_HOTKEYS_MARKER, parseHotkeyCallees);
const bagSource = createBundlePartSource('bag-toggle-exports', BAG_ATOM_MARKER, parseBagExports);
const targetSources = [calleeSource, bagSource];

let cached: GameKeys | null = null;
let cachedTargets: { callees: unknown; bag: unknown; map: Map<string, string[]> } | null = null;
let cleanups: Array<() => void> = [];
let degraded = false;

/** A table's first load finished without a value; false while loading and once a later chunk resolves it. */
export function areGameHotkeysUnreadable(): boolean {
  return sources.some(s => { const st = s.status(); return st.settled && !st.resolved; });
}

function publishHealth(): void {
  const unreadable = areGameHotkeysUnreadable();
  if (unreadable === degraded) return;
  degraded = unreadable;
  healthBus.register(HEALTH_SUBSYSTEM, { category: 'feature', status: 'starting' });
  // Recovery publishes 'recovering'; the bus owns the step back to 'ok' (diagnostics §7.2).
  healthBus.publish({
    subsystem: HEALTH_SUBSYSTEM,
    category: 'feature',
    status: unreadable ? 'degraded' : 'recovering',
    message: unreadable ? "Game's own keys not found in game code; clash checks off" : "Game's own keys read from game code",
  });
}

export function startGameHotkeysSource(): void {
  if (cleanups.length) return;
  for (const source of sources) {
    cleanups.push(source.onChange(publishHealth), source.onSettled(publishHealth));
    source.start();
  }
  for (const source of targetSources) source.start();
}

export function stopGameHotkeysSource(): void {
  for (const off of cleanups) off();
  cleanups = [];
  for (const source of [...sources, ...targetSources]) source.stop();
}

function targetMap(): Map<string, string[]> | null {
  const callees = calleeSource.get();
  if (!callees) return null;
  const exports = bagSource.get();
  const file = bagSource.status().chunk;
  if (cachedTargets?.callees !== callees || cachedTargets.bag !== exports) {
    const bag = exports && file ? { file, exports } : null;
    cachedTargets = { callees, bag: exports, map: resolveHotkeyTargets(callees, bag) };
  }
  return cachedTargets.map;
}

/** The game combos that act on a target (a panel id, or `BAG_ATOM_TARGET`); [] when none or unread. */
export function gameKeysFor(target: string): string[] {
  return targetMap()?.get(target) ?? [];
}

export function getGameKeys(): GameKeys | null {
  const hotkeys = hotkeySource.get();
  const movement = movementSource.get();
  if (!hotkeys || !movement) return null;
  if (!cached) cached = { hotkeys: new Set(hotkeys), movement: new Set(movement) };
  return cached;
}

/** True when the game itself acts on this combo; null when the game's tables are not read (yet). */
export function isGameHotkey(combo: string): boolean | null {
  const keys = getGameKeys();
  return keys ? isGameKeyCombo(keys, combo) : null;
}

/** Fires when a table resolves and once per table when its first load finishes. */
export function onGameHotkeysChange(cb: () => void): () => void {
  const offs = [...sources, ...targetSources].flatMap(s => [s.onChange(cb), s.onSettled(cb)]);
  return () => { for (const off of offs) off(); };
}

export function getGameHotkeysStatus(): GameHotkeysStatus {
  return {
    hotkeys: { ...hotkeySource.status(), keys: hotkeySource.get() },
    movement: { ...movementSource.status(), keys: movementSource.get() },
    unreadable: areGameHotkeysUnreadable(),
    targets: {
      callees: calleeSource.status(),
      bagToggle: bagSource.status(),
      resolved: Object.fromEntries(targetMap() ?? []),
    },
  };
}
