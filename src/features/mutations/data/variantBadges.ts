// Variant badge definitions for tooltips and journal UI. Built at runtime from
// the captured mutation catalog + bundle-enriched colors, so new game
// mutations appear without code changes. Letter = first letter of the display
// name, matching the game's own compact convention (MutationText.tsx).

import { getMutationCatalog } from '../../../catalogs/gameCatalogs';
import type { MutationCatalog } from '../../../catalogs/types';

export interface VariantBadge {
  matches: string[];
  label: string;
  /** Game display name, e.g. "Dawnbound" for id Dawncharged. Shown on hover. */
  displayName?: string;
  color?: string;
  gradient?: string;
  bold?: boolean;
  iconKey?: string;
}

const NORMAL_BADGE: VariantBadge = { matches: ['Normal'], label: 'N', displayName: 'Normal', color: '#FFFFFF', bold: true };
const MAX_WEIGHT_BADGE: VariantBadge = { matches: ['Max Weight', 'Max', 'Max Size'], label: 'S', displayName: 'Max Weight', color: '#BDBDBD', bold: true };

// Last-known game values — used only until the catalog is captured, or as
// color source for a mutation the bundle parse missed.
const FALLBACK_VARIANT_BADGES: VariantBadge[] = [
  { ...NORMAL_BADGE },
  { matches: ['Rainbow'], label: 'R', displayName: 'Rainbow', gradient: 'linear-gradient(135deg, #D02128, #D94C52, #FC6D30, #E9B52F, #5EAC46, #48ADF4, #6D1CF0, #AE53B0)', bold: true, iconKey: 'sprite/ui/MutationRainbow' },
  { matches: ['Gold', 'Golden'], label: 'G', displayName: 'Gold', color: '#EBC800', bold: true, iconKey: 'sprite/ui/MutationGold' },
  { matches: ['Wet'], label: 'W', displayName: 'Wet', color: '#5FFFFF', bold: true, iconKey: 'sprite/ui/MutationWet' },
  { matches: ['Chilled'], label: 'C', displayName: 'Chilled', color: '#B4E6FF', bold: true, iconKey: 'sprite/ui/MutationChilled' },
  { matches: ['Frozen'], label: 'F', displayName: 'Frozen', color: '#B9C8FF', bold: true, iconKey: 'sprite/ui/MutationFrozen' },
  { matches: ['Thunderstruck'], label: 'T', displayName: 'Thunderstruck', color: '#FFF700', bold: true, iconKey: 'sprite/ui/MutationThunderstruck' },
  { matches: ['Thundercharged'], label: 'T', displayName: 'Thundercharged', color: '#70F6CB', bold: true, iconKey: 'sprite/ui/MutationThundercharged' },
  { matches: ['Dawnlit'], label: 'D', displayName: 'Dawnlit', color: '#F59BE1', bold: true, iconKey: 'sprite/ui/MutationDawnlit' },
  { matches: ['Dawncharged', 'Dawnbound'], label: 'D', displayName: 'Dawnbound', color: '#C896FF', bold: true, iconKey: 'sprite/ui/MutationDawncharged' },
  { matches: ['Amberlit', 'Ambershine'], label: 'A', displayName: 'Amberlit', color: '#FFB478', bold: true, iconKey: 'sprite/ui/MutationAmberlit' },
  { matches: ['Ambercharged', 'Amberbound'], label: 'A', displayName: 'Amberbound', color: '#FA8C4B', bold: true, iconKey: 'sprite/ui/MutationAmbercharged' },
  { ...MAX_WEIGHT_BADGE },
];

// Journal treats these as legacy spellings of catalog variants.
const LEGACY_MATCH_ALIASES: Record<string, string[]> = {
  Gold: ['Golden'],
};

function fallbackColorFor(mutationId: string, displayName: string): { color?: string; gradient?: string } {
  const badge = FALLBACK_VARIANT_BADGES.find(b =>
    b.matches.some(m => m === mutationId || m === displayName),
  );
  if (!badge) return {};
  if (badge.gradient) return { gradient: badge.gradient };
  if (badge.color) return { color: badge.color };
  return {};
}

/**
 * Icon key derivation, verified live 2026-07-18 (11/11 mutations): the UI atlas
 * name follows the entry's world-sprite tail (which carries renames like
 * Ambershine -> Amberlit), falling back to the mutation id for growth
 * mutations that have no world sprite. Renderers must treat the key as a
 * candidate — renderBySpriteKey returns null for unknown keys.
 */
function deriveIconKey(mutationId: string, entry: MutationCatalog[string]): string {
  const sprite = typeof entry.sprite === 'string' ? entry.sprite : '';
  const tail = sprite ? sprite.split('/').pop() || mutationId : mutationId;
  return `sprite/ui/Mutation${tail}`;
}

function buildBadgesFromCatalog(catalog: MutationCatalog): VariantBadge[] {
  const badges: VariantBadge[] = [{ ...NORMAL_BADGE }];

  for (const [mutationId, entry] of Object.entries(catalog)) {
    if (mutationId.toLowerCase().includes('maxweight')) continue;

    const displayName = typeof entry.name === 'string' && entry.name ? entry.name : mutationId;
    const matches = mutationId === displayName ? [mutationId] : [mutationId, displayName];
    for (const alias of LEGACY_MATCH_ALIASES[mutationId] ?? []) {
      if (!matches.includes(alias)) matches.push(alias);
    }

    const rawColor = typeof entry.color === 'string' ? entry.color : undefined;
    const colorProps: { color?: string; gradient?: string } = rawColor
      ? rawColor.startsWith('linear-gradient(')
        ? { gradient: rawColor }
        : { color: rawColor }
      : fallbackColorFor(mutationId, displayName);

    badges.push({
      matches,
      label: (displayName[0] ?? mutationId[0] ?? '?').toUpperCase(),
      displayName,
      ...colorProps,
      bold: true,
      iconKey: deriveIconKey(mutationId, entry),
    });
  }

  badges.push({ ...MAX_WEIGHT_BADGE });
  return badges;
}

let cachedBadges: VariantBadge[] | null = null;
let cachedCatalogRef: MutationCatalog | null = null;
let cachedColorCount = -1;

/**
 * Variant badges in journal display order (Normal, dex order, Max Weight).
 * Rebuilds when the catalog object or its enriched-color count changes;
 * static fallback until the catalog is captured.
 */
export function getVariantBadges(): VariantBadge[] {
  const catalog = getMutationCatalog();
  if (!catalog) return FALLBACK_VARIANT_BADGES;

  const colorCount = Object.values(catalog).filter(e => typeof e.color === 'string').length;
  if (!cachedBadges || cachedCatalogRef !== catalog || cachedColorCount !== colorCount) {
    cachedBadges = buildBadgesFromCatalog(catalog);
    cachedCatalogRef = catalog;
    cachedColorCount = colorCount;
  }
  return cachedBadges;
}

function normalizeVariantName(name: string): string {
  return name.trim().toLowerCase();
}

export function findVariantBadge(variant: string): VariantBadge | undefined {
  const target = normalizeVariantName(variant);
  return getVariantBadges().find(badge =>
    badge.matches.some(match => normalizeVariantName(match) === target)
  );
}

function parseRgbChannels(color: string): [number, number, number] | null {
  const rgbMatch = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgbMatch) {
    return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
  }
  const hexMatch = color.match(/^#([0-9a-f]{6})$/i);
  const hex = hexMatch?.[1];
  if (hex) {
    return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
  }
  return null;
}

// Game's own contrast rule (gardenInfo/styles.ts textColorForBg).
function textColorForBackground(bg: string): string {
  const channels = parseRgbChannels(bg);
  if (!channels) return '#111111';
  const luminance = 0.299 * channels[0] + 0.587 * channels[1] + 0.114 * channels[2];
  return luminance > 150 ? '#151515' : '#FFFFFF';
}

export function getVariantChipColors(variant: string, collected: boolean): { bg: string; text: string; weight: 400 | 600 } {
  const badge = findVariantBadge(variant);
  if (!badge) {
    return {
      bg: collected ? '#4CAF50' : '#333',
      text: collected ? '#fff' : '#777',
      weight: collected ? 600 : 400,
    };
  }

  if (!collected) {
    return {
      bg: '#333',
      text: '#777',
      weight: 400,
    };
  }

  const bg = badge.gradient || badge.color || '#4CAF50';
  return {
    bg,
    text: badge.gradient ? '#111111' : textColorForBackground(bg),
    weight: 600,
  };
}
