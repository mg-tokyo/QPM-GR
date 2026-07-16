import type { PillOption } from './types';

export const ACCENT = 'var(--qpm-accent)';
export const BORDER_ACTIVE = 'var(--qpm-accent-emphasis)';
export const BORDER_SUBTLE = 'var(--qpm-accent-subtle)';
export const TEXT = 'var(--qpm-text)';
export const MUTED = 'var(--qpm-text-muted)';
export const CARD_BG = 'var(--qpm-surface-2)';
export const HOVER_BG = 'var(--qpm-accent-tint)';
export const PRICE_COLOR = 'var(--qpm-gold)';
export const DUST_COLOR = 'var(--qpm-dust)';

export const PILL_ACTIVE_BG = 'var(--qpm-accent-subtle)';
export const PILL_ACTIVE_BORDER = 'var(--qpm-accent-emphasis)';
export const PILL_INACTIVE_BG = 'var(--qpm-accent-tint)';
export const PILL_INACTIVE_BORDER = 'var(--qpm-accent-border)';

export const MUT_INACTIVE_BG = 'var(--qpm-surface-2)';
export const MUT_INACTIVE_BORDER = 'var(--qpm-border)';

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
