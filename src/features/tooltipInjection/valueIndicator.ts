// src/features/tooltipInjection/valueIndicator.ts
// Sell price calculation and display in crop tooltips.

import { getPlantSpecies, getAllPlantSpecies, areCatalogsReady } from '../../catalogs/gameCatalogs';
import { computeMutationMultiplier } from '../../utils/cropMultipliers';
import { getAnySpriteDataUrl } from '../../sprite-v2/compat';
import { formatCoins } from '../../utils/formatters';
import { storage } from '../../utils/storage';
import { getFriendBonusMultiplier, onFriendBonusChange } from '../../store/friendBonus';
import { resolveCurrentSlot } from './atoms';
import { getAriesValueRow } from './ariesCompat';
import { TOOLTIP_ROW_ATTR, TILE_VALUE_STORAGE_KEY } from './types';
import type { TileValueConfig, ResolvedSlot } from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: TileValueConfig = { enabled: true };
let config: TileValueConfig = { ...DEFAULT_CONFIG };

export function getTileValueConfig(): TileValueConfig {
  return { ...config };
}

export function setTileValueConfig(updates: Partial<TileValueConfig>): void {
  config = { ...config, ...updates };
  storage.set(TILE_VALUE_STORAGE_KEY, config);
}

export function loadTileValueConfig(): void {
  const saved = storage.get<TileValueConfig>(TILE_VALUE_STORAGE_KEY, DEFAULT_CONFIG);
  config = { ...DEFAULT_CONFIG, ...saved };
}

// ---------------------------------------------------------------------------
// Coin sprite (cached)
// ---------------------------------------------------------------------------

let coinSpriteUrl: string | null | undefined;

function getCoinSpriteUrl(): string | null {
  if (coinSpriteUrl !== undefined) return coinSpriteUrl;
  const url = getAnySpriteDataUrl('sprite/ui/Coin') || getAnySpriteDataUrl('ui/Coin') || null;
  coinSpriteUrl = url;
  return coinSpriteUrl;
}

// ---------------------------------------------------------------------------
// Sell price calculation (pure)
// ---------------------------------------------------------------------------

function findPlantEntry(species: string): ReturnType<typeof getPlantSpecies> {
  // 1. Direct match
  const direct = getPlantSpecies(species);
  if (direct?.crop) return direct;

  // 2. Suffix match: atom species may include a variant prefix
  //    e.g. "OrangeTulip" -> catalog key "Tulip"
  const speciesLower = species.toLowerCase();
  let bestKey: string | null = null;
  for (const key of getAllPlantSpecies()) {
    const keyLower = key.toLowerCase();
    if (keyLower.length >= speciesLower.length) continue;
    if (speciesLower.endsWith(keyLower)) {
      if (!bestKey || key.length > bestKey.length) bestKey = key;
    }
  }
  if (bestKey) {
    const entry = getPlantSpecies(bestKey);
    if (entry?.crop) return entry;
  }

  return null;
}

function calculateSellPrice(species: string, scale: number, mutations: string[]): number | null {
  if (!areCatalogsReady()) return null;

  const plantEntry = findPlantEntry(species);
  const baseSellPrice = plantEntry?.crop?.baseSellPrice;
  if (typeof baseSellPrice !== 'number' || baseSellPrice <= 0) return null;

  const { totalMultiplier } = computeMutationMultiplier(mutations);
  const basePrice = Math.round(baseSellPrice * scale * totalMultiplier);
  return Math.round(basePrice * getFriendBonusMultiplier());
}

// ---------------------------------------------------------------------------
// Mutation prefix stripping
// ---------------------------------------------------------------------------

const MUTATION_PREFIXES = [
  'Rainbow', 'Gold', 'Golden', 'Frozen', 'Amber', 'Wet', 'Chilled',
  'Dawnlit', 'Dawnbound', 'Amberbound', 'Thunderstruck',
  'Ambershine', 'Ambercharged', 'Dawncharged',
];

function stripMutationPrefix(species: string): string {
  for (const prefix of MUTATION_PREFIXES) {
    if (species.startsWith(prefix + ' ')) {
      return species.slice(prefix.length + 1);
    }
  }
  return species;
}

// ---------------------------------------------------------------------------
// DOM injection
// ---------------------------------------------------------------------------

const CONTENT_ID_ATTR = 'data-qpm-content-id';

function buildContentId(data: ResolvedSlot, price: number): string {
  return `${data.slotId}:${data.targetScale.toFixed(4)}:${price}`;
}

function ensureValueRow(container: HTMLElement, price: number, contentId: string): void {
  const ROW_SEL = `:scope > [${TOOLTIP_ROW_ATTR}="value"]`;
  let row = container.querySelector(ROW_SEL) as HTMLElement | null;

  if (!row) {
    row = document.createElement('span');
    row.setAttribute(TOOLTIP_ROW_ATTR, 'value');

    const coinUrl = getCoinSpriteUrl();
    if (coinUrl) {
      const img = document.createElement('img');
      img.src = coinUrl;
      img.alt = 'coin';
      img.draggable = false;
      row.appendChild(img);
    }

    const text = document.createElement('span');
    row.appendChild(text);

    // Position after journal badge row or Aries row
    const journalRow = container.querySelector(`[${TOOLTIP_ROW_ATTR}="journal"]`);
    if (journalRow) {
      journalRow.insertAdjacentElement('afterend', row);
    } else {
      const ariesRow = getAriesValueRow(container);
      if (ariesRow) {
        ariesRow.insertAdjacentElement('afterend', row);
      } else {
        container.appendChild(row);
      }
    }
  }

  // Update text content
  const textEl = row.querySelector('span');
  if (textEl) {
    textEl.textContent = formatCoins(price);
  }
  row.setAttribute(CONTENT_ID_ATTR, contentId);
}

function removeValueRow(container: HTMLElement): void {
  const row = container.querySelector(`[${TOOLTIP_ROW_ATTR}="value"]`);
  row?.remove();
}

// ---------------------------------------------------------------------------
// Friend bonus subscription
// ---------------------------------------------------------------------------

let friendBonusUnsub: (() => void) | null = null;
let reinjectCallback: (() => void) | null = null;

export function startFriendBonusWatch(reinject: () => void): void {
  reinjectCallback = reinject;
  friendBonusUnsub = onFriendBonusChange(() => reinjectCallback?.());
}

export function stopFriendBonusWatch(): void {
  friendBonusUnsub?.();
  friendBonusUnsub = null;
  reinjectCallback = null;
}

// ---------------------------------------------------------------------------
// Injector (registered with observer)
// ---------------------------------------------------------------------------

export function injectTileValue(
  container: HTMLElement,
  _cropNameEl: HTMLElement,
): void {
  if (!config.enabled) {
    removeValueRow(container);
    return;
  }

  const data = resolveCurrentSlot();
  if (!data) {
    removeValueRow(container);
    return;
  }

  const baseSpecies = stripMutationPrefix(data.species);
  const price = calculateSellPrice(baseSpecies, data.targetScale, data.mutations);
  if (price === null || price <= 0) {
    removeValueRow(container);
    return;
  }

  // Skip if identical content is already rendered (prevents watch -> inject loop)
  const contentId = buildContentId(data, price);
  const existing = container.querySelector(`:scope > [${TOOLTIP_ROW_ATTR}="value"]`);
  if (existing && existing.getAttribute(CONTENT_ID_ATTR) === contentId) {
    return;
  }

  ensureValueRow(container, price, contentId);
}
