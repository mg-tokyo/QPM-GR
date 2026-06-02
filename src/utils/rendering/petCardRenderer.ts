// src/utils/petCardRenderer.ts - Generate Pet Hub-style pet cards with abilities + name + STR
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

  // Special replacements for common patterns
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

/**
 * Get ability color configuration
 */
export function getAbilityColor(abilityName: string): { base: string; glow: string; text: string } {
  const resolvedAbilityId = resolveAbilityId(abilityName) ?? abilityName;
  const name = normalizeAbilityLookup(resolvedAbilityId || abilityName);
  const catalogEntry = getAbilityDef(resolvedAbilityId);

  // Prefer runtime-catalog color if present.
  // Handles unknown/new abilities with authoritative in-game colors when exposed.
  const readColorValue = (value: unknown): string | null => {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) {
      return `#${Math.max(0, Math.min(0xFFFFFF, value)).toString(16).padStart(6, '0')}`;
    }
    return null;
  };
  const readCatalogColor = (): { base: string; glow: string } | null => {
    const entry = catalogEntry as Record<string, unknown> | null;
    if (!entry) return null;

    // Gemini-style enriched shape: entry.color = { bg, hover }
    const colorObj = entry.color;
    if (colorObj && typeof colorObj === 'object') {
      const record = colorObj as Record<string, unknown>;
      const bg = readColorValue(record.bg) ?? readColorValue(record.base);
      const hover = readColorValue(record.hover);
      if (bg) return { base: bg, glow: hover ?? bg };
    }

    const directKeys = ['uiColor', 'hexColor', 'tint', 'displayColor', 'color'];
    for (const key of directKeys) {
      const parsed = readColorValue(entry[key]);
      if (parsed) return { base: parsed, glow: parsed };
    }
    const baseParams = entry.baseParameters as Record<string, unknown> | undefined;
    if (baseParams && typeof baseParams === 'object') {
      for (const key of directKeys) {
        const parsed = readColorValue(baseParams[key]);
        if (parsed) return { base: parsed, glow: parsed };
      }
    }
    return null;
  };
  const runtimeColor = readCatalogColor();
  if (runtimeColor) {
    return { base: runtimeColor.base, glow: runtimeColor.glow, text: '#FFF' };
  }
  
  // Kissers
  if (name.includes('moonkisser')) return { base: '#FAA623', glow: 'rgba(250,166,35,0.6)', text: '#FFF' };
  if (name.includes('dawnkisser')) return { base: '#A25CF2', glow: 'rgba(162,92,242,0.6)', text: '#FFF' };

  // Rainbow and Gold granters
  if (name.includes('rainbowgranter') || name.includes('rainbow')) return { base: 'linear-gradient(45deg, #C80000, #C87800, #A0AA1E, #3CAA3C, #32AAAA, #2896B4, #145AB4, #461E96)', glow: 'rgba(124,77,255,0.7)', text: '#FFF' };
  if (name.includes('goldgranter') || name.includes('golden') || name === 'gold') return { base: 'linear-gradient(135deg, #DCC846 0%, #D2AF05 40%, #D2B937 70%, #C8AF1E 100%)', glow: 'rgba(220,200,70,0.75)', text: '#000' };

  // Produce/Crop Scale: #228B22
  if (name.includes('producescaleboost') || name.includes('cropsize') || name.includes('snowycropsize')) return { base: '#228B22', glow: 'rgba(34,139,34,0.6)', text: '#FFF' };

  // Plant Growth: #008080
  if (name.includes('plantgrowth') || name.includes('producegrowth')) return { base: '#008080', glow: 'rgba(0,128,128,0.6)', text: '#FFF' };

  // Egg Growth: #B45AF0
  if (name.includes('egggrowth')) return { base: '#B45AF0', glow: 'rgba(180,90,240,0.6)', text: '#FFF' };

  // Pet Age Boost: #9370DB
  if (name.includes('petageboost') || name.includes('maxstrength') || name.includes('strengthboost')) return { base: '#9370DB', glow: 'rgba(147,112,219,0.6)', text: '#FFF' };

  // Pet Hatch Size Boost: #800080
  if (name.includes('pethatchsizeboost') || name.includes('hatchxp')) return { base: '#800080', glow: 'rgba(128,0,128,0.6)', text: '#FFF' };

  // Pet XP Boost: #1E90FF
  if (name.includes('xpboost')) return { base: '#1E90FF', glow: 'rgba(30,144,255,0.6)', text: '#FFF' };

  // Hunger Restore: #FF69B4 (check before generic hunger)
  if (name.includes('hungerrestore')) return { base: '#FF69B4', glow: 'rgba(255,105,180,0.6)', text: '#FFF' };

  // Hunger Boost: #FF1493
  if (name.includes('hunger')) return { base: '#FF1493', glow: 'rgba(255,20,147,0.6)', text: '#FFF' };

  // Sell Boost: #DC143C
  if (name.includes('sellboost')) return { base: '#DC143C', glow: 'rgba(220,20,60,0.6)', text: '#FFF' };

  // Coin Finder: #B49600
  if (name.includes('coinfinder')) return { base: '#B49600', glow: 'rgba(180,150,0,0.65)', text: '#FFF' };

  // Produce Mutation Boost + Dawn/Amber weather boosts: #8C0F46
  if (name.includes('producemutation') || name.includes('cropmutation') || name.includes('dawnboost') || name.includes('ambermoonboost')) return { base: '#8C0F46', glow: 'rgba(140,15,70,0.6)', text: '#FFF' };

  // Double Harvest: #0078B4
  if (name.includes('doubleharvest')) return { base: '#0078B4', glow: 'rgba(0,120,180,0.6)', text: '#FFF' };

  // Double Hatch: #3C5AB4
  if (name.includes('doublehatch')) return { base: '#3C5AB4', glow: 'rgba(60,90,180,0.6)', text: '#FFF' };

  // Produce Eater: #FF4500
  if (name.includes('produceeater') || name.includes('cropeater')) return { base: '#FF4500', glow: 'rgba(255,69,0,0.6)', text: '#FFF' };

  // Produce Refund: #FF6347
  if (name.includes('producerefund') || name.includes('croprefund')) return { base: '#FF6347', glow: 'rgba(255,99,71,0.6)', text: '#FFF' };

  // Pet Mutation Boost: #A03264
  if (name.includes('petmutation')) return { base: '#A03264', glow: 'rgba(160,50,100,0.6)', text: '#FFF' };

  // Pet Refund: #005078
  if (name.includes('petrefund')) return { base: '#005078', glow: 'rgba(0,80,120,0.6)', text: '#FFF' };

  // Copycat: #FF8C00
  if (name.includes('copycat')) return { base: '#FF8C00', glow: 'rgba(255,140,0,0.6)', text: '#FFF' };

  // Seed Finder: #A86626
  if (name.includes('seedfinder')) return { base: '#A86626', glow: 'rgba(168,102,38,0.6)', text: '#FFF' };

  // Rain Dance: #4CCCCC
  if (name.includes('raindance')) return { base: '#4CCCCC', glow: 'rgba(76,204,204,0.6)', text: '#FFF' };

  // Snow Granter: #90B8CC
  if (name.includes('snowgranter')) return { base: '#90B8CC', glow: 'rgba(144,184,204,0.6)', text: '#FFF' };

  // Frost Granter: #94A0CC
  if (name.includes('frostgranter')) return { base: '#94A0CC', glow: 'rgba(148,160,204,0.6)', text: '#FFF' };

  // Dawnlit Granter: #C47CB4
  if (name.includes('dawnlitgranter')) return { base: '#C47CB4', glow: 'rgba(196,124,180,0.6)', text: '#FFF' };

  // Amberlit Granter: #CC9060
  if (name.includes('amberlitgranter')) return { base: '#CC9060', glow: 'rgba(204,144,96,0.6)', text: '#FFF' };
  
  // Default: deterministic dynamic color so new/unknown abilities are not all gray.
  const source = name || 'ability';
  let hash = 0;
  for (let i = 0; i < source.length; i += 1) {
    hash = ((hash << 5) - hash) + source.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  const sat = 68 + (Math.abs(hash) % 18); // 68-85
  const light = 56 + (Math.abs(hash) % 10); // 56-65
  const base = `hsl(${hue} ${sat}% ${light}%)`;
  const glow = `hsla(${hue} ${sat}% ${light}% / 0.62)`;
  return { base, glow, text: '#FFF' };
}

/**
 * Render ability squares HTML
 */
function renderAbilitySquares(abilities: string[], size: number = 14): string {
  if (!abilities || abilities.length === 0) return '';
  const displayed = abilities.slice(0, 4);
  return displayed.map(ability => {
    const colors = getAbilityColor(ability);
    return `<div class="pet-card-ability-square" title="${ability}" style="background:${colors.base};border:1px solid rgba(255,255,255,0.3);box-shadow:0 0 6px ${colors.glow};width:${size}px;height:${size}px;border-radius:3px;"></div>`;
  }).join('');
}

/**
 * Calculate pet strength from XP
 */
function calculatePetStrength(species: string, xp: number, targetScale: number): number {
  const maxStrength = calculateMaxStrength(targetScale, species);
  const xpPerLevel = getSpeciesXpPerLevel(species);
  
  if (!xpPerLevel || xpPerLevel <= 0 || !maxStrength) return 0;
  
  const level = Math.min(30, Math.floor(xp / xpPerLevel));
  const baseStrength = 50;
  const strengthPerLevel = (maxStrength - baseStrength) / 30;
  return Math.min(maxStrength, Math.round(baseStrength + level * strengthPerLevel));
}

/**
 * Generate Pet Hub-style pet card HTML
 * Returns complete card with abilities + sprite + name + STR
 */
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

  // Ensure species is a valid string
  const species = String(rawSpecies || '').trim();
  if (!species) {
    return '<div style="font-size: 32px;">🐾</div>';
  }

  // Size mappings
  const sizeMap = {
    small: { sprite: 48, ability: 10, padding: 8 },
    medium: { sprite: 64, ability: 14, padding: 12 },
    large: { sprite: 96, ability: 18, padding: 16 },
  };
  
  const dimensions = sizeMap[size];
  const spriteSize = dimensions.sprite;
  const abilitySize = dimensions.ability;
  
  // Calculate STR
  const strength = xp > 0 ? calculatePetStrength(species, xp, targetScale) : 0;
  
  // Get sprite (apply mutation hierarchy: Rainbow > Gold)
  let sprite: string | null | undefined;
  if (mutations.includes('rainbow') || mutations.includes('Rainbow')) {
    sprite = getMutationSpriteDataUrl(species, 'rainbow');
  } else if (mutations.includes('gold') || mutations.includes('Gold')) {
    sprite = getMutationSpriteDataUrl(species, 'gold');
  }

  // Fallback to base sprite
  if (!sprite) {
    sprite = canvasToDataUrl(getPetSpriteCanvas(species));
  }
  
  // Render ability squares
  const abilitySquares = renderAbilitySquares(abilities, abilitySize);
  
  // Pet display name
  const displayName = name || species;
  
  return `
    <div class="qpm-pet-card" style="position: relative; padding: ${dimensions.padding}px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.12); background: rgba(30,20,45,0.9); display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: ${spriteSize + dimensions.padding * 2 + 30}px;">
      ${abilitySquares ? `<div class="qpm-pet-card-abilities" style="position: absolute; left: 12px; top: ${dimensions.padding + spriteSize / 2}px; transform: translateY(-50%); display: flex; flex-direction: column; gap: 3px; z-index: 2;">${abilitySquares}</div>` : ''}
      <div class="qpm-pet-card-sprite" style="width: ${spriteSize}px; height: ${spriteSize}px; display: flex; align-items: center; justify-content: center;">
        ${sprite ? `<img src="${sprite}" alt="${displayName}" style="width: 100%; height: 100%; object-fit: contain; image-rendering: pixelated;" />` : `<div style="font-size: ${spriteSize / 2}px; opacity: 0.4;">🐾</div>`}
      </div>
      <div class="qpm-pet-card-name" style="font-size: 13px; font-weight: 700; color: #e2e8f0; text-align: center; line-height: 1.2; max-width: 100%; word-wrap: break-word;">${displayName}</div>
      <div class="qpm-pet-card-str" style="font-size: 12px; font-weight: 700; color: #a78bfa; background: rgba(168,139,250,0.15); padding: 3px 8px; border-radius: 6px;">STR: ${strength}</div>
    </div>
  `;
}

/**
 * Generate pet species icon for filter cards (no STR label)
 * Just shows sprite + name
 */
export function renderPetSpeciesIcon(species: string): string {
  const speciesStr = String(species || '').trim();
  if (!speciesStr) {
    return '<div style="font-size: 16px;">🐾</div>';
  }

  // Get base sprite (no mutations for filter cards)
  const sprite = canvasToDataUrl(getPetSpriteCanvas(speciesStr));

  return `
    <div class="qpm-pet-species-icon" style="display: inline-flex; align-items: center; gap: 6px;">
      ${sprite ? `<img src="${sprite}" alt="${speciesStr}" style="width: 24px; height: 24px; object-fit: contain; image-rendering: pixelated; border-radius: 4px; border: 1px solid rgba(168,139,250,0.2);" />` : `<div style="font-size: 16px;">🐾</div>`}
      <span style="font-size: 12px; font-weight: 600; color: #e2e8f0;">${speciesStr}</span>
    </div>
  `;
}

/**
 * Generate lightweight pet sprite only (for use in lists/trackers)
 * Still includes abilities + name + STR but in compact format
 */
export function renderCompactPetSprite(config: PetCardConfig): string {
  const {
    species: rawSpecies,
    name,
    xp = 0,
    targetScale = 1,
    abilities = [],
    mutations = [],
  } = config;

  // Ensure species is a valid string
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
        ${sprite ? `<img src="${sprite}" alt="${displayName}" style="width: 32px; height: 32px; object-fit: contain; image-rendering: pixelated;" />` : `<div style="font-size: 16px;">🐾</div>`}
      </div>
      <div style="display: flex; flex-direction: column; gap: 2px;">
        <span style="font-size: 12px; font-weight: 700; color: #e2e8f0;">${displayName}</span>
        <span style="font-size: 10px; font-weight: 700; color: #a78bfa;">STR: ${strength}</span>
      </div>
    </div>
  `;
}
