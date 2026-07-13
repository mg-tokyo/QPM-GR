import type { PillOption } from './types';

export const ACCENT = '#8f82ff';
export const BORDER_ACTIVE = 'rgba(143,130,255,0.5)';
export const BORDER_SUBTLE = 'rgba(143,130,255,0.18)';
export const TEXT = '#e8e0ff';
export const MUTED = 'rgba(232,224,255,0.6)';
export const CARD_BG = 'rgba(255,255,255,0.03)';
export const HOVER_BG = 'rgba(143,130,255,0.06)';
export const PRICE_COLOR = '#ffd84d';
export const DUST_COLOR = '#ab47bc';

export const PILL_ACTIVE_BG = 'rgba(143,130,255,0.2)';
export const PILL_ACTIVE_BORDER = 'rgba(143,130,255,0.5)';
export const PILL_INACTIVE_BG = 'rgba(143,130,255,0.08)';
export const PILL_INACTIVE_BORDER = 'rgba(143,130,255,0.18)';

export const MUT_INACTIVE_BG = 'rgba(255,255,255,0.03)';
export const MUT_INACTIVE_BORDER = 'rgba(255,255,255,0.08)';

/** Map internal mutation key → user-facing display name (hardcoded fallback) */
export const MUTATION_DISPLAY_NAMES_FALLBACK: Record<string, string> = {
  Dawncharged: 'Dawnbound',
  Ambershine: 'Amberlit',
  Ambercharged: 'Amberbound',
};

export const DUST_RARITY_MULT: Record<string, number> = {
  Common: 1,
  Uncommon: 2,
  Rare: 5,
  Legendary: 10,
  Mythical: 50,
  Divine: 50,
  Celestial: 50,
};

export const DUST_MUTATION_MULT_FALLBACK: Record<string, number> = {
  Rainbow: 50,
  Gold: 25,
};

export const FRIEND_OPTIONS: PillOption[] = [
  { label: '1', value: '1' },
  { label: '2 +10%', value: '2' },
  { label: '3 +20%', value: '3' },
  { label: '4 +30%', value: '4' },
  { label: '5 +40%', value: '5' },
  { label: '6 +50%', value: '6' },
];
