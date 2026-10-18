import type { SeatedPlayer } from '../players';
import type { SpectatorState } from '../state';

const HOTBAR_GAP = 8;
const EDGE = 8;
// Unreadable hotbar (drift): its height on a 632 px window at 1448 (top 504) is close enough to stay clear of it.
const FALLBACK_BOTTOM = 128;

export type ChipState = { kind: 'paused' } | { kind: 'mode'; mode: SpectatorState['mode']; view: string };

/** 'ui' is a game window owning input, not the game taking the camera: the mode stays on show (the bar hides). */
export function chipState(s: Pick<SpectatorState, 'mode' | 'view' | 'paused'>): ChipState {
  if (s.paused !== null && s.paused !== 'ui') return { kind: 'paused' };
  return { kind: 'mode', mode: s.mode, view: s.view.toUpperCase() };
}

export type SwitcherState = { kind: 'follow'; player: SeatedPlayer } | { kind: 'choose'; canCycle: boolean } | { kind: 'nobody' };

export function switcherState(targetId: string | null, list: readonly SeatedPlayer[]): SwitcherState {
  const player = targetId === null ? undefined : list.find((p) => p.id === targetId);
  if (player) return { kind: 'follow', player };
  if (list.length === 0) return { kind: 'nobody' };
  return { kind: 'choose', canCycle: list.some((p) => p.online) };
}

export const barVisible = (s: Pick<SpectatorState, 'active' | 'uiHidden' | 'paused'>): boolean =>
  s.active && !s.uiHidden && s.paused !== 'ui';

/** CSS `bottom` that keeps the bar just above the game's hotbar and inside the window. */
export function barBottomPx(hotbarTop: number | null, winH: number, barH: number): number {
  const want = hotbarTop !== null && Number.isFinite(hotbarTop) ? winH - hotbarTop + HOTBAR_GAP : FALLBACK_BOTTOM;
  return Math.round(Math.max(EDGE, Math.min(winH - barH - EDGE, want)));
}

/** The game's action id as words ("plantSeed" → "Plant seed"); no list of action names is kept. */
export function humanizeAction(id: string): string {
  const words = id.replace(/[_-]+/g, ' ').replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim().toLowerCase();
  return words ? words[0]!.toUpperCase() + words.slice(1) : '';
}

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [['day', 86_400_000], ['hour', 3_600_000], ['minute', 60_000]];

/** Whole units back from now, for Intl.RelativeTimeFormat. */
export function agoParts(atMs: number, nowMs: number): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const ms = Math.max(0, nowMs - atMs);
  for (const [unit, size] of UNITS) {
    if (ms >= size) return { value: -Math.floor(ms / size), unit };
  }
  return { value: -Math.floor(ms / 1000) || 0, unit: 'second' };
}

/** How long the agoParts label of `atMs` keeps reading the same. */
export function msUntilAgoChanges(atMs: number, nowMs: number): number {
  const age = nowMs - atMs;
  if (age < 0) return 1000 - age;
  const size = UNITS.find(([, s]) => age >= s)?.[1] ?? 1000;
  return size - (age % size);
}
