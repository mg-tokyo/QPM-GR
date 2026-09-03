import { getPetSpriteCanvas } from '../../sprite-v2/compat';
import { getMutationSpriteDataUrl } from './petMutationRenderer';
import { canvasToDataUrl } from '../dom/canvasHelpers';
import { getSpeciesXpPerLevel, calculateMaxStrength } from '../../store/xpTracker';
import { getAbilityDef, getPetAbilitiesCatalog } from '../../catalogs/gameCatalogs';
import { getAbilityDefinition } from '../../features/pets/data/petAbilities';

interface PetCardConfig {
  species: string;
  name?: string;
  xp?: number;
  targetScale?: number;
  abilities?: string[];
  mutations?: string[];
  size?: 'small' | 'medium' | 'large'; // small: 48px, medium: 64px (default), large: 96px
}

/**
 * Normalize ability name for display
 * Converts camelCase or PascalCase ability IDs to human-readable names
 */
export function normalizeAbilityName(abilityId: string): string {
  if (!abilityId) return '';

  const catalogName = getAbilityDefinition(abilityId)?.name;
  if (typeof catalogName === 'string' && catalogName.trim().length > 0) {
    return catalogName.trim();
  }

  // Add spaces before capital letters and numbers
  const withSpaces = abilityId
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Z])/g, '$1 $2');

  return withSpaces
    .replace(/\bII\b/g, 'II')
    .replace(/\bIII\b/g, 'III')
    .replace(/\bIV\b/g, 'IV')
    .replace(/\bXp\b/gi, 'XP')
    .replace(/_NEW\b/g, '')
    .trim();
}

function normalizeAbilityLookup(value: string): string {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

const abilityLookupIndex = new Map<string, string>();
let indexedCatalogRef: unknown = null;

function ensureAbilityLookupIndex(): void {
  const catalog = getPetAbilitiesCatalog();
  if (!catalog || catalog === indexedCatalogRef) return;

  abilityLookupIndex.clear();
  for (const [abilityId, entry] of Object.entries(catalog)) {
    const keys = new Set<string>();
    keys.add(abilityId);
    keys.add(normalizeAbilityName(abilityId));

    const rawName = (entry as Record<string, unknown> | null)?.name;
    if (typeof rawName === 'string' && rawName.trim()) {
      keys.add(rawName.trim());
    }

    for (const key of keys) {
      const normalized = normalizeAbilityLookup(key);
      if (!normalized || abilityLookupIndex.has(normalized)) continue;
      abilityLookupIndex.set(normalized, abilityId);
    }
  }
  indexedCatalogRef = catalog;
}

function resolveAbilityId(input: string): string | null {
  const raw = String(input || '').trim();
  if (!raw) return null;

  // Fast path: exact ID.
  if (getAbilityDef(raw)) return raw;

  ensureAbilityLookupIndex();
  const normalized = normalizeAbilityLookup(raw);
  if (!normalized) return null;
  return abilityLookupIndex.get(normalized) ?? null;
}

// Game's own default when its ability-color switch hits `default` (see beta
// src/games/Quinoa/constants/colors.ts). Used only until enrichment populates
// entry.color, or for abilities the game itself has no color for.
const DEFAULT_ABILITY_UI_COLOR = { base: '#969696', glow: 'rgba(150,150,150,0.6)', text: '#FFF' } as const;

function readColorValue(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) {
    return `#${Math.max(0, Math.min(0xFFFFFF, value)).toString(16).padStart(6, '0')}`;
  }
  return null;
}

function hexToRgba(hex: string, alpha: number): string | null {
  if (!hex.startsWith('#')) return null;
  let h = hex.slice(1);
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6 && h.length !== 8) return null;
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
  return `rgba(${r},${g},${b},${alpha})`;
}

export function getAbilityColor(abilityName: string): { base: string; glow: string; text: string } {
  const resolvedAbilityId = resolveAbilityId(abilityName) ?? abilityName;
  const entry = getAbilityDef(resolvedAbilityId) as Record<string, unknown> | null;
  if (!entry) return DEFAULT_ABILITY_UI_COLOR;

  const colorObj = entry.color;
  if (colorObj && typeof colorObj === 'object') {
    const record = colorObj as Record<string, unknown>;
    const bg = readColorValue(record.bg) ?? readColorValue(record.base);
    if (bg) {
      const hover = readColorValue(record.hover);
      return { base: bg, glow: hover ?? hexToRgba(bg, 0.6) ?? bg, text: '#FFF' };
    }
  }
  for (const key of ['uiColor', 'hexColor', 'tint', 'displayColor', 'color'] as const) {
    const parsed = readColorValue(entry[key]);
    if (parsed) return { base: parsed, glow: hexToRgba(parsed, 0.6) ?? parsed, text: '#FFF' };
  }
  return DEFAULT_ABILITY_UI_COLOR;
}

export function renderAbilitySquares(abilities: string[], size: number = 14): string {
  if (!abilities || abilities.length === 0) return '';
  const displayed = abilities.slice(0, 4);
  return displayed.map(ability => {
    const colors = getAbilityColor(ability);
    return `<div class="pet-card-ability-square" title="${ability}" style="background:${colors.base};border:1px solid rgba(255,255,255,0.3);box-shadow:0 0 6px ${colors.glow};width:${size}px;height:${size}px;border-radius:3px;"></div>`;
  }).join('');
}

export function calculatePetStrength(species: string, xp: number, targetScale: number): number {
  const maxStrength = calculateMaxStrength(targetScale, species);
  const xpPerLevel = getSpeciesXpPerLevel(species);

  if (!xpPerLevel || xpPerLevel <= 0 || !maxStrength) return 0;

  const level = Math.min(30, Math.floor(xp / xpPerLevel));
  const baseStrength = 50;
  const strengthPerLevel = (maxStrength - baseStrength) / 30;
  return Math.min(maxStrength, Math.round(baseStrength + level * strengthPerLevel));
}

export function calculatePetLevel(species: string, xp: number): number | null {
  const xpPerLevel = getSpeciesXpPerLevel(species);
  if (!xpPerLevel || xpPerLevel <= 0) return null;
  return Math.min(30, Math.floor(xp / xpPerLevel));
}

/** Returns complete pet card HTML with abilities + sprite + name + STR. */
export function renderPetCard(config: PetCardConfig): string {
  const {
    species: rawSpecies,
    name,
    xp = 0,
    targetScale = 1,
    abilities = [],
    mutations = [],
    size = 'medium',
  } = config;

  const species = String(rawSpecies || '').trim();
  if (!species) {
    return '<div style="font-size: 32px;">🐾</div>';
  }

  const sizeMap = {
    small: { sprite: 48, ability: 10, padding: 8 },
    medium: { sprite: 64, ability: 14, padding: 12 },
    large: { sprite: 96, ability: 18, padding: 16 },
  };
  
  const dimensions = sizeMap[size];
  const spriteSize = dimensions.sprite;
  const abilitySize = dimensions.ability;
  
  const strength = xp > 0 ? calculatePetStrength(species, xp, targetScale) : 0;

  // Get sprite (apply mutation hierarchy: Rainbow > Gold)
  let sprite: string | null | undefined;
  if (mutations.includes('rainbow') || mutations.includes('Rainbow')) {
    sprite = getMutationSpriteDataUrl(species, 'rainbow');
  } else if (mutations.includes('gold') || mutations.includes('Gold')) {
    sprite = getMutationSpriteDataUrl(species, 'gold');
  }

  if (!sprite) {
    sprite = canvasToDataUrl(getPetSpriteCanvas(species));
  }

  const abilitySquares = renderAbilitySquares(abilities, abilitySize);
  const displayName = name || species;
  
  return `
    <div class="qpm-pet-card" style="position: relative; padding: ${dimensions.padding}px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(30,20,45,0.9); display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: ${spriteSize + dimensions.padding * 2 + 30}px;">
      ${abilitySquares ? `<div class="qpm-pet-card-abilities" style="position: absolute; left: 12px; top: ${dimensions.padding + spriteSize / 2}px; transform: translateY(-50%); display: flex; flex-direction: column; gap: 3px; z-index: 2;">${abilitySquares}</div>` : ''}
      <div class="qpm-pet-card-sprite" style="width: ${spriteSize}px; height: ${spriteSize}px; display: flex; align-items: center; justify-content: center;">
        ${sprite ? `<img src="${sprite}" alt="${displayName}" style="width: 100%; height: 100%; object-fit: contain;" />` : `<div style="font-size: ${spriteSize / 2}px; opacity: 0.4;">🐾</div>`}
      </div>
      <div class="qpm-pet-card-name" style="font-size: 13px; font-weight: 700; color: #e2e8f0; text-align: center; line-height: 1.2; max-width: 100%; word-wrap: break-word;">${displayName}</div>
      <div class="qpm-pet-card-str" style="font-size: 12px; font-weight: 700; color: #a78bfa; background: rgba(168,139,250,0.15); padding: 3px 8px; border-radius: 6px;">STR: ${strength}</div>
    </div>
  `;
}

/** Pet species icon for filter cards — sprite + name, no STR label. */
export function renderPetSpeciesIcon(species: string): string {
  const speciesStr = String(species || '').trim();
  if (!speciesStr) {
    return '<div style="font-size: 16px;">🐾</div>';
  }

  // Get base sprite (no mutations for filter cards)
  const sprite = canvasToDataUrl(getPetSpriteCanvas(speciesStr));

  return `
    <div class="qpm-pet-species-icon" style="display: inline-flex; align-items: center; gap: 6px;">
      ${sprite ? `<img src="${sprite}" alt="${speciesStr}" style="width: 24px; height: 24px; object-fit: contain; border-radius: 4px; border: 1px solid rgba(168,139,250,0.2);" />` : `<div style="font-size: 16px;">🐾</div>`}
      <span style="font-size: 12px; font-weight: 600; color: #e2e8f0;">${speciesStr}</span>
    </div>
  `;
}

/** Compact pet sprite for lists/trackers — abilities + name + STR in a smaller layout. */
export function renderCompactPetSprite(config: PetCardConfig): string {
  const {
    species: rawSpecies,
    name,
    xp = 0,
    targetScale = 1,
    abilities = [],
    mutations = [],
  } = config;

  const species = String(rawSpecies || '').trim();
  if (!species) {
    return '<div style="font-size: 16px;">🐾</div>';
  }

  const strength = xp > 0 ? calculatePetStrength(species, xp, targetScale) : 0;
  let sprite: string | null | undefined;

  if (mutations.includes('rainbow') || mutations.includes('Rainbow')) {
    sprite = getMutationSpriteDataUrl(species, 'rainbow');
  } else if (mutations.includes('gold') || mutations.includes('Gold')) {
    sprite = getMutationSpriteDataUrl(species, 'gold');
  }

  if (!sprite) {
    sprite = canvasToDataUrl(getPetSpriteCanvas(species));
  }
  
  const abilitySquares = renderAbilitySquares(abilities, 10);
  const displayName = name || species;
  
  return `
    <div class="qpm-compact-pet" style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 6px; background: rgba(30,20,45,0.7); border: 1px solid rgba(168,139,250,0.2);">
      <div style="position: relative;">
        ${abilitySquares ? `<div style="position: absolute; left: -14px; top: 50%; transform: translateY(-50%); display: flex; flex-direction: column; gap: 2px;">${abilitySquares}</div>` : ''}
        ${sprite ? `<img src="${sprite}" alt="${displayName}" style="width: 32px; height: 32px; object-fit: contain;" />` : `<div style="font-size: 16px;">🐾</div>`}
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <span style="font-size: 12px; font-weight: 700; color: #e2e8f0;">${displayName}</span>
        <span style="font-size: 10px; font-weight: 700; color: #a78bfa;">STR: ${strength}</span>
      </div>
    </div>
  `;
}
