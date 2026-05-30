import { getAnySpriteDataUrl, getPetSpriteDataUrlWithMutations, isSpritesReady } from '../../../sprite-v2/compat';
import { getAbilityColor, normalizeAbilityName } from '../../../utils/petCardRenderer';

const locationSpriteCache = new Map<string, string>();

function resolveLocationSpriteUrl(location: string): string {
  if (locationSpriteCache.has(location)) return locationSpriteCache.get(location)!;

  let url = '';
  if (location === 'inventory') {
    url = getAnySpriteDataUrl('sprite/ui/InventoryBag');
  } else if (location === 'hutch') {
    url = getAnySpriteDataUrl('sprite/decor/PetHutch');
  }

  if (url) locationSpriteCache.set(location, url);
  return url;
}

export function getLocationIcon(location: string): HTMLElement {
  const loc = location.toLowerCase();

  if (loc === 'active') {
    const dot = document.createElement('span');
    dot.style.cssText = 'display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--qpm-positive);flex-shrink:0;';
    dot.title = 'Active';
    return dot;
  }

  if (isSpritesReady()) {
    const url = resolveLocationSpriteUrl(loc);
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = '';
      img.title = loc === 'hutch' ? 'Hutch' : 'Inventory';
      img.style.cssText = 'width:16px;height:16px;object-fit:contain;image-rendering:pixelated;display:block;flex-shrink:0;';
      return img;
    }
  }

  // Fallback to emoji
  const fallback = document.createElement('span');
  fallback.style.cssText = 'font-size:12px;line-height:1;';
  if (loc === 'inventory') {
    fallback.textContent = '\u{1F4E6}';
    fallback.title = 'Inventory';
  } else if (loc === 'hutch') {
    fallback.textContent = '\u{1F3E0}';
    fallback.title = 'Hutch';
  } else {
    fallback.textContent = '\u{2022}';
    fallback.title = location;
  }
  return fallback;
}

export function getPetSprite(
  species: string | null | undefined,
  hasRainbow: boolean,
  hasGold: boolean,
): string {
  if (!isSpritesReady()) return '';
  const name = (species ?? '').trim();
  if (!name) return '';
  const mutations = hasRainbow ? ['Rainbow'] : hasGold ? ['Gold'] : [];
  return getPetSpriteDataUrlWithMutations(name, mutations);
}

export function renderAbilitySquares(
  abilities: string[],
  size: number,
): string {
  if (!abilities || abilities.length === 0) return '';

  const squares = abilities.slice(0, 3).map((abilityName) => {
    const color = getAbilityColor(abilityName);
    const normalizedName = normalizeAbilityName(abilityName);
    return `
      <div title="${normalizedName}" style="
        width: ${size}px;
        height: ${size}px;
        background: ${color.base};
        border: 1px solid rgba(255,255,255,0.25);
        box-shadow: 0 0 4px ${color.glow};
        border-radius: 2px;
      "></div>
    `;
  }).join('');

  return `
    <div style="
      display: flex;
      flex-direction: column;
      gap: 2px;
      justify-content: center;
      flex-shrink: 0;
    ">${squares}</div>
  `;
}
