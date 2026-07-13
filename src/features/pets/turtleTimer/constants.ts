import type { TurtleResolvedConfig, TurtleSupportKind } from './types';

export const MANUAL_OVERRIDES_STORAGE_KEY = 'qpm-turtle-manual-overrides';

export const GROWTH_ABILITY_PATTERNS = [
  { kind: 'plant' as const, patterns: ['plantgrowthboost'] },
  { kind: 'egg' as const, patterns: ['egggrowthboost'] },
] as const;

export const SUPPORT_PATTERNS: Record<TurtleSupportKind, readonly string[]> = {
  restore: ['hungerrestore'],
  slow: ['hungerboost'],
};

export const RESTORE_PCT_BY_LEVEL = [0, 30, 35, 40, 45];
export const RESTORE_PROC_ODDS_BY_LEVEL = [0, 0.12, 0.14, 0.16, 0.18];
export const SLOW_PCT_BY_LEVEL = [0, 12, 16, 20, 24];

export const COMPLETION_LOG_KEY = 'qpm-turtle-completion-log';
export const MAX_LOG_ENTRIES = 50;

export const FOCUS_KEY_SEPARATOR = '::';

export const DEFAULT_CONFIG: TurtleResolvedConfig = {
  enabled: true,
  includeBoardwalk: true,
  minActiveHungerPct: 2,
  fallbackTargetScale: 1.5,
  focus: 'latest',
  maxTargetScale: 2.5,
  focusTargetTileId: null,
  focusTargetSlotIndex: null,
  eggFocus: 'latest',
  eggFocusTargetTileId: null,
  eggFocusTargetSlotIndex: null,
};
