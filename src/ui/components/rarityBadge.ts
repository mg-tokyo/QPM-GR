const RARITY_TOKENS: Record<string, string> = {
  common: 'var(--qpm-rarity-common)',
  uncommon: 'var(--qpm-rarity-uncommon)',
  rare: 'var(--qpm-rarity-rare)',
  legendary: 'var(--qpm-rarity-legendary)',
  mythic: 'var(--qpm-rarity-mythic)',
  divine: 'var(--qpm-rarity-divine)',
  celestial: 'var(--qpm-rarity-celestial)',
  // The game's enum value for Mythic is 'Mythical' (beta common/games/Quinoa/systems/rarity.ts:9).
  mythical: 'var(--qpm-rarity-mythic)',
};

/** The `--qpm-rarity-*` token for a catalog rarity, or null for an unknown one. */
export function rarityColorVar(rarity: string): string | null {
  return RARITY_TOKENS[rarity.toLowerCase()] ?? null;
}

export function createRarityBadge(rarity: string): HTMLElement {
  const el = document.createElement('span');
  const displayName = rarity.charAt(0).toUpperCase() + rarity.slice(1).toLowerCase();
  el.textContent = displayName;

  const color = rarityColorVar(rarity) ?? 'var(--qpm-text-muted)';

  el.style.cssText =
    'display:inline-flex;align-items:center;' +
    'border-radius:var(--qpm-radius-pill);' +
    'padding:2px 7px;' +
    'font-size:var(--qpm-font-caption);' +
    'font-weight:var(--qpm-weight-semibold);' +
    'font-family:var(--qpm-font);' +
    `color:${color};` +
    `background:color-mix(in srgb, ${color} 15%, transparent);` +
    `border:1px solid color-mix(in srgb, ${color} 35%, transparent);` +
    'white-space:nowrap;line-height:1.4;';

  return el;
}
