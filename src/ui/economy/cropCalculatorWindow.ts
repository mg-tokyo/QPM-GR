// src/ui/cropCalculatorWindow.ts
// Calculator — Crop & Pet value calculator with tab switching.
// Dynamic plant/pet data from runtime catalogs, mutation math from cropMultipliers.ts.

import {
  areCatalogsReady,
  onCatalogsReady,
  getAllPlantSpecies,
  getPlantSpecies,
  getAllPetSpecies,
  getPetSpecies,
  getPetMaxScale,
  getPetHoursToMature,
  getAllEggTypes,
  getEggSpawnWeights,
} from '../../catalogs/gameCatalogs';
import {
  getCropSpriteDataUrl,
  getCropSpriteDataUrlWithMutations,
  getPetSpriteDataUrl,
  getPetSpriteDataUrlWithMutations,
  getAnySpriteDataUrl,
  onSpritesReady,
} from '../../sprite-v2/compat';
import {
  computeMutationMultiplier,
  getAllMutationDefinitions,
  type MutationDefinition,
  type MutationCategory,
} from '../../utils/game/cropMultipliers';
import { lookupMaxScale } from '../../utils/game/plantScales';
import { normalizeSpeciesKey } from '../../utils/helpers';
import { findVariantBadge } from '../../features/mutations/data/variantBadges';
import { toggleWindow } from '../core/modalWindow';
import { t } from '../../i18n';

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

const ACCENT = '#8f82ff';
const BORDER_ACTIVE = 'rgba(143,130,255,0.5)';
const BORDER_SUBTLE = 'rgba(143,130,255,0.18)';
const TEXT = '#e8e0ff';
const MUTED = 'rgba(232,224,255,0.6)';
const CARD_BG = 'rgba(255,255,255,0.03)';
const HOVER_BG = 'rgba(143,130,255,0.06)';
const PRICE_COLOR = '#ffd84d';
const DUST_COLOR = '#ab47bc';

const PILL_ACTIVE_BG = 'rgba(143,130,255,0.2)';
const PILL_ACTIVE_BORDER = 'rgba(143,130,255,0.5)';
const PILL_INACTIVE_BG = 'rgba(143,130,255,0.08)';
const PILL_INACTIVE_BORDER = 'rgba(143,130,255,0.18)';

const MUT_INACTIVE_BG = 'rgba(255,255,255,0.03)';
const MUT_INACTIVE_BORDER = 'rgba(255,255,255,0.08)';

/** Map internal mutation key → user-facing display name */
const MUTATION_DISPLAY_NAMES: Record<string, string> = {
  Dawncharged: 'Dawnbound',
  Ambershine: 'Amberlit',
  Ambercharged: 'Amberbound',
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PlantOption {
  key: string;
  name: string;
  baseSellPrice: number;
  baseWeight: number;
  maxScale: number;
}

interface CropCalcState {
  plant: PlantOption | null;
  sizePercent: number;
  colorMutation: string | null;
  weatherMutation: string | null;
  timeMutation: string | null;
  playerCount: number;
}

interface PetOption {
  key: string;
  name: string;
  maturitySellPrice: number;
  maxScale: number;
  hoursToMature: number;
  rarity: string;
}

interface PetCalcState {
  pet: PetOption | null;
  maxStrength: number;
  currentStrength: number;
  colorMutation: string | null;
  playerCount: number;
}

// ---------------------------------------------------------------------------
// Data helpers
// ---------------------------------------------------------------------------

function buildPlantOptions(): PlantOption[] {
  const keys = getAllPlantSpecies();
  const options: PlantOption[] = [];

  for (const key of keys) {
    const entry = getPlantSpecies(key);
    if (!entry?.crop) continue;

    const baseSellPrice = typeof entry.crop.baseSellPrice === 'number' ? entry.crop.baseSellPrice : 0;
    if (baseSellPrice <= 0) continue;

    const baseWeight = typeof entry.crop.baseWeight === 'number' ? entry.crop.baseWeight : 1.0;
    let maxScale = typeof entry.crop.maxScale === 'number' ? entry.crop.maxScale : 0;
    if (maxScale <= 1) {
      maxScale = lookupMaxScale(normalizeSpeciesKey(key)) ?? 2.0;
    }

    const name = typeof entry.crop.name === 'string' && entry.crop.name ? entry.crop.name : key;

    options.push({ key, name, baseSellPrice, baseWeight, maxScale });
  }

  options.sort((a, b) => b.baseSellPrice - a.baseSellPrice);
  return options;
}

function buildPetOptions(): PetOption[] {
  const keys = getAllPetSpecies();
  const options: PetOption[] = [];

  for (const key of keys) {
    const entry = getPetSpecies(key);
    if (!entry) continue;

    const msp = entry.maturitySellPrice;
    const maturitySellPrice = typeof msp === 'number' ? msp : 0;
    if (maturitySellPrice <= 0) continue;

    const maxScale = getPetMaxScale(key) ?? 2;
    const hoursToMature = getPetHoursToMature(key) ?? 12;
    const name = entry.name ?? key;
    const rarity = entry.rarity ?? 'Common';

    options.push({ key, name, maturitySellPrice, maxScale, hoursToMature, rarity });
  }

  options.sort((a, b) => b.maturitySellPrice - a.maturitySellPrice);
  return options;
}

function groupMutations(): Record<MutationCategory, MutationDefinition[]> {
  const all = getAllMutationDefinitions();
  const grouped: Record<MutationCategory, MutationDefinition[]> = { color: [], weather: [], time: [] };
  for (const def of all) {
    grouped[def.category].push(def);
  }
  return grouped;
}

function percentToScale(percent: number, maxScale: number): number {
  return 1 + ((percent - 50) / 50) * (maxScale - 1);
}

function computeCropPrice(state: CropCalcState): { sellPrice: number; scale: number; mutMult: number; friendBonus: number } {
  if (!state.plant) return { sellPrice: 0, scale: 1, mutMult: 1, friendBonus: 1 };

  const mutations = [state.colorMutation, state.weatherMutation, state.timeMutation].filter(
    (m): m is string => m !== null,
  );
  const scale = percentToScale(state.sizePercent, state.plant.maxScale);
  const { totalMultiplier } = computeMutationMultiplier(mutations);
  const friendBonus = 1 + (state.playerCount - 1) * 0.1;
  const sellPrice = Math.round(state.plant.baseSellPrice * scale * totalMultiplier * friendBonus);
  return { sellPrice, scale, mutMult: totalMultiplier, friendBonus };
}

function strengthToTargetScale(maxStrength: number, maxSpeciesScale: number): number {
  return 1 + ((maxStrength - 80) / 20) * (maxSpeciesScale - 1);
}

function computePetCalcPrice(state: PetCalcState): { sellPrice: number; scale: number; mutMult: number; friendBonus: number; targetScale: number } {
  if (!state.pet) return { sellPrice: 0, scale: 1, mutMult: 1, friendBonus: 1, targetScale: 1 };

  const targetScale = strengthToTargetScale(state.maxStrength, state.pet.maxScale);
  const scale = state.maxStrength > 0 ? (state.currentStrength / state.maxStrength) * targetScale : 1;
  const mutations = state.colorMutation ? [state.colorMutation] : [];
  const { totalMultiplier } = computeMutationMultiplier(mutations);
  const friendBonus = 1 + (state.playerCount - 1) * 0.1;
  // Two-step rounding matching game formula (sell.ts)
  const basePrice = Math.round(state.pet.maturitySellPrice * scale * totalMultiplier);
  const sellPrice = Math.round(basePrice * friendBonus);

  return { sellPrice, scale, mutMult: totalMultiplier, friendBonus, targetScale };
}

// ---------------------------------------------------------------------------
// Magic Dust sell value
// ---------------------------------------------------------------------------

const DUST_RARITY_MULT: Record<string, number> = {
  Common: 1,
  Uncommon: 2,
  Rare: 5,
  Legendary: 10,
  Mythical: 50,
  Divine: 50,
  Celestial: 50,
};

const DUST_MUTATION_MULT: Record<string, number> = {
  Rainbow: 50,
  Gold: 25,
};

function getPullRateMult(spawnWeightPct: number): number {
  if (spawnWeightPct >= 51) return 1;
  if (spawnWeightPct >= 11) return 2;
  return 5;
}

/** Find which egg contains a species and compute its spawn weight percentage. */
function getSourceEggForSpecies(speciesKey: string): { eggId: string; spawnWeightPct: number } | null {
  const eggIds = getAllEggTypes();
  for (const eggId of eggIds) {
    const weights = getEggSpawnWeights(eggId);
    if (!(speciesKey in weights)) continue;
    const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
    if (total <= 0) continue;
    return { eggId, spawnWeightPct: ((weights[speciesKey] ?? 0) / total) * 100 };
  }
  return null;
}

function computePetDustValue(state: PetCalcState): { dustValue: number; rarityMult: number; pullRateMult: number; dustMutMult: number; scale: number } {
  if (!state.pet) return { dustValue: 0, rarityMult: 1, pullRateMult: 1, dustMutMult: 1, scale: 1 };

  const targetScale = strengthToTargetScale(state.maxStrength, state.pet.maxScale);
  const scale = state.maxStrength > 0 ? (state.currentStrength / state.maxStrength) * targetScale : 1;
  const rarityMult = DUST_RARITY_MULT[state.pet.rarity] ?? 1;

  const eggInfo = getSourceEggForSpecies(state.pet.key);
  const pullRateMult = eggInfo ? getPullRateMult(eggInfo.spawnWeightPct) : 1;

  const dustMutMult = state.colorMutation ? (DUST_MUTATION_MULT[state.colorMutation] ?? 1) : 1;
  const dustValue = Math.floor(100 * rarityMult * pullRateMult * dustMutMult * scale);

  return { dustValue, rarityMult, pullRateMult, dustMutMult, scale };
}

// ---------------------------------------------------------------------------
// Dust sprite helper
// ---------------------------------------------------------------------------

let dustUrlCache: string | null | undefined;
function getDustSpriteUrl(): string | null {
  if (dustUrlCache !== undefined) return dustUrlCache;
  dustUrlCache =
    getAnySpriteDataUrl('sprite/item/MagicDust') ||
    getAnySpriteDataUrl('item/MagicDust') ||
    null;
  return dustUrlCache;
}

function makeDustIcon(size: number): HTMLElement {
  const url = getDustSpriteUrl();
  if (url) {
    const img = el('img', `width:${size}px;height:${size}px;image-rendering:pixelated;flex-shrink:0;vertical-align:middle;`) as HTMLImageElement;
    img.src = url;
    img.alt = 'magic dust';
    return img;
  }
  return el('span', `font-size:${size}px;`, '\u2728');
}

// ---------------------------------------------------------------------------
// Intl formatter
// ---------------------------------------------------------------------------

const fullFmt = new Intl.NumberFormat('en-US');

// ---------------------------------------------------------------------------
// Coin sprite helper
// ---------------------------------------------------------------------------

let coinUrlCache: string | null = null;
function getCoinSpriteUrl(): string {
  if (coinUrlCache) return coinUrlCache;
  const url = getAnySpriteDataUrl('sprite/ui/Coin');
  if (url) coinUrlCache = url;
  return coinUrlCache ?? '';
}

function makeCoinIcon(size: number): HTMLElement {
  const url = getCoinSpriteUrl();
  if (url) {
    const img = el('img', `width:${size}px;height:${size}px;image-rendering:pixelated;flex-shrink:0;vertical-align:middle;`) as HTMLImageElement;
    img.src = url;
    img.alt = 'coins';
    return img;
  }
  return el('span', `font-size:${size}px;`, '\uD83E\uDE99');
}

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

function el<K extends keyof HTMLElementTagNameMap>(tag: K, style?: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (style) node.style.cssText = style;
  if (text !== undefined) node.textContent = text;
  return node;
}

// ---------------------------------------------------------------------------
// Pill button row builder
// ---------------------------------------------------------------------------

interface PillOption {
  label: string;
  value: string | null;
}

function buildPillRow(
  options: PillOption[],
  initial: string | null,
  onChange: (value: string | null) => void,
): { container: HTMLElement; setActive: (value: string | null) => void } {
  const container = el('div', 'display:flex;flex-wrap:wrap;gap:6px;');
  let activeValue = initial;
  const buttons: { btn: HTMLElement; value: string | null }[] = [];

  function applyStyle(btn: HTMLElement, active: boolean): void {
    btn.style.background = active ? PILL_ACTIVE_BG : PILL_INACTIVE_BG;
    btn.style.borderColor = active ? PILL_ACTIVE_BORDER : PILL_INACTIVE_BORDER;
    btn.style.color = active ? TEXT : MUTED;
  }

  for (const opt of options) {
    const btn = el(
      'button',
      [
        'padding:5px 10px',
        'font-size:12px',
        'border-radius:6px',
        'cursor:pointer',
        'border:1px solid',
        'transition:background 0.12s,border-color 0.12s,color 0.12s',
        'font-family:inherit',
      ].join(';'),
      opt.label,
    );
    btn.type = 'button';
    applyStyle(btn, opt.value === activeValue);
    buttons.push({ btn, value: opt.value });

    btn.addEventListener('click', () => {
      activeValue = opt.value;
      for (const b of buttons) applyStyle(b.btn, b.value === activeValue);
      onChange(opt.value);
    });

    container.appendChild(btn);
  }

  const setActive = (value: string | null) => {
    activeValue = value;
    for (const b of buttons) applyStyle(b.btn, b.value === activeValue);
  };

  return { container, setActive };
}

// ---------------------------------------------------------------------------
// Mutation toggle row (locker-style colored tiles)
// ---------------------------------------------------------------------------

interface MutationTileOption {
  value: string;
  displayName: string;
  multiplier: number;
  color: string;
  gradient: string | undefined;
}

function buildMutationToggleRow(
  options: MutationTileOption[],
  onChange: (value: string | null) => void,
): { container: HTMLElement; setActive: (value: string | null) => void } {
  const container = el('div', 'display:flex;flex-wrap:wrap;gap:6px;');
  let activeValue: string | null = null;

  interface TileRef { tile: HTMLElement; dot: HTMLElement; label: HTMLElement; value: string | null; color: string; gradient: string | undefined }
  const tiles: TileRef[] = [];

  function applyState(t: TileRef, active: boolean): void {
    t.tile.style.borderColor = active ? t.color : MUT_INACTIVE_BORDER;
    t.tile.style.background = active ? (t.gradient ?? t.color) : MUT_INACTIVE_BG;
    t.dot.style.background = active ? 'rgba(0,0,0,0.2)' : (t.gradient ?? t.color);
    t.label.style.color = active ? '#111' : MUTED;
  }

  // "None" tile
  {
    const tile = el('button', [
      'padding:5px 10px',
      'border-radius:8px',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'gap:6px',
      'transition:background .15s,border-color .15s,color .15s',
      `border:1.5px solid ${PILL_ACTIVE_BORDER}`,
      `background:${PILL_ACTIVE_BG}`,
      'font-family:inherit',
    ].join(';'));
    tile.type = 'button';
    const label = el('div', `font-size:11px;font-weight:600;white-space:nowrap;color:${TEXT};`, t('feature.cropCalc.none'));
    tile.appendChild(label);

    const noneRef = { tile, dot: label, label, value: null as string | null, color: ACCENT, gradient: undefined };
    tiles.push(noneRef);

    const applyNone = (active: boolean) => {
      tile.style.borderColor = active ? PILL_ACTIVE_BORDER : MUT_INACTIVE_BORDER;
      tile.style.background = active ? PILL_ACTIVE_BG : MUT_INACTIVE_BG;
      label.style.color = active ? TEXT : MUTED;
    };

    tile.addEventListener('mouseenter', () => { if (activeValue !== null) { tile.style.background = HOVER_BG; tile.style.borderColor = 'rgba(143,130,255,0.25)'; } });
    tile.addEventListener('mouseleave', () => { if (activeValue !== null) { tile.style.background = MUT_INACTIVE_BG; tile.style.borderColor = MUT_INACTIVE_BORDER; } });
    tile.addEventListener('click', () => {
      activeValue = null;
      for (const t of tiles) {
        if (t.value === null) applyNone(true);
        else applyState(t, false);
      }
      onChange(null);
    });

    noneRef.tile = tile;
    container.appendChild(tile);
  }

  // Mutation tiles
  for (const opt of options) {
    const tile = el('button', [
      'padding:5px 10px',
      'border-radius:8px',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'gap:6px',
      'transition:background .15s,border-color .15s,color .15s',
      `border:1.5px solid ${MUT_INACTIVE_BORDER}`,
      `background:${MUT_INACTIVE_BG}`,
      'font-family:inherit',
    ].join(';'));
    tile.type = 'button';
    tile.title = opt.displayName;

    const dot = el('div', `width:10px;height:10px;border-radius:50%;flex-shrink:0;transition:background .15s;background:${opt.gradient ?? opt.color}`);
    const label = el('div', `font-size:11px;font-weight:600;white-space:nowrap;transition:color .15s;color:${MUTED}`, `${opt.displayName} \u00D7${opt.multiplier}`);
    tile.append(dot, label);

    const ref: TileRef = { tile, dot, label, value: opt.value, color: opt.color, gradient: opt.gradient };
    tiles.push(ref);

    tile.addEventListener('mouseenter', () => { if (activeValue !== opt.value) { tile.style.background = `${opt.color}18`; tile.style.borderColor = `${opt.color}55`; } });
    tile.addEventListener('mouseleave', () => { if (activeValue !== opt.value) { tile.style.background = MUT_INACTIVE_BG; tile.style.borderColor = MUT_INACTIVE_BORDER; } });
    tile.addEventListener('click', () => {
      activeValue = opt.value;
      for (const t of tiles) {
        if (t.value === null) {
          t.tile.style.borderColor = MUT_INACTIVE_BORDER;
          t.tile.style.background = MUT_INACTIVE_BG;
          t.label.style.color = MUTED;
        } else {
          applyState(t, t.value === activeValue);
        }
      }
      onChange(opt.value);
    });

    container.appendChild(tile);
  }

  const setActive = (value: string | null) => {
    activeValue = value;
    for (const t of tiles) {
      if (t.value === null) {
        t.tile.style.borderColor = value === null ? PILL_ACTIVE_BORDER : MUT_INACTIVE_BORDER;
        t.tile.style.background = value === null ? PILL_ACTIVE_BG : MUT_INACTIVE_BG;
        t.label.style.color = value === null ? TEXT : MUTED;
      } else {
        applyState(t, t.value === value);
      }
    }
  };

  return { container, setActive };
}

// ---------------------------------------------------------------------------
// Plant selector dropdown
// ---------------------------------------------------------------------------

function buildPlantSelector(
  plants: PlantOption[],
  initial: PlantOption | null,
  onSelect: (plant: PlantOption) => void,
): { container: HTMLElement; refresh: (plants: PlantOption[]) => void } {
  const container = el('div', 'position:relative;');

  const btn = el(
    'button',
    [
      'width:100%',
      'padding:10px 14px',
      'font-size:14px',
      'border-radius:8px',
      `border:1px solid ${BORDER_SUBTLE}`,
      `background:${CARD_BG}`,
      `color:${TEXT}`,
      'cursor:pointer',
      'text-align:left',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'font-family:inherit',
    ].join(';'),
  );
  btn.type = 'button';

  const btnIcon = el('img', 'width:28px;height:28px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;');
  const btnLabel = el('span', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;');
  const btnPrice = el('span', 'display:flex;align-items:center;gap:3px;flex-shrink:0;white-space:nowrap;');
  const btnArrow = el('span', `color:${MUTED};flex-shrink:0;font-size:12px;`, '\u25BC');

  btn.append(btnIcon, btnLabel, btnPrice, btnArrow);
  container.appendChild(btn);

  const dropdown = el(
    'div',
    [
      'position:absolute',
      'top:100%',
      'left:0',
      'right:0',
      'z-index:50',
      'margin-top:4px',
      'background:rgba(18,20,26,0.98)',
      `border:1px solid ${BORDER_ACTIVE}`,
      'border-radius:8px',
      'max-height:280px',
      'display:none',
      'flex-direction:column',
      'overflow:hidden',
    ].join(';'),
  );
  container.appendChild(dropdown);

  const searchInput = el(
    'input',
    [
      'width:100%',
      'box-sizing:border-box',
      'padding:8px 12px',
      'font-size:13px',
      `border-bottom:1px solid ${BORDER_SUBTLE}`,
      'border:none',
      `border-bottom:1px solid ${BORDER_SUBTLE}`,
      'background:transparent',
      `color:${TEXT}`,
      'outline:none',
      'font-family:inherit',
    ].join(';'),
  );
  (searchInput as HTMLInputElement).type = 'text';
  (searchInput as HTMLInputElement).placeholder = t('feature.cropCalc.searchCrops');
  dropdown.appendChild(searchInput);

  const listContainer = el('div', 'flex:1;overflow-y:auto;max-height:240px;');
  dropdown.appendChild(listContainer);

  let currentPlants = plants;
  let isOpen = false;

  function updateBtn(plant: PlantOption | null): void {
    if (!plant) {
      (btnIcon as HTMLImageElement).style.display = 'none';
      btnLabel.textContent = t('feature.cropCalc.selectCrop');
      btnPrice.innerHTML = '';
      return;
    }
    const spriteUrl = getCropSpriteDataUrl(plant.key);
    if (spriteUrl) {
      (btnIcon as HTMLImageElement).src = spriteUrl;
      (btnIcon as HTMLImageElement).style.display = '';
    } else {
      (btnIcon as HTMLImageElement).style.display = 'none';
    }
    btnLabel.textContent = plant.name;
    btnPrice.innerHTML = '';
    btnPrice.append(makeCoinIcon(16), document.createTextNode(` ${fullFmt.format(plant.baseSellPrice)}`));
  }

  function renderList(filter: string): void {
    listContainer.innerHTML = '';
    const lower = filter.toLowerCase();
    const filtered = lower ? currentPlants.filter((p) => p.name.toLowerCase().includes(lower)) : currentPlants;

    for (const plant of filtered) {
      const row = el(
        'div',
        [
          'display:flex',
          'align-items:center',
          'gap:10px',
          'padding:7px 12px',
          'cursor:pointer',
          'transition:background 0.1s',
        ].join(';'),
      );
      row.addEventListener('mouseenter', () => { row.style.background = HOVER_BG; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

      const icon = el('img', 'width:24px;height:24px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;');
      const spriteUrl = getCropSpriteDataUrl(plant.key);
      if (spriteUrl) {
        (icon as HTMLImageElement).src = spriteUrl;
      } else {
        icon.style.display = 'none';
      }

      const name = el('span', `flex:1;font-size:13px;color:${TEXT};`, plant.name);
      const priceWrap = el('span', 'display:flex;align-items:center;gap:3px;flex-shrink:0;');
      priceWrap.append(makeCoinIcon(14), el('span', `font-size:11px;color:${MUTED};`, fullFmt.format(plant.baseSellPrice)));

      row.append(icon, name, priceWrap);
      row.addEventListener('click', () => {
        onSelect(plant);
        updateBtn(plant);
        close();
      });
      listContainer.appendChild(row);
    }

    if (filtered.length === 0) {
      listContainer.appendChild(el('div', `padding:12px;text-align:center;color:${MUTED};font-size:12px;`, t('feature.cropCalc.noResults')));
    }
  }

  function open(): void {
    isOpen = true;
    dropdown.style.display = 'flex';
    (searchInput as HTMLInputElement).value = '';
    renderList('');
    (searchInput as HTMLInputElement).focus();
  }

  function close(): void {
    isOpen = false;
    dropdown.style.display = 'none';
  }

  btn.addEventListener('click', () => {
    if (isOpen) close();
    else open();
  });

  searchInput.addEventListener('input', () => {
    renderList((searchInput as HTMLInputElement).value);
  });

  document.addEventListener('click', (e) => {
    if (isOpen && !container.contains(e.target as Node)) close();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  updateBtn(initial);

  const refresh = (newPlants: PlantOption[]) => {
    currentPlants = newPlants;
  };

  return { container, refresh };
}

// ---------------------------------------------------------------------------
// Pet selector dropdown
// ---------------------------------------------------------------------------

function buildPetSelector(
  pets: PetOption[],
  initial: PetOption | null,
  onSelect: (pet: PetOption) => void,
): { container: HTMLElement } {
  const container = el('div', 'position:relative;');

  const btn = el(
    'button',
    [
      'width:100%',
      'padding:10px 14px',
      'font-size:14px',
      'border-radius:8px',
      `border:1px solid ${BORDER_SUBTLE}`,
      `background:${CARD_BG}`,
      `color:${TEXT}`,
      'cursor:pointer',
      'text-align:left',
      'display:flex',
      'align-items:center',
      'gap:10px',
      'font-family:inherit',
    ].join(';'),
  );
  btn.type = 'button';

  const btnIcon = el('img', 'width:28px;height:28px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;');
  const btnLabel = el('span', 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;');
  const btnPrice = el('span', 'display:flex;align-items:center;gap:3px;flex-shrink:0;white-space:nowrap;');
  const btnArrow = el('span', `color:${MUTED};flex-shrink:0;font-size:12px;`, '\u25BC');

  btn.append(btnIcon, btnLabel, btnPrice, btnArrow);
  container.appendChild(btn);

  const dropdown = el(
    'div',
    [
      'position:absolute',
      'top:100%',
      'left:0',
      'right:0',
      'z-index:50',
      'margin-top:4px',
      'background:rgba(18,20,26,0.98)',
      `border:1px solid ${BORDER_ACTIVE}`,
      'border-radius:8px',
      'max-height:280px',
      'display:none',
      'flex-direction:column',
      'overflow:hidden',
    ].join(';'),
  );
  container.appendChild(dropdown);

  const searchInput = el(
    'input',
    [
      'width:100%',
      'box-sizing:border-box',
      'padding:8px 12px',
      'font-size:13px',
      'border:none',
      `border-bottom:1px solid ${BORDER_SUBTLE}`,
      'background:transparent',
      `color:${TEXT}`,
      'outline:none',
      'font-family:inherit',
    ].join(';'),
  );
  (searchInput as HTMLInputElement).type = 'text';
  (searchInput as HTMLInputElement).placeholder = t('feature.cropCalc.searchPets');
  dropdown.appendChild(searchInput);

  const listContainer = el('div', 'flex:1;overflow-y:auto;max-height:240px;');
  dropdown.appendChild(listContainer);

  let isOpen = false;

  function updateBtn(pet: PetOption | null): void {
    if (!pet) {
      (btnIcon as HTMLImageElement).style.display = 'none';
      btnLabel.textContent = t('feature.cropCalc.selectPet');
      btnPrice.innerHTML = '';
      return;
    }
    const spriteUrl = getPetSpriteDataUrl(pet.key);
    if (spriteUrl) {
      (btnIcon as HTMLImageElement).src = spriteUrl;
      (btnIcon as HTMLImageElement).style.display = '';
    } else {
      (btnIcon as HTMLImageElement).style.display = 'none';
    }
    btnLabel.textContent = pet.name;
    btnPrice.innerHTML = '';
    btnPrice.append(makeCoinIcon(16), document.createTextNode(` ${fullFmt.format(pet.maturitySellPrice)}`));
  }

  function renderList(filter: string): void {
    listContainer.innerHTML = '';
    const lower = filter.toLowerCase();
    const filtered = lower ? pets.filter((p) => p.name.toLowerCase().includes(lower)) : pets;

    for (const pet of filtered) {
      const row = el(
        'div',
        [
          'display:flex',
          'align-items:center',
          'gap:10px',
          'padding:7px 12px',
          'cursor:pointer',
          'transition:background 0.1s',
        ].join(';'),
      );
      row.addEventListener('mouseenter', () => { row.style.background = HOVER_BG; });
      row.addEventListener('mouseleave', () => { row.style.background = 'transparent'; });

      const icon = el('img', 'width:24px;height:24px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;');
      const spriteUrl = getPetSpriteDataUrl(pet.key);
      if (spriteUrl) {
        (icon as HTMLImageElement).src = spriteUrl;
      } else {
        icon.style.display = 'none';
      }

      const nameEl = el('span', `flex:1;font-size:13px;color:${TEXT};`, pet.name);
      const priceWrap = el('span', 'display:flex;align-items:center;gap:3px;flex-shrink:0;');
      priceWrap.append(makeCoinIcon(14), el('span', `font-size:11px;color:${MUTED};`, fullFmt.format(pet.maturitySellPrice)));
      const rarityEl = el('span', `font-size:10px;color:${MUTED};flex-shrink:0;margin-left:4px;opacity:0.7;`, pet.rarity);

      row.append(icon, nameEl, priceWrap, rarityEl);
      row.addEventListener('click', () => {
        onSelect(pet);
        updateBtn(pet);
        close();
      });
      listContainer.appendChild(row);
    }

    if (filtered.length === 0) {
      listContainer.appendChild(el('div', `padding:12px;text-align:center;color:${MUTED};font-size:12px;`, t('feature.cropCalc.noResults')));
    }
  }

  function open(): void {
    isOpen = true;
    dropdown.style.display = 'flex';
    (searchInput as HTMLInputElement).value = '';
    renderList('');
    (searchInput as HTMLInputElement).focus();
  }

  function close(): void {
    isOpen = false;
    dropdown.style.display = 'none';
  }

  btn.addEventListener('click', () => {
    if (isOpen) close();
    else open();
  });

  searchInput.addEventListener('input', () => {
    renderList((searchInput as HTMLInputElement).value);
  });

  document.addEventListener('click', (e) => {
    if (isOpen && !container.contains(e.target as Node)) close();
  });

  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  updateBtn(initial);

  return { container };
}

// ---------------------------------------------------------------------------
// Crop sprite display
// ---------------------------------------------------------------------------

function buildCropSpriteDisplay(): {
  wrapper: HTMLElement;
  update: (plant: PlantOption | null, mutations: string[], sizePercent: number) => void;
} {
  const wrapper = el(
    'div',
    'width:112px;height:112px;display:flex;align-items:center;justify-content:center;margin:0 auto;overflow:visible;',
  );
  const img = el('img', 'object-fit:contain;image-rendering:pixelated;transition:transform 0.15s ease;') as HTMLImageElement;
  const fallback = el(
    'div',
    `width:64px;height:64px;border-radius:50%;background:${ACCENT};display:flex;align-items:center;justify-content:center;font-size:28px;color:${TEXT};font-weight:700;transition:transform 0.15s ease;`,
  );

  let currentChild: HTMLElement | null = null;

  function update(plant: PlantOption | null, mutations: string[], sizePercent: number): void {
    const cssScale = 0.55 + ((sizePercent - 50) / 50) * 0.45;

    if (!plant) {
      fallback.textContent = '?';
      fallback.style.transform = `scale(${cssScale})`;
      if (currentChild !== fallback) {
        wrapper.innerHTML = '';
        wrapper.appendChild(fallback);
        currentChild = fallback;
      }
      return;
    }

    const activeMuts = mutations.filter(Boolean);
    const url = activeMuts.length > 0
      ? getCropSpriteDataUrlWithMutations(plant.key, activeMuts)
      : getCropSpriteDataUrl(plant.key);

    if (url) {
      img.src = url;
      img.alt = plant.name;
      img.style.maxWidth = '112px';
      img.style.maxHeight = '112px';
      img.style.transform = `scale(${cssScale})`;
      if (currentChild !== img) {
        wrapper.innerHTML = '';
        wrapper.appendChild(img);
        currentChild = img;
      }
    } else {
      fallback.textContent = plant.name.charAt(0).toUpperCase();
      fallback.style.transform = `scale(${cssScale})`;
      if (currentChild !== fallback) {
        wrapper.innerHTML = '';
        wrapper.appendChild(fallback);
        currentChild = fallback;
      }
    }
  }

  return { wrapper, update };
}

// ---------------------------------------------------------------------------
// Pet sprite display
// ---------------------------------------------------------------------------

function buildPetSpriteDisplay(): {
  wrapper: HTMLElement;
  update: (pet: PetOption | null, mutations: string[], currentStr: number, maxStr: number) => void;
} {
  const wrapper = el(
    'div',
    'width:112px;height:112px;display:flex;align-items:center;justify-content:center;margin:0 auto;overflow:visible;',
  );
  const img = el('img', 'object-fit:contain;image-rendering:pixelated;transition:transform 0.15s ease;') as HTMLImageElement;
  const fallback = el(
    'div',
    `width:64px;height:64px;border-radius:50%;background:${ACCENT};display:flex;align-items:center;justify-content:center;font-size:28px;color:${TEXT};font-weight:700;transition:transform 0.15s ease;`,
  );

  let currentChild: HTMLElement | null = null;

  function update(pet: PetOption | null, mutations: string[], currentStr: number, maxStr: number): void {
    // Visual scale: map strength range to 0.55–1.0 CSS scale
    const minStr = maxStr - 30;
    const progress = maxStr > minStr ? (currentStr - minStr) / (maxStr - minStr) : 1;
    const cssScale = 0.55 + progress * 0.45;

    if (!pet) {
      fallback.textContent = '?';
      fallback.style.transform = `scale(${cssScale})`;
      if (currentChild !== fallback) {
        wrapper.innerHTML = '';
        wrapper.appendChild(fallback);
        currentChild = fallback;
      }
      return;
    }

    const activeMuts = mutations.filter(Boolean);
    const url = activeMuts.length > 0
      ? getPetSpriteDataUrlWithMutations(pet.key, activeMuts)
      : getPetSpriteDataUrl(pet.key);

    if (url) {
      img.src = url;
      img.alt = pet.name;
      img.style.maxWidth = '112px';
      img.style.maxHeight = '112px';
      img.style.transform = `scale(${cssScale})`;
      if (currentChild !== img) {
        wrapper.innerHTML = '';
        wrapper.appendChild(img);
        currentChild = img;
      }
    } else {
      fallback.textContent = pet.name.charAt(0).toUpperCase();
      fallback.style.transform = `scale(${cssScale})`;
      if (currentChild !== fallback) {
        wrapper.innerHTML = '';
        wrapper.appendChild(fallback);
        currentChild = fallback;
      }
    }
  }

  return { wrapper, update };
}

// ---------------------------------------------------------------------------
// Friends pill row (shared by both tabs)
// ---------------------------------------------------------------------------

const FRIEND_OPTIONS: PillOption[] = [
  { label: '1', value: '1' },
  { label: '2 +10%', value: '2' },
  { label: '3 +20%', value: '3' },
  { label: '4 +30%', value: '4' },
  { label: '5 +40%', value: '5' },
  { label: '6 +50%', value: '6' },
];

// ---------------------------------------------------------------------------
// Crop tab
// ---------------------------------------------------------------------------

function renderCropTab(container: HTMLElement): () => void {
  container.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

  const plants = buildPlantOptions();
  const mutGroups = groupMutations();

  const state: CropCalcState = {
    plant: plants[0] ?? null,
    sizePercent: 100,
    colorMutation: null,
    weatherMutation: null,
    timeMutation: null,
    playerCount: 1,
  };

  const spriteDisplay = buildCropSpriteDisplay();

  let priceEl: HTMLElement;
  let priceCoinEl: HTMLElement;
  let rangeEl: HTMLElement;
  let weightEl: HTMLElement;
  let sliderValueEl: HTMLElement;
  let sliderInput: HTMLInputElement;
  let formulaEl: HTMLElement;

  function getActiveMutations(): string[] {
    return [state.colorMutation, state.weatherMutation, state.timeMutation].filter(
      (m): m is string => m !== null,
    );
  }

  function updateDisplay(): void {
    const { sellPrice, scale, mutMult, friendBonus } = computeCropPrice(state);

    priceCoinEl.innerHTML = '';
    priceCoinEl.appendChild(makeCoinIcon(28));
    priceEl.textContent = fullFmt.format(sellPrice);

    if (state.plant) {
      const mutations = getActiveMutations();
      const { totalMultiplier } = computeMutationMultiplier(mutations);
      const fb = 1 + (state.playerCount - 1) * 0.1;
      const floorScale = percentToScale(50, state.plant.maxScale);
      const ceilScale = percentToScale(100, state.plant.maxScale);
      const floorPrice = Math.round(state.plant.baseSellPrice * floorScale * totalMultiplier * fb);
      const ceilPrice = Math.round(state.plant.baseSellPrice * ceilScale * totalMultiplier * fb);
      rangeEl.textContent = `${fullFmt.format(floorPrice)} — ${fullFmt.format(ceilPrice)}`;
      rangeEl.style.display = '';
    } else {
      rangeEl.textContent = '';
      rangeEl.style.display = 'none';
    }

    if (state.plant) {
      const weight = state.plant.baseWeight * scale;
      weightEl.textContent = t('feature.cropCalc.weight', { weight: weight.toFixed(2) });
    } else {
      weightEl.textContent = '';
    }

    sliderValueEl.textContent = `${state.sizePercent}%`;
    spriteDisplay.update(state.plant, getActiveMutations(), state.sizePercent);

    if (state.plant) {
      const basePart = fullFmt.format(state.plant.baseSellPrice);
      const scalePart = scale.toFixed(2);
      const mutPart = mutMult === 1 ? '1' : `${mutMult}`;
      const friendPart = friendBonus === 1 ? '1' : friendBonus.toFixed(1);
      formulaEl.innerHTML = '';
      formulaEl.appendChild(
        el(
          'span',
          `color:${MUTED};font-size:11px;font-family:monospace;`,
          `${basePart} \u00D7 ${scalePart} \u00D7 ${mutPart} \u00D7 ${friendPart} = ${fullFmt.format(sellPrice)}`,
        ),
      );
      const labels = el(
        'span',
        `color:${MUTED};font-size:10px;opacity:0.6;display:block;margin-top:2px;font-family:monospace;`,
        t('feature.cropCalc.formulaLabels'),
      );
      formulaEl.appendChild(labels);
    } else {
      formulaEl.innerHTML = '';
    }
  }

  function onPlantChange(plant: PlantOption): void {
    state.plant = plant;
    state.sizePercent = 100;
    sliderInput.value = '100';
    updateDisplay();
  }

  // --- Plant selector ---
  const { container: selectorContainer } = buildPlantSelector(plants, state.plant, onPlantChange);
  container.appendChild(selectorContainer);

  // --- Result card ---
  const resultCard = el(
    'div',
    [
      `border:1px solid ${BORDER_SUBTLE}`,
      `background:${CARD_BG}`,
      'border-radius:10px',
      'padding:16px',
      'text-align:center',
      'overflow:visible',
    ].join(';'),
  );

  const spriteWrap = el('div', 'margin-bottom:8px;overflow:visible;padding-top:16px;');
  spriteWrap.appendChild(spriteDisplay.wrapper);
  resultCard.appendChild(spriteWrap);

  const priceRow = el('div', 'display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:4px;');
  priceCoinEl = el('span', '');
  priceEl = el('span', `font-size:28px;font-weight:700;color:${PRICE_COLOR};`);
  priceRow.append(priceCoinEl, priceEl);
  resultCard.appendChild(priceRow);

  rangeEl = el('div', `font-size:13px;color:${MUTED};`);
  resultCard.appendChild(rangeEl);

  container.appendChild(resultCard);

  // --- Size slider ---
  const sizeSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
  const sizeHeader = el('div', 'display:flex;align-items:center;gap:8px;');
  sizeHeader.appendChild(el('span', `font-size:13px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.size')));

  sliderInput = document.createElement('input');
  sliderInput.type = 'range';
  sliderInput.min = '50';
  sliderInput.max = '100';
  sliderInput.step = '1';
  sliderInput.value = String(state.sizePercent);
  sliderInput.style.cssText = `flex:1;accent-color:${ACCENT};cursor:pointer;`;

  sliderValueEl = el('span', `font-size:13px;color:${TEXT};min-width:36px;text-align:right;`);

  sizeHeader.append(sliderInput, sliderValueEl);
  sizeSection.appendChild(sizeHeader);

  weightEl = el('div', `font-size:12px;color:${MUTED};`);
  sizeSection.appendChild(weightEl);

  sliderInput.addEventListener('input', () => {
    state.sizePercent = parseInt(sliderInput.value, 10);
    updateDisplay();
  });

  container.appendChild(sizeSection);

  // --- Mutation toggle groups ---
  const mutSections: { category: MutationCategory; label: string; stateKey: 'colorMutation' | 'weatherMutation' | 'timeMutation' }[] = [
    { category: 'color', label: t('feature.cropCalc.color'), stateKey: 'colorMutation' },
    { category: 'weather', label: t('feature.cropCalc.weather'), stateKey: 'weatherMutation' },
    { category: 'time', label: t('feature.cropCalc.lunar'), stateKey: 'timeMutation' },
  ];

  for (const sec of mutSections) {
    const defs = mutGroups[sec.category];
    if (defs.length === 0) continue;

    const section = el('div', 'display:flex;flex-direction:column;gap:4px;');
    section.appendChild(el('span', `font-size:13px;font-weight:600;color:${TEXT};`, sec.label));

    const tileOptions: MutationTileOption[] = defs.map((d) => {
      const vb = findVariantBadge(d.name);
      const displayName = MUTATION_DISPLAY_NAMES[d.name] ?? d.name;
      return {
        value: d.name,
        displayName,
        multiplier: d.multiplier,
        color: vb?.color ?? '#888',
        gradient: vb?.gradient,
      };
    });

    const { container: tileContainer } = buildMutationToggleRow(tileOptions, (value) => {
      state[sec.stateKey] = value;
      updateDisplay();
    });
    section.appendChild(tileContainer);
    container.appendChild(section);
  }

  // --- Friends ---
  const friendSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
  friendSection.appendChild(el('span', `font-size:13px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.friends')));

  const { container: friendContainer } = buildPillRow(FRIEND_OPTIONS, '1', (value) => {
    state.playerCount = parseInt(value ?? '1', 10);
    updateDisplay();
  });
  friendSection.appendChild(friendContainer);
  container.appendChild(friendSection);

  // --- Divider ---
  container.appendChild(el('div', `height:1px;background:${BORDER_SUBTLE};`));

  // --- Formula ---
  formulaEl = el('div', 'text-align:center;');
  container.appendChild(formulaEl);

  updateDisplay();
  return updateDisplay;
}

// ---------------------------------------------------------------------------
// Pet tab
// ---------------------------------------------------------------------------

function renderPetTab(container: HTMLElement): () => void {
  container.style.cssText = 'display:flex;flex-direction:column;gap:16px;';

  const pets = buildPetOptions();
  const mutGroups = groupMutations();

  if (pets.length === 0) {
    container.appendChild(
      el('div', `text-align:center;color:${MUTED};font-size:13px;padding:40px 20px;`, t('feature.cropCalc.noPetData')),
    );
    return () => {};
  }

  const state: PetCalcState = {
    pet: pets[0] ?? null,
    maxStrength: 100,
    currentStrength: 100,
    colorMutation: null,
    playerCount: 1,
  };

  const spriteDisplay = buildPetSpriteDisplay();

  let priceEl: HTMLElement;
  let priceCoinEl: HTMLElement;
  let dustRow: HTMLElement;
  let dustPriceEl: HTMLElement;
  let dustIconEl: HTMLElement;
  let rangeEl: HTMLElement;
  let scaleEl: HTMLElement;
  let maxSliderInput: HTMLInputElement;
  let maxSliderValueEl: HTMLElement;
  let curSliderInput: HTMLInputElement;
  let curSliderValueEl: HTMLElement;
  let formulaEl: HTMLElement;
  let dustFormulaEl: HTMLElement;

  function getActiveMutations(): string[] {
    return state.colorMutation ? [state.colorMutation] : [];
  }

  function updateDisplay(): void {
    const { sellPrice, scale, mutMult, friendBonus, targetScale } = computePetCalcPrice(state);

    priceCoinEl.innerHTML = '';
    priceCoinEl.appendChild(makeCoinIcon(28));
    priceEl.textContent = fullFmt.format(sellPrice);

    // Range: newborn → fully mature at current maxStrength
    if (state.pet) {
      const ts = strengthToTargetScale(state.maxStrength, state.pet.maxScale);
      const mutations = getActiveMutations();
      const { totalMultiplier } = computeMutationMultiplier(mutations);
      const fb = 1 + (state.playerCount - 1) * 0.1;

      const floorStr = state.maxStrength - 30;
      const floorScale = state.maxStrength > 0 ? (floorStr / state.maxStrength) * ts : 0;
      const ceilScale = ts;

      const floorPrice = Math.round(Math.round(state.pet.maturitySellPrice * floorScale * totalMultiplier) * fb);
      const ceilPrice = Math.round(Math.round(state.pet.maturitySellPrice * ceilScale * totalMultiplier) * fb);

      rangeEl.textContent = `${fullFmt.format(floorPrice)} — ${fullFmt.format(ceilPrice)}`;
      rangeEl.style.display = '';
    } else {
      rangeEl.textContent = '';
      rangeEl.style.display = 'none';
    }

    // Dust value
    const dust = computePetDustValue(state);
    dustIconEl.innerHTML = '';
    dustIconEl.appendChild(makeDustIcon(20));
    dustPriceEl.textContent = fullFmt.format(dust.dustValue);
    dustRow.style.display = dust.dustValue > 0 ? 'flex' : 'none';

    // Scale display
    scaleEl.textContent = t('feature.cropCalc.scale', { scale: scale.toFixed(2) });

    // Slider value labels
    maxSliderValueEl.textContent = `${state.maxStrength}`;
    curSliderValueEl.textContent = `${state.currentStrength}`;

    // Sprite
    spriteDisplay.update(state.pet, getActiveMutations(), state.currentStrength, state.maxStrength);

    // Formula breakdown
    if (state.pet) {
      const basePart = fullFmt.format(state.pet.maturitySellPrice);
      const scalePart = scale.toFixed(2);
      const mutPart = mutMult === 1 ? '1' : `${mutMult}`;
      const friendPart = friendBonus === 1 ? '1' : friendBonus.toFixed(1);
      formulaEl.innerHTML = '';
      formulaEl.appendChild(
        el(
          'span',
          `color:${MUTED};font-size:11px;font-family:monospace;`,
          `${basePart} \u00D7 ${scalePart} \u00D7 ${mutPart} \u00D7 ${friendPart} = ${fullFmt.format(sellPrice)}`,
        ),
      );
      formulaEl.appendChild(
        el(
          'span',
          `color:${MUTED};font-size:10px;opacity:0.6;display:block;margin-top:2px;font-family:monospace;`,
          t('feature.cropCalc.formulaLabels'),
        ),
      );

      // Dust formula breakdown
      dustFormulaEl.innerHTML = '';
      if (dust.dustValue > 0) {
        dustFormulaEl.appendChild(
          el(
            'span',
            `color:${DUST_COLOR};font-size:11px;font-family:monospace;opacity:0.85;`,
            `100 \u00D7 ${dust.rarityMult} \u00D7 ${dust.pullRateMult} \u00D7 ${dust.dustMutMult} \u00D7 ${dust.scale.toFixed(2)} = ${fullFmt.format(dust.dustValue)}`,
          ),
        );
        dustFormulaEl.appendChild(
          el(
            'span',
            `color:${DUST_COLOR};font-size:10px;opacity:0.5;display:block;margin-top:2px;font-family:monospace;`,
            t('feature.cropCalc.dustFormulaLabels'),
          ),
        );
      }
    } else {
      formulaEl.innerHTML = '';
      dustFormulaEl.innerHTML = '';
    }
  }

  function onPetChange(pet: PetOption): void {
    state.pet = pet;
    state.maxStrength = 100;
    state.currentStrength = 100;
    maxSliderInput.value = '100';
    curSliderInput.min = String(100 - 30);
    curSliderInput.max = '100';
    curSliderInput.value = '100';
    updateDisplay();
  }

  // --- Pet selector ---
  const { container: selectorContainer } = buildPetSelector(pets, state.pet, onPetChange);
  container.appendChild(selectorContainer);

  // --- Result card ---
  const resultCard = el(
    'div',
    [
      `border:1px solid ${BORDER_SUBTLE}`,
      `background:${CARD_BG}`,
      'border-radius:10px',
      'padding:16px',
      'text-align:center',
      'overflow:visible',
    ].join(';'),
  );

  const spriteWrap = el('div', 'margin-bottom:8px;overflow:visible;padding-top:16px;');
  spriteWrap.appendChild(spriteDisplay.wrapper);
  resultCard.appendChild(spriteWrap);

  const priceRow = el('div', 'display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:4px;');
  priceCoinEl = el('span', '');
  priceEl = el('span', `font-size:28px;font-weight:700;color:${PRICE_COLOR};`);
  priceRow.append(priceCoinEl, priceEl);
  resultCard.appendChild(priceRow);

  dustRow = el('div', 'display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:4px;');
  dustIconEl = el('span', '');
  dustPriceEl = el('span', `font-size:20px;font-weight:600;color:${DUST_COLOR};`);
  dustRow.append(dustIconEl, dustPriceEl);
  resultCard.appendChild(dustRow);

  rangeEl = el('div', `font-size:13px;color:${MUTED};`);
  resultCard.appendChild(rangeEl);

  container.appendChild(resultCard);

  // --- Max Strength slider ---
  const maxStrSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
  const maxStrHeader = el('div', 'display:flex;align-items:center;gap:8px;');
  maxStrHeader.appendChild(el('span', `font-size:13px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.maxStrength')));

  maxSliderInput = document.createElement('input');
  maxSliderInput.type = 'range';
  maxSliderInput.min = '80';
  maxSliderInput.max = '100';
  maxSliderInput.step = '1';
  maxSliderInput.value = String(state.maxStrength);
  maxSliderInput.style.cssText = `flex:1;accent-color:${ACCENT};cursor:pointer;`;

  maxSliderValueEl = el('span', `font-size:13px;color:${TEXT};min-width:28px;text-align:right;`);

  maxStrHeader.append(maxSliderInput, maxSliderValueEl);
  maxStrSection.appendChild(maxStrHeader);
  container.appendChild(maxStrSection);

  // --- Current Strength slider ---
  const curStrSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
  const curStrHeader = el('div', 'display:flex;align-items:center;gap:8px;');
  curStrHeader.appendChild(el('span', `font-size:13px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.currentStrength')));

  curSliderInput = document.createElement('input');
  curSliderInput.type = 'range';
  curSliderInput.min = String(state.maxStrength - 30);
  curSliderInput.max = String(state.maxStrength);
  curSliderInput.step = '1';
  curSliderInput.value = String(state.currentStrength);
  curSliderInput.style.cssText = `flex:1;accent-color:${ACCENT};cursor:pointer;`;

  curSliderValueEl = el('span', `font-size:13px;color:${TEXT};min-width:28px;text-align:right;`);

  curStrHeader.append(curSliderInput, curSliderValueEl);
  curStrSection.appendChild(curStrHeader);

  // Scale label
  scaleEl = el('div', `font-size:12px;color:${MUTED};`);
  curStrSection.appendChild(scaleEl);

  container.appendChild(curStrSection);

  // Max strength slider handler
  maxSliderInput.addEventListener('input', () => {
    state.maxStrength = parseInt(maxSliderInput.value, 10);
    const newMin = state.maxStrength - 30;
    curSliderInput.min = String(newMin);
    curSliderInput.max = String(state.maxStrength);
    // Clamp current strength to valid range
    if (state.currentStrength > state.maxStrength) {
      state.currentStrength = state.maxStrength;
      curSliderInput.value = String(state.currentStrength);
    } else if (state.currentStrength < newMin) {
      state.currentStrength = newMin;
      curSliderInput.value = String(state.currentStrength);
    }
    updateDisplay();
  });

  // Current strength slider handler
  curSliderInput.addEventListener('input', () => {
    state.currentStrength = parseInt(curSliderInput.value, 10);
    updateDisplay();
  });

  // --- Color mutations only ---
  const colorDefs = mutGroups.color;
  if (colorDefs.length > 0) {
    const colorSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
    colorSection.appendChild(el('span', `font-size:13px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.color')));

    const tileOptions: MutationTileOption[] = colorDefs.map((d) => {
      const vb = findVariantBadge(d.name);
      const displayName = MUTATION_DISPLAY_NAMES[d.name] ?? d.name;
      return {
        value: d.name,
        displayName,
        multiplier: d.multiplier,
        color: vb?.color ?? '#888',
        gradient: vb?.gradient,
      };
    });

    const { container: tileContainer } = buildMutationToggleRow(tileOptions, (value) => {
      state.colorMutation = value;
      updateDisplay();
    });
    colorSection.appendChild(tileContainer);
    container.appendChild(colorSection);
  }

  // --- Friends ---
  const friendSection = el('div', 'display:flex;flex-direction:column;gap:4px;');
  friendSection.appendChild(el('span', `font-size:13px;font-weight:600;color:${TEXT};`, t('feature.cropCalc.friends')));

  const { container: friendContainer } = buildPillRow(FRIEND_OPTIONS, '1', (value) => {
    state.playerCount = parseInt(value ?? '1', 10);
    updateDisplay();
  });
  friendSection.appendChild(friendContainer);
  container.appendChild(friendSection);

  // --- Divider ---
  container.appendChild(el('div', `height:1px;background:${BORDER_SUBTLE};`));

  // --- Formula ---
  formulaEl = el('div', 'text-align:center;');
  container.appendChild(formulaEl);

  dustFormulaEl = el('div', 'text-align:center;margin-top:4px;');
  container.appendChild(dustFormulaEl);

  updateDisplay();
  return updateDisplay;
}

// ---------------------------------------------------------------------------
// Main render — tab orchestrator
// ---------------------------------------------------------------------------

export function renderCalculator(root: HTMLElement): void {
  root.style.cssText = 'display:flex;flex-direction:column;padding:16px;gap:16px;overflow-y:auto;max-width:460px;';

  // Catalog guard
  if (!areCatalogsReady()) {
    const placeholder = el(
      'div',
      `text-align:center;color:${MUTED};font-size:13px;padding:40px 20px;`,
      t('feature.cropCalc.waitingForData'),
    );
    root.appendChild(placeholder);

    const unsub = onCatalogsReady(() => {
      root.innerHTML = '';
      renderCalculator(root);
    });

    const observer = new MutationObserver(() => {
      if (!root.isConnected) {
        observer.disconnect();
        unsub();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return;
  }

  // Track current tab's update function for sprites-ready callback
  let currentUpdateFn: (() => void) | null = null;

  // --- Tab bar ---
  const { container: tabBar } = buildPillRow(
    [
      { label: t('feature.cropCalc.tabCrop'), value: 'crop' },
      { label: t('feature.cropCalc.tabPet'), value: 'pet' },
    ],
    'crop',
    (value) => {
      if (value === 'crop' || value === 'pet') switchTab(value);
    },
  );
  root.appendChild(tabBar);

  // --- Content area ---
  const contentDiv = el('div', 'display:flex;flex-direction:column;flex:1;min-height:0;');
  root.appendChild(contentDiv);

  function switchTab(tab: 'crop' | 'pet'): void {
    contentDiv.innerHTML = '';
    if (tab === 'crop') {
      currentUpdateFn = renderCropTab(contentDiv);
    } else {
      currentUpdateFn = renderPetTab(contentDiv);
    }
  }

  // Default tab
  switchTab('crop');

  // Sprites-ready callback
  const stopSpritesReady = onSpritesReady(() => {
    currentUpdateFn?.();
  });

  const detachObserver = new MutationObserver(() => {
    if (!root.isConnected) {
      detachObserver.disconnect();
      stopSpritesReady();
    }
  });
  detachObserver.observe(document.body, { childList: true, subtree: true });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function openCalculatorWindow(): void {
  toggleWindow('calculator', `\uD83E\uDDEE ${t('feature.cropCalc.windowTitle')}`, renderCalculator, '500px', '90vh');
}
