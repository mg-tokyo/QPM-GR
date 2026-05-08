// src/ui/xpTrackerWindow.ts - XP Tracker window (redesigned)

import { formatCoins } from '../features/valueCalculator';
import { log } from '../utils/logger';
import { onActivePetInfos, type ActivePetInfo } from '../store/pets';
import { getAtomByLabel, readAtomValue } from '../core/jotaiBridge';
import { getPetSpriteDataUrlWithMutations } from '../sprite-v2/compat';
import {
  calculateXpStats,
  getCombinedXpStats,
  getSpeciesXpPerLevel,
  calculateMaxStrength,
  calculateTimeToLevel,
  onXpTrackerUpdate,
  type XpAbilityStats,
} from '../store/xpTracker';
import { getAbilityDefinition, type AbilityDefinition } from '../data/petAbilities';
import { getAbilityColor } from '../utils/petCardRenderer';
import { getHungerCapOrDefault } from '../data/petHungerCaps';
import { calculateFeedsPerLevel } from '../data/petHungerDepletion';
import { throttle } from '../utils/scheduling';
import { getWeatherSnapshot } from '../store/weatherHub';
import type { DetailedWeather } from '../utils/weatherDetection';
import { getAbilityName } from '../utils/catalogHelpers';
import { storage } from '../utils/storage';
import { clampPct, scaledDimension } from '../utils/windowPosition';
import { swapPetIntoActiveSlot, placePetIntoActiveSlot, type SwapPetFailureReason } from '../features/petSwap';
import { onCatalogsReady } from '../catalogs/gameCatalogs';

// ============================================================================
// CONSTANTS
// ============================================================================

const LAYOUT_KEY = 'qpm.xpTrackerWindow.layout.v3';
/** Design-baseline dimensions (tuned for 1920px viewport). Used by updateContentScale. */
const DESIGN_WIDTH = 520;
const DESIGN_HEIGHT = 540;
/** Viewport-scaled defaults — always the same fraction of the screen. */
function defaultWidth(): number { return scaledDimension(DESIGN_WIDTH, 'w'); }
function defaultHeight(): number { return scaledDimension(DESIGN_HEIGHT, 'h'); }
const WEATHER_ICONS: Record<string, string> = {
  snow: '❄️', rain: '🌧️', dawn: '🌅', amber: '🌕', sunny: '☀️',
};

// ============================================================================
// TYPES
// ============================================================================

export interface XpTrackerWindowState {
  root: HTMLElement;
  scrollContent: HTMLElement;
  summaryStrip: HTMLElement;
  petCardsContainer: HTMLElement;
  nearMaxContainer: HTMLElement;
  latestPets: ActivePetInfo[];
  latestStats: XpAbilityStats[];
  totalTeamXpPerHour: number;
  lastKnownSpecies: Set<string>;
  unsubscribePets: (() => void) | null;
  unsubscribeXpTracker: (() => void) | null;
  resizeListener: (() => void) | null;
  currentWeather: DetailedWeather;
  updateInterval: (() => void) | null; // kept for API compat (unused)
  scaleWrapper: HTMLElement;
  scaleOuter: HTMLElement;
  updateScale: (() => void) | null;
  resizeObserver: ResizeObserver | null;
  nearMaxExpandedPetKey: string | null;
  nearMaxBusyPetKey: string | null;
  nearMaxStatus: { key: string; text: string; tone: 'success' | 'error' | 'info' } | null;
  nearMaxStatusTimer: number | null;
}

interface PetWithLevel {
  name: string;
  species: string;
  mutations: string[];
  level: number;
  xp: number;
  maxStr: number;
  xpNeeded: number;
  xpPerLevel: number;
  source: 'active' | 'inventory' | 'hutch';
  itemId: string | null;
  storageId: string | null;
  activeSlotId: string | null;
}

interface WindowLayout {
  xPct: number;
  yPct: number;
  width: number;
  height: number;
}

const MARGIN = 8;
let currentPct = { xPct: 0.5, yPct: 0.5 };

function layoutPctToPixels(xPct: number, yPct: number, w: number, h: number): { x: number; y: number } {
  const availW = Math.max(0, window.innerWidth - w - MARGIN * 2);
  const availH = Math.max(0, window.innerHeight - h - MARGIN * 2);
  return {
    x: Math.round(MARGIN + clampPct(xPct) * availW),
    y: Math.round(MARGIN + clampPct(yPct) * availH),
  };
}

function layoutPixelsToPct(x: number, y: number, w: number, h: number): { xPct: number; yPct: number } {
  const availW = Math.max(1, window.innerWidth - w - MARGIN * 2);
  const availH = Math.max(1, window.innerHeight - h - MARGIN * 2);
  return {
    xPct: clampPct((x - MARGIN) / availW),
    yPct: clampPct((y - MARGIN) / availH),
  };
}

// Module-level filter state — no window globals
const nearMaxSources = new Set<'active' | 'inventory' | 'hutch'>(['active', 'inventory', 'hutch']);

// ============================================================================
// ABILITY DETECTION — dynamic, catalog-driven (no hardcoded ID list)
// ============================================================================

function findXpAbilities(pet: ActivePetInfo): AbilityDefinition[] {
  if (!pet.abilities?.length) return [];
  return pet.abilities
    .map(id => getAbilityDefinition(id))
    .filter((def): def is AbilityDefinition =>
      def?.category === 'xp' && def.trigger === 'continuous'
    );
}

export interface XpTrackerSummaryStats {
  abilityCount: number;
  abilityXpPerHour: number;
  totalTeamXpPerHour: number;
  totalProcsPerHour: number;
  totalProcCount: number;
  currentWeather: DetailedWeather;
}

interface XpTrackerComputedStats extends XpTrackerSummaryStats {
  stats: XpAbilityStats[];
}

function getXpTrackerComputedStats(pets: ActivePetInfo[]): XpTrackerComputedStats {
  const currentWeather = getWeatherSnapshot().kind;
  const stats: XpAbilityStats[] = [];
  for (const pet of pets) {
    for (const def of findXpAbilities(pet)) {
      stats.push(calculateXpStats(
        pet,
        def.id,
        getAbilityName(def.id),
        def.baseProbability ?? 0,
        def.effectValuePerProc ?? 0,
        def.requiredWeather ?? null,
        currentWeather,
      ));
    }
  }

  const combined = stats.length > 0 ? getCombinedXpStats(stats) : null;
  const abilityXpPerHour = combined?.totalXpPerHour ?? 0;
  return {
    stats,
    abilityCount: stats.length,
    abilityXpPerHour,
    totalTeamXpPerHour: 3600 + abilityXpPerHour,
    totalProcsPerHour: combined?.totalProcsPerHour ?? 0,
    totalProcCount: combined?.totalProcCount ?? 0,
    currentWeather,
  };
}

export function getXpTrackerSummaryStats(pets: ActivePetInfo[]): XpTrackerSummaryStats {
  const { stats: _stats, ...summary } = getXpTrackerComputedStats(pets);
  return summary;
}

// ============================================================================
// UTILITY HELPERS
// ============================================================================

function parseMaxLevelFromName(name: string | null | undefined): number | null {
  if (!name) return null;
  const match = name.match(/\((\d+)\)/);
  return match?.[1] ? parseInt(match[1], 10) : null;
}

/** Format total minutes into a compact human-readable string */
function formatTime(totalMinutes: number): string {
  if (totalMinutes >= 1440) {
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

function getMaxStr(pet: ActivePetInfo): number | null {
  if (pet.species && pet.targetScale) return calculateMaxStrength(pet.targetScale, pet.species);
  if (pet.strength != null && pet.strength >= 80 && pet.strength <= 100) return pet.strength;
  return null;
}

function splitMutationTokens(value: string): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const tokens = /[,|/;]/.test(trimmed) ? trimmed.split(/[,|/;]/g) : [trimmed];
  return tokens.map((token) => token.trim()).filter((token) => token.length > 0 && /[a-z]/i.test(token));
}

function collectMutationNames(value: unknown, out: string[], seen = new WeakSet<object>(), depth = 0): void {
  if (value == null || depth > 4) return;
  if (typeof value === 'string') {
    out.push(...splitMutationTokens(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectMutationNames(item, out, seen, depth + 1);
    }
    return;
  }
  if (value instanceof Set) {
    collectMutationNames(Array.from(value.values()), out, seen, depth + 1);
    return;
  }
  if (value instanceof Map) {
    collectMutationNames(Array.from(value.values()), out, seen, depth + 1);
    return;
  }
  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  collectMutationNames(record.mutation, out, seen, depth + 1);
  collectMutationNames(record.mutations, out, seen, depth + 1);

  const descriptorKeys = new Set(['id', 'name', 'displayName', 'label', 'value', 'variant', 'key', 'type', 'slug', '__typename']);
  const isDescriptorObject = keys.length > 0 && keys.every((key) => descriptorKeys.has(key));
  if (isDescriptorObject) {
    const namedFields = [record.name, record.displayName, record.label, record.value, record.variant, record.key, record.id];
    for (const field of namedFields) {
      if (typeof field === 'string') {
        out.push(...splitMutationTokens(field));
      }
    }
  } else {
    const isFlagMap =
      keys.length > 0 &&
      keys.length <= 8 &&
      keys.every((key) => typeof record[key] === 'boolean' || typeof record[key] === 'number');
    if (isFlagMap) {
      for (const key of keys) {
        const flag = record[key];
        if (flag) {
          out.push(...splitMutationTokens(key));
        }
      }
    }
  }
}

function extractItemMutations(entry: Record<string, unknown>): string[] {
  const out: string[] = [];
  collectMutationNames(entry.mutation, out);
  collectMutationNames(entry.mutations, out);
  const rawEntry = entry.raw;
  if (rawEntry && typeof rawEntry === 'object') {
    const rawRecord = rawEntry as Record<string, unknown>;
    collectMutationNames(rawRecord.mutation, out);
    collectMutationNames(rawRecord.mutations, out);
    const rawNestedPet = rawRecord.pet;
    if (rawNestedPet && typeof rawNestedPet === 'object') {
      const petRecord = rawNestedPet as Record<string, unknown>;
      collectMutationNames(petRecord.mutation, out);
      collectMutationNames(petRecord.mutations, out);
    }
  }
  const nestedPet = entry.pet;
  if (nestedPet && typeof nestedPet === 'object') {
    const petRecord = nestedPet as Record<string, unknown>;
    collectMutationNames(petRecord.mutation, out);
    collectMutationNames(petRecord.mutations, out);
  }
  const deduped = new Map<string, string>();
  for (const name of out) {
    const key = name.toLowerCase();
    if (!deduped.has(key)) {
      deduped.set(key, name);
    }
  }
  return Array.from(deduped.values());
}

function normalizeId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function extractItemId(entry: Record<string, unknown>): string | null {
  const nestedPet = entry.pet && typeof entry.pet === 'object'
    ? (entry.pet as Record<string, unknown>)
    : null;
  const nestedRaw = entry.raw && typeof entry.raw === 'object'
    ? (entry.raw as Record<string, unknown>)
    : null;
  const nestedRawPet = nestedRaw?.pet && typeof nestedRaw.pet === 'object'
    ? (nestedRaw.pet as Record<string, unknown>)
    : null;

  const candidates = [
    normalizeId(entry.id),
    normalizeId(entry.itemId),
    normalizeId(entry.petId),
    normalizeId(entry.slotId),
    normalizeId(nestedPet?.id),
    normalizeId(nestedPet?.itemId),
    normalizeId(nestedPet?.petId),
    normalizeId(nestedRaw?.id),
    normalizeId(nestedRaw?.itemId),
    normalizeId(nestedRaw?.petId),
    normalizeId(nestedRawPet?.id),
    normalizeId(nestedRawPet?.itemId),
    normalizeId(nestedRawPet?.petId),
  ];
  return candidates.find((value): value is string => Boolean(value)) ?? null;
}

function extractStorageId(entry: Record<string, unknown>): string | null {
  const nestedStorage = entry.storage && typeof entry.storage === 'object'
    ? (entry.storage as Record<string, unknown>)
    : null;
  const nestedRaw = entry.raw && typeof entry.raw === 'object'
    ? (entry.raw as Record<string, unknown>)
    : null;
  const nestedRawStorage = nestedRaw?.storage && typeof nestedRaw.storage === 'object'
    ? (nestedRaw.storage as Record<string, unknown>)
    : null;

  const candidates = [
    normalizeId(entry.storageId),
    normalizeId(entry.storageID),
    normalizeId(entry.storageType),
    normalizeId(nestedStorage?.id),
    normalizeId(nestedStorage?.storageId),
    normalizeId(nestedRaw?.storageId),
    normalizeId(nestedRaw?.storageID),
    normalizeId(nestedRawStorage?.id),
    normalizeId(nestedRawStorage?.storageId),
  ];
  return candidates.find((value): value is string => Boolean(value)) ?? null;
}

function getNearMaxPetKey(pet: PetWithLevel): string {
  const idPart = pet.itemId ?? `${pet.species}:${pet.xp}:${pet.level}:${pet.maxStr}`;
  return `${pet.source}:${idPart}`;
}

function mapSwapErrorReason(reason: SwapPetFailureReason | undefined): string {
  switch (reason) {
    case 'missing_connection':
      return 'Swap unavailable: connection missing.';
    case 'missing_ids':
      return 'Swap unavailable: pet identifiers missing.';
    case 'retrieve_failed_or_inventory_full':
      return 'Cannot retrieve from hutch (inventory may be full).';
    case 'swap_failed_or_timeout':
      return 'Swap failed or timed out.';
    default:
      return 'Swap failed.';
  }
}

function setNearMaxStatus(
  state: XpTrackerWindowState,
  key: string,
  text: string,
  tone: 'success' | 'error' | 'info',
): void {
  state.nearMaxStatus = { key, text, tone };
  if (state.nearMaxStatusTimer != null) {
    window.clearTimeout(state.nearMaxStatusTimer);
  }
  state.nearMaxStatusTimer = window.setTimeout(() => {
    state.nearMaxStatus = null;
    state.nearMaxStatusTimer = null;
    void updateNearMaxLevelDisplay(state);
  }, 2600);
}

// ============================================================================
// LAYOUT PERSISTENCE
// ============================================================================

function loadLayout(): WindowLayout | null {
  try {
    const saved = storage.get<Record<string, unknown> | null>(LAYOUT_KEY, null);
    if (!saved || typeof saved !== 'object') return null;

    const width = (typeof saved.width === 'number' && saved.width >= defaultWidth()) ? saved.width : defaultWidth();
    const height = (typeof saved.height === 'number' && saved.height >= defaultHeight()) ? saved.height : defaultHeight();

    // New format: xPct/yPct ratios
    if (typeof saved.xPct === 'number' && typeof saved.yPct === 'number') {
      return { xPct: clampPct(saved.xPct), yPct: clampPct(saved.yPct), width, height };
    }

    // Old format: top/left pixels — migrate
    if (typeof saved.top === 'number' && typeof saved.left === 'number') {
      const pct = layoutPixelsToPct(saved.left, saved.top, width, height);
      return { xPct: pct.xPct, yPct: pct.yPct, width, height };
    }

    return null;
  } catch { return null; }
}

function saveLayout(root: HTMLElement): void {
  try {
    storage.set(LAYOUT_KEY, {
      xPct: currentPct.xPct,
      yPct: currentPct.yPct,
      width: root.offsetWidth || defaultWidth(),
      height: root.offsetHeight || defaultHeight(),
    } satisfies WindowLayout);
  } catch { /* ignore */ }
}

function capturePositionAndSave(root: HTMLElement): void {
  const rect = root.getBoundingClientRect();
  const pct = layoutPixelsToPct(rect.left, rect.top, rect.width, rect.height);
  currentPct.xPct = pct.xPct;
  currentPct.yPct = pct.yPct;
  saveLayout(root);
}

function applyCurrentPosition(root: HTMLElement): void {
  const { x, y } = layoutPctToPixels(currentPct.xPct, currentPct.yPct, root.offsetWidth, root.offsetHeight);
  root.style.left = `${x}px`;
  root.style.top = `${y}px`;
}

// ============================================================================
// WINDOW CHROME — drag, resize, clamp
// ============================================================================

function makeDraggable(root: HTMLElement, handle: HTMLElement, onEnd: () => void): void {
  let sx = 0, sy = 0, startLeft = 0, startTop = 0;
  const onMove = (e: MouseEvent) => {
    const dx = e.clientX - sx;
    const dy = e.clientY - sy;
    const rawLeft = startLeft + dx;
    const rawTop = startTop + dy;
    const w = root.offsetWidth;
    const h = root.offsetHeight;
    const maxLeft = Math.max(MARGIN, window.innerWidth - w - MARGIN);
    const maxTop = Math.max(MARGIN, window.innerHeight - h - MARGIN);
    root.style.left = `${Math.max(MARGIN, Math.min(maxLeft, rawLeft))}px`;
    root.style.top = `${Math.max(MARGIN, Math.min(maxTop, rawTop))}px`;
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    capturePositionAndSave(root);
    onEnd();
  };
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    sx = e.clientX;
    sy = e.clientY;
    const rect = root.getBoundingClientRect();
    startLeft = rect.left;
    startTop = rect.top;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/** Resize from bottom-right corner handle — adjusts width AND height */
function makeResizable(root: HTMLElement, handle: HTMLElement, onEnd: () => void): void {
  let sx = 0, sy = 0, sw = 0, sh = 0;
  const onMove = (e: MouseEvent) => {
    const maxW = window.innerWidth - parseFloat(root.style.left || '0') - MARGIN;
    const maxH = window.innerHeight - parseFloat(root.style.top || '0') - MARGIN;
    root.style.width = `${Math.max(320, Math.min(sw + e.clientX - sx, maxW))}px`;
    root.style.height = `${Math.max(200, Math.min(sh + e.clientY - sy, maxH))}px`;
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    capturePositionAndSave(root);
    onEnd();
  };
  handle.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    sx = e.clientX;
    sy = e.clientY;
    sw = root.offsetWidth;
    sh = root.offsetHeight;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

/**
 * Scale the scroll content proportionally to the window width using
 * CSS transform: scale() so card backgrounds scale correctly alongside text.
 * scaleOuter acts as a height-tracking wrapper (transform doesn't affect layout).
 */
function updateContentScale(scaleWrapper: HTMLElement, scaleOuter: HTMLElement, defaultWidth: number): void {
  const parent = scaleOuter.parentElement;
  if (!parent) return;
  const w = parent.offsetWidth;
  if (w <= 0) return;
  const scale = Math.max(0.65, Math.min(4, w / defaultWidth));
  scaleWrapper.style.transformOrigin = 'top left';
  scaleWrapper.style.transform = `scale(${scale.toFixed(4)})`;
  scaleWrapper.style.width = `${(100 / scale).toFixed(3)}%`;
  scaleOuter.style.height = `${Math.ceil(scaleWrapper.scrollHeight * scale)}px`;
}

// ============================================================================
// UI PRIMITIVES
// ============================================================================

function makeChip(text: string, color: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  el.style.cssText = [
    `color:${color}`,
    'font-size:11px',
    'font-family:monospace',
    'background:rgba(255,255,255,0.05)',
    'padding:2px 8px',
    'border-radius:10px',
    'border:1px solid rgba(255,255,255,0.08)',
    'white-space:nowrap',
  ].join(';');
  return el;
}

function makePillButton(text: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = [
    'padding:3px 10px',
    'font-size:11px',
    'border-radius:10px',
    'cursor:pointer',
    `font-weight:${active ? '600' : '400'}`,
    `background:${active ? 'var(--qpm-accent,#4CAF50)' : 'rgba(255,255,255,0.06)'}`,
    `color:${active ? '#fff' : 'var(--qpm-text-muted,#888)'}`,
    `border:1px solid ${active ? 'var(--qpm-accent,#4CAF50)' : 'rgba(255,255,255,0.12)'}`,
    'transition:all 0.15s ease',
  ].join(';');
  return btn;
}

function createCollapsible(titleText: string, startExpanded: boolean): { wrapper: HTMLElement; content: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.style.borderTop = '1px solid var(--qpm-border,#2a2a2a)';

  const header = document.createElement('div');
  header.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'padding:8px 14px',
    'cursor:pointer',
    'user-select:none',
    'background:var(--qpm-surface-1,#141414)',
  ].join(';');

  const titleEl = document.createElement('span');
  titleEl.textContent = titleText;
  titleEl.style.cssText = 'color:var(--qpm-text,#fff);font-size:12px;font-weight:600;pointer-events:none;';

  const chevron = document.createElement('span');
  chevron.textContent = startExpanded ? '▼' : '▶';
  chevron.style.cssText = 'color:var(--qpm-text-muted,#555);font-size:9px;pointer-events:none;';

  header.appendChild(titleEl);
  header.appendChild(chevron);

  const content = document.createElement('div');
  content.style.display = startExpanded ? 'block' : 'none';

  header.addEventListener('click', () => {
    const open = content.style.display !== 'none';
    content.style.display = open ? 'none' : 'block';
    chevron.textContent = open ? '▶' : '▼';
  });

  wrapper.appendChild(header);
  wrapper.appendChild(content);
  return { wrapper, content };
}

// ============================================================================
// PET CARD
// ============================================================================

function createPetCard(pet: ActivePetInfo, teamXpPerHour: number): HTMLElement {
  const maxStr = getMaxStr(pet);
  const xpPerLevel = pet.species ? getSpeciesXpPerLevel(pet.species) : null;

  const card = document.createElement('div');
  card.style.cssText = [
    'background:var(--qpm-surface-2,#1a1a1a)',
    'border:1px solid var(--qpm-border,#2a2a2a)',
    'border-radius:6px',
    'padding:10px 12px',
    'display:flex',
    'flex-direction:column',
    'gap:7px',
  ].join(';');

  // ── Header row: [ability badges] [sprite] [name block] [STR badge] ──
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;';

  // Ability badge column (colored squares, one per ability)
  const petAbilities = pet.abilities ?? [];
  if (petAbilities.length > 0) {
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex-shrink:0;';
    for (const id of petAbilities.slice(0, 4)) {
      const c = getAbilityColor(id);
      const sq = document.createElement('div');
      sq.title = id;
      sq.style.cssText = [
        'width:8px',
        'height:8px',
        'border-radius:2px',
        `background:${c.base}`,
        'border:1px solid rgba(255,255,255,0.2)',
        `box-shadow:0 0 3px ${c.glow}`,
      ].join(';');
      col.appendChild(sq);
    }
    header.appendChild(col);
  }

  // Sprite
  if (pet.species) {
    const img = document.createElement('img');
    img.src = getPetSpriteDataUrlWithMutations(pet.species, pet.mutations ?? []) ?? '';
    img.dataset.qpmSprite = `pet:${pet.species}`;
    img.alt = pet.species;
    img.style.cssText = 'width:36px;height:36px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';
    header.appendChild(img);
  }

  // Name + species
  const nameBlock = document.createElement('div');
  nameBlock.style.cssText = 'flex:1;min-width:0;';

  const nameEl = document.createElement('div');
  nameEl.textContent = pet.name || pet.species || 'Unknown';
  nameEl.style.cssText = 'font-weight:600;color:var(--qpm-text,#fff);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  nameBlock.appendChild(nameEl);

  if (pet.name && pet.species) {
    const sub = document.createElement('div');
    sub.textContent = pet.species;
    sub.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#555);margin-top:1px;';
    nameBlock.appendChild(sub);
  }
  header.appendChild(nameBlock);

  // STR badge
  if (pet.strength != null) {
    const badge = document.createElement('div');
    badge.style.cssText = 'text-align:right;flex-shrink:0;';

    const strEl = document.createElement('div');
    strEl.textContent = `STR ${pet.strength}`;
    strEl.style.cssText = 'font-weight:700;font-family:monospace;font-size:13px;color:var(--qpm-accent,#4CAF50);';
    badge.appendChild(strEl);

    if (maxStr) {
      const maxEl = document.createElement('div');
      maxEl.textContent = `MAX ${maxStr}`;
      maxEl.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#666);font-family:monospace;margin-top:1px;';
      badge.appendChild(maxEl);
    }
    header.appendChild(badge);
  }

  card.appendChild(header);

  // ── Progress bar + time chips ──
  if (pet.xp !== null && pet.strength !== null && xpPerLevel && maxStr) {
    if (pet.strength >= maxStr) {
      const maxMsg = document.createElement('div');
      maxMsg.textContent = `🌟 MAX STR ${maxStr} — fully levelled`;
      maxMsg.style.cssText = 'font-size:11px;color:var(--qpm-accent,#4CAF50);font-weight:600;';
      card.appendChild(maxMsg);
    } else {
      const xpToNext = pet.xp % xpPerLevel;
      const pct = Math.min(100, (xpToNext / xpPerLevel) * 100);

      // Progress bar
      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;';

      const track = document.createElement('div');
      track.style.cssText = 'height:8px;background:rgba(255,255,255,0.07);border-radius:4px;overflow:hidden;';

      const fill = document.createElement('div');
      fill.style.cssText = `width:${pct.toFixed(1)}%;height:100%;background:linear-gradient(90deg,var(--qpm-accent,#4CAF50),#8BC34A);border-radius:4px;`;
      track.appendChild(fill);
      barWrap.appendChild(track);

      const lbl = document.createElement('div');
      lbl.style.cssText = 'display:flex;justify-content:space-between;font-size:10px;color:var(--qpm-text-muted,#666);font-family:monospace;';
      lbl.innerHTML = `<span>${formatCoins(xpToNext)} / ${formatCoins(xpPerLevel)}</span><span>${pct.toFixed(1)}%</span>`;
      barWrap.appendChild(lbl);
      card.appendChild(barWrap);

      // Time chips row
      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;';

      if (teamXpPerHour > 0) {
        const timeToNext = calculateTimeToLevel(xpToNext, xpPerLevel, teamXpPerHour);
        if (timeToNext) {
          chips.appendChild(makeChip(`⏱ Next: ${formatTime(timeToNext.totalMinutes)}`, 'var(--qpm-positive,#4CAF50)'));
        }

        const levelsLeft = maxStr - pet.strength;
        const xpToMax = (xpPerLevel - xpToNext) + xpPerLevel * (levelsLeft - 1);
        const minsToMax = (xpToMax / teamXpPerHour) * 60;
        chips.appendChild(makeChip(`🏁 Max: ${formatTime(minsToMax)}`, 'var(--qpm-warning,#FF9800)'));

        if (pet.species) {
          const hungerCap = getHungerCapOrDefault(pet.species);
          const feeds = calculateFeedsPerLevel(pet.species, hungerCap, xpPerLevel, teamXpPerHour);
          if (feeds && feeds > 0) {
            chips.appendChild(makeChip(`🍖 ${feeds} feeds/lvl`, 'rgba(255,255,255,0.4)'));
          }
        }
      } else {
        chips.appendChild(makeChip('No XP rate', 'var(--qpm-text-muted,#555)'));
      }

      if (chips.children.length > 0) card.appendChild(chips);
    }
  } else if (!xpPerLevel && pet.species) {
    const note = document.createElement('div');
    note.textContent = 'XP/level loading from catalog…';
    note.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#444);font-style:italic;';
    card.appendChild(note);
  }

  return card;
}

// ============================================================================
// SUMMARY STRIP
// ============================================================================

function updateSummaryStrip(
  el: HTMLElement,
  stats: XpAbilityStats[],
  teamXpPerHour: number,
  weather: DetailedWeather,
  petCount: number,
): void {
  el.innerHTML = '';
  const abilityXp = teamXpPerHour - 3600;
  const weatherIcon = WEATHER_ICONS[weather] ?? '';
  const weatherLabel = weather === 'unknown' ? '' : weather;

  const frag = (html: string, color?: string) => {
    const s = document.createElement('span');
    s.innerHTML = html;
    if (color) s.style.color = color;
    return s;
  };

  if (stats.length === 0) {
    el.appendChild(frag(`${petCount} pet${petCount !== 1 ? 's' : ''}`, 'var(--qpm-text-muted,#666)'));
    el.appendChild(frag('·', 'var(--qpm-border,#444)'));
    el.appendChild(frag('3,600 XP/hr', 'var(--qpm-warning,#FF9800)'));
    el.appendChild(frag('(base, no XP abilities)', 'var(--qpm-text-muted,#444)'));
  } else {
    el.appendChild(frag('Base', 'var(--qpm-text-muted,#666)'));
    el.appendChild(frag('3,600', 'var(--qpm-warning,#FF9800)'));
    el.appendChild(frag('+', 'var(--qpm-text-muted,#444)'));
    el.appendChild(frag('Ability', 'var(--qpm-text-muted,#666)'));
    el.appendChild(frag(`+${formatCoins(abilityXp)}`, 'var(--qpm-warning,#FF9800)'));
    el.appendChild(frag('=', 'var(--qpm-text-muted,#444)'));

    const total = frag(formatCoins(teamXpPerHour) + ' XP/hr', 'var(--qpm-accent,#4CAF50)');
    total.style.fontWeight = '700';
    total.style.fontSize = '12px';
    el.appendChild(total);

    el.appendChild(frag(`· ${stats.length} XP ${stats.length === 1 ? 'pet' : 'pets'}`, 'var(--qpm-text-muted,#555)'));
  }

  if (weatherLabel) {
    const wChip = document.createElement('span');
    wChip.textContent = `${weatherIcon} ${weatherLabel}`;
    wChip.style.cssText = 'margin-left:auto;color:var(--qpm-text-muted,#666);font-size:11px;';
    el.appendChild(wChip);
  }
}

// ============================================================================
// MAIN DISPLAY UPDATE
// ============================================================================

function updateXpTrackerDisplay(state: XpTrackerWindowState): void {
  const computed = getXpTrackerComputedStats(state.latestPets);
  state.currentWeather = computed.currentWeather;
  state.latestStats = computed.stats;
  state.totalTeamXpPerHour = computed.totalTeamXpPerHour;

  updateSummaryStrip(state.summaryStrip, computed.stats, state.totalTeamXpPerHour, state.currentWeather, state.latestPets.length);
  renderPetCards(state);
  void updateNearMaxLevelDisplay(state);
}

function renderPetCards(state: XpTrackerWindowState): void {
  state.petCardsContainer.innerHTML = '';
  if (state.latestPets.length === 0) {
    const empty = document.createElement('div');
    empty.textContent = 'No active pets detected.';
    empty.style.cssText = 'padding:18px;color:var(--qpm-text-muted,#555);font-style:italic;text-align:center;font-size:12px;';
    state.petCardsContainer.appendChild(empty);
    state.updateScale?.();
    return;
  }
  for (const pet of state.latestPets) {
    state.petCardsContainer.appendChild(createPetCard(pet, state.totalTeamXpPerHour));
  }
  // Sync scaleOuter height after content changes so scrolling reflects visual size.
  state.updateScale?.();
}

// ============================================================================
// NEAR MAX LEVEL — get pets data
// ============================================================================

async function getAllPets(activePets: ActivePetInfo[]): Promise<PetWithLevel[]> {
  const allPets: PetWithLevel[] = [];

  // Active pets
  for (const pet of activePets) {
    if (!pet.species || pet.xp === null || pet.strength === null) continue;
    const xpPerLevel = getSpeciesXpPerLevel(pet.species);
    if (!xpPerLevel) continue;
    const levelsGained = Math.min(30, Math.floor(pet.xp / xpPerLevel));
    const hatchLevel = pet.strength - levelsGained;
    const maxStr = Math.min(hatchLevel + 30, 100);
    if (pet.strength >= maxStr) continue;
    const xpToNext = pet.xp % xpPerLevel;
    const levelsLeft = maxStr - pet.strength;
    const xpNeeded = (xpPerLevel - xpToNext) + xpPerLevel * (levelsLeft - 1);
    allPets.push({
      name: pet.name || pet.species,
      species: pet.species,
      mutations: Array.isArray(pet.mutations) ? [...pet.mutations] : [],
      level: pet.strength,
      xp: pet.xp,
      maxStr,
      xpNeeded,
      xpPerLevel,
      source: 'active',
      itemId: normalizeId(pet.petId) ?? normalizeId(pet.slotId),
      storageId: null,
      activeSlotId: normalizeId(pet.slotId) ?? normalizeId(pet.petId),
    });
  }

  // Extract items array from an atom value — handles both plain arrays and {items:[]} wrappers
  function extractAtomItems(data: unknown): unknown[] {
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object') {
      const record = data as Record<string, unknown>;
      if (Array.isArray(record.items)) return record.items;
    }
    return [];
  }

  // Shared item processor for inventory and hutch
  const processItems = (items: unknown[], source: 'inventory' | 'hutch') => {
    if (!Array.isArray(items)) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const i = item as Record<string, unknown>;
      // Support game's nested pet sub-object (entry.pet.species, entry.pet.xp, etc.)
      const nested = (i.pet && typeof i.pet === 'object') ? i.pet as Record<string, unknown> : null;

      const species = (i.petSpecies ?? i.species ?? nested?.petSpecies ?? nested?.species) as string | undefined;

      // For inventory, require pet itemType (case-insensitive, checks both itemType and type fields)
      if (source === 'inventory') {
        const itemType = String(i.itemType ?? i.type ?? '').toLowerCase();
        if (!itemType.includes('pet') && !species) continue;
      }

      if (!species) continue;

      const xp = (i.xp ?? nested?.xp) as number | null | undefined;
      if (xp == null) continue;

      const mutations = extractItemMutations(i);
      const xpPerLevel = getSpeciesXpPerLevel(species);
      if (!xpPerLevel) continue;

      // Determine strength: prefer direct/nested strength, then targetScale, then name parse
      const rawStrength = (i.strength ?? nested?.strength) as number | null | undefined;
      const rawTargetScale = (i.targetScale ?? nested?.targetScale) as number | null | undefined;

      let currentStr: number, maxStr: number;
      if (rawStrength != null) {
        currentStr = rawStrength;
        const levelsGained = Math.min(30, Math.floor(xp / xpPerLevel));
        maxStr = Math.min(currentStr - levelsGained + 30, 100);
      } else if (rawTargetScale != null) {
        const calcMax = calculateMaxStrength(rawTargetScale, species);
        maxStr = calcMax ?? 100;
        currentStr = (maxStr - 30) + Math.min(30, Math.floor(xp / xpPerLevel));
      } else {
        const parsedMax = parseMaxLevelFromName((i.name ?? nested?.name) as string | undefined);
        if (!parsedMax || parsedMax < 80 || parsedMax > 100) continue;
        maxStr = parsedMax;
        currentStr = (maxStr - 30) + Math.min(30, Math.floor(xp / xpPerLevel));
      }

      if (currentStr >= maxStr) continue;
      const xpToNext = xp % xpPerLevel;
      const levelsLeft = maxStr - currentStr;
      const xpNeeded = (xpPerLevel - xpToNext) + xpPerLevel * (levelsLeft - 1);
      allPets.push({
        name: ((i.name ?? nested?.name) as string | undefined) || species,
        species,
        mutations,
        level: currentStr,
        xp,
        maxStr,
        xpNeeded,
        xpPerLevel,
        source,
        itemId: extractItemId(i),
        storageId: source === 'hutch' ? extractStorageId(i) : null,
        activeSlotId: null,
      });
    }
  };

  try {
    // Prefer myPetInventoryAtom (dedicated pet inventory slot), fall back to myInventoryAtom
    const invAtom = getAtomByLabel('myPetInventoryAtom') ?? getAtomByLabel('myInventoryAtom');
    if (invAtom) {
      const invData = await readAtomValue(invAtom) as unknown;
      processItems(extractAtomItems(invData), 'inventory');
    }
  } catch (e) { log('⚠️ Near max: inventory read failed', e); }

  try {
    const hutchAtom = getAtomByLabel('myPetHutchPetItemsAtom');
    if (hutchAtom) {
      const hutchData = await readAtomValue(hutchAtom) as unknown;
      processItems(extractAtomItems(hutchData), 'hutch');
    }
  } catch (e) { log('⚠️ Near max: hutch read failed', e); }

  return allPets;
}

// ============================================================================
// NEAR MAX LEVEL — display
// ============================================================================

async function updateNearMaxLevelDisplay(state: XpTrackerWindowState): Promise<void> {
  const container = state.nearMaxContainer;
  try {
    const allPets = (await getAllPets(state.latestPets))
      .sort((a, b) => a.xpNeeded - b.xpNeeded)
      .slice(0, 50);

    const observedSlotIndexes = Array.from(new Set(
      state.latestPets
        .map((pet) => pet.slotIndex)
        .filter((value) => Number.isFinite(value))
    )).sort((a, b) => a - b);
    const slotIndexes: number[] = observedSlotIndexes.length > 0
      ? observedSlotIndexes.slice(0, 3)
      : [0, 1, 2];
    let fallbackSlotIndex = slotIndexes.length > 0 ? Math.max(...slotIndexes) + 1 : 0;
    while (slotIndexes.length < 3) {
      if (!slotIndexes.includes(fallbackSlotIndex)) {
        slotIndexes.push(fallbackSlotIndex);
      }
      fallbackSlotIndex += 1;
    }

    const activeSlots = slotIndexes.map((slotIndex, visualIndex) => {
      const activePet = state.latestPets.find((p) => p.slotIndex === slotIndex) ?? null;
      const targetSlotId = normalizeId(activePet?.slotId) ?? normalizeId(activePet?.petId);
      return { slotIndex, visualIndex: visualIndex + 1, activePet, targetSlotId };
    });
    // We support both swap (occupied slot) and place (empty slot), so always allow interaction.
    const hasAnySlot = activeSlots.length > 0;

    container.innerHTML = '';

    const filterRow = document.createElement('div');
    filterRow.style.cssText = 'display:flex;gap:6px;padding:10px 14px 4px;flex-wrap:wrap;align-items:center;';

    const filterLbl = document.createElement('span');
    filterLbl.textContent = 'Show:';
    filterLbl.style.cssText = 'font-size:11px;color:var(--qpm-text-muted,#666);';
    filterRow.appendChild(filterLbl);

    const sourceDefs: Array<{ key: 'active' | 'inventory' | 'hutch'; label: string }> = [
      { key: 'active', label: 'Active' },
      { key: 'inventory', label: 'Inventory' },
      { key: 'hutch', label: 'Hutch' },
    ];

    for (const sourceDef of sourceDefs) {
      const btn = makePillButton(sourceDef.label, nearMaxSources.has(sourceDef.key));
      btn.addEventListener('click', () => {
        if (nearMaxSources.has(sourceDef.key)) {
          nearMaxSources.delete(sourceDef.key);
        } else {
          nearMaxSources.add(sourceDef.key);
        }
        void updateNearMaxLevelDisplay(state);
      });
      filterRow.appendChild(btn);
    }
    container.appendChild(filterRow);

    const filtered = allPets.filter((pet) => nearMaxSources.has(pet.source)).slice(0, 10);
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = allPets.length === 0
        ? 'No pets near max level.'
        : 'No pets match current filters.';
      empty.style.cssText = 'padding:10px 14px 12px;font-size:12px;color:var(--qpm-text-muted,#555);font-style:italic;';
      container.appendChild(empty);
      return;
    }

    const nearMaxColHeader = document.createElement('div');
    nearMaxColHeader.style.cssText = 'display:flex;align-items:center;gap:8px;padding:2px 14px 4px;border-bottom:1px solid rgba(255,255,255,0.06);';
    const nmchSpacer = document.createElement('div');
    nmchSpacer.style.cssText = 'width:20px;flex-shrink:0;';
    const nmchName = document.createElement('span');
    nmchName.textContent = 'Pet';
    nmchName.style.cssText = 'flex:1;font-size:9px;color:var(--qpm-text-muted,#555);';
    const nmchBar = document.createElement('div');
    nmchBar.style.cssText = 'width:56px;flex-shrink:0;';
    const nmchLvl = document.createElement('span');
    nmchLvl.textContent = 'Level';
    nmchLvl.style.cssText = 'width:44px;text-align:right;font-size:9px;color:var(--qpm-text-muted,#555);flex-shrink:0;';
    const nmchTime = document.createElement('span');
    nmchTime.textContent = 'To max';
    nmchTime.style.cssText = 'min-width:56px;text-align:right;font-size:9px;color:var(--qpm-text-muted,#555);flex-shrink:0;';
    const nmchAction = document.createElement('span');
    nmchAction.textContent = 'Action';
    nmchAction.style.cssText = 'width:58px;text-align:right;font-size:9px;color:var(--qpm-text-muted,#555);flex-shrink:0;';
    nearMaxColHeader.append(nmchSpacer, nmchName, nmchBar, nmchLvl, nmchTime, nmchAction);
    container.appendChild(nearMaxColHeader);

    const list = document.createElement('div');
    list.style.cssText = 'padding:4px 14px 12px;display:flex;flex-direction:column;gap:6px;';
    const sourceIcons = { active: 'A', inventory: 'I', hutch: 'H' } as const;

    for (const pet of filtered) {
      const petKey = getNearMaxPetKey(pet);
      const canSwap = (pet.source === 'inventory' || pet.source === 'hutch') && Boolean(pet.itemId) && hasAnySlot;
      const isExpanded = canSwap && state.nearMaxExpandedPetKey === petKey;
      const isBusy = state.nearMaxBusyPetKey === petKey;
      const hasBusyOperation = state.nearMaxBusyPetKey !== null;

      const rowShell = document.createElement('div');
      rowShell.style.cssText = 'display:flex;flex-direction:column;gap:4px;';

      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;gap:8px;min-width:0;';

      const img = document.createElement('img');
      img.src = getPetSpriteDataUrlWithMutations(pet.species, pet.mutations ?? []) ?? '';
      img.dataset.qpmSprite = `pet:${pet.species}`;
      img.alt = pet.species;
      img.style.cssText = 'width:20px;height:20px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';

      const nameEl = document.createElement('div');
      nameEl.style.cssText = 'flex:1;min-width:0;font-size:12px;color:var(--qpm-text,#ddd);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
      nameEl.textContent = `${sourceIcons[pet.source]} ${pet.name}`;

      const totalXpForRange = pet.xpPerLevel * (pet.maxStr - pet.level);
      const xpDone = totalXpForRange - pet.xpNeeded;
      const pct = Math.max(0, Math.min(100, (xpDone / totalXpForRange) * 100));
      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'width:56px;flex-shrink:0;';
      const track = document.createElement('div');
      track.style.cssText = 'height:5px;background:rgba(255,255,255,0.06);border-radius:3px;overflow:hidden;';
      const fill = document.createElement('div');
      fill.style.cssText = `width:${pct.toFixed(0)}%;height:100%;background:var(--qpm-accent,#4CAF50);border-radius:3px;`;
      track.appendChild(fill);
      barWrap.appendChild(track);

      const lvlEl = document.createElement('div');
      lvlEl.textContent = `${pet.level}->${pet.maxStr}`;
      lvlEl.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#666);font-family:monospace;flex-shrink:0;width:44px;text-align:right;';

      const xpRate = pet.source === 'active' ? state.totalTeamXpPerHour : 3600;
      const minsToMax = xpRate > 0 ? (pet.xpNeeded / xpRate) * 60 : 0;
      const timeEl = document.createElement('div');
      timeEl.textContent = xpRate > 0 ? formatTime(minsToMax) : '--';
      timeEl.style.cssText = 'font-size:11px;color:var(--qpm-warning,#FF9800);font-family:monospace;flex-shrink:0;min-width:56px;text-align:right;';

      const actionWrap = document.createElement('div');
      actionWrap.style.cssText = 'width:58px;display:flex;justify-content:flex-end;flex-shrink:0;';

      if (canSwap) {
        const swapButton = document.createElement('button');
        swapButton.type = 'button';
        swapButton.textContent = isBusy ? 'Swapping...' : 'Swap';
        swapButton.disabled = hasBusyOperation;
        swapButton.style.cssText = [
          'min-height:24px',
          'padding:0 10px',
          'border-radius:999px',
          'border:1px solid rgba(255,255,255,0.2)',
          'font-size:11px',
          `background:${isExpanded ? 'var(--qpm-accent,#4CAF50)' : 'rgba(255,255,255,0.08)'}`,
          `color:${isExpanded ? '#fff' : 'var(--qpm-text,#ddd)'}`,
          `cursor:${hasBusyOperation ? 'not-allowed' : 'pointer'}`,
          `opacity:${hasBusyOperation ? '0.65' : '1'}`,
        ].join(';');
        swapButton.addEventListener('click', () => {
          if (hasBusyOperation) {
            return;
          }
          state.nearMaxExpandedPetKey = isExpanded ? null : petKey;
          void updateNearMaxLevelDisplay(state);
        });
        actionWrap.appendChild(swapButton);
      }

      row.append(img, nameEl, barWrap, lvlEl, timeEl, actionWrap);
      rowShell.appendChild(row);

      if (isExpanded && canSwap) {
        const picker = document.createElement('div');
        picker.style.cssText = 'display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding-left:28px;';

        for (const slot of activeSlots) {
          const targetSlotId = slot.targetSlotId;
          const slotPet = slot.activePet;
          // Empty slots (no targetSlotId) use PlacePet, so they're still clickable.
          const slotDisabled = hasBusyOperation || !pet.itemId;
          const slotButton = document.createElement('button');
          slotButton.type = 'button';
          slotButton.disabled = slotDisabled;
          slotButton.style.cssText = [
            'min-height:44px',
            'display:flex',
            'align-items:center',
            'gap:6px',
            'padding:6px 8px',
            'border-radius:8px',
            `border:1px solid ${slotDisabled ? 'rgba(255,255,255,0.08)' : 'rgba(255,255,255,0.2)'}`,
            `background:${slotDisabled ? 'rgba(255,255,255,0.04)' : 'rgba(255,255,255,0.08)'}`,
            `color:${slotDisabled ? 'var(--qpm-text-muted,#666)' : 'var(--qpm-text,#ddd)'}`,
            `cursor:${slotDisabled ? 'not-allowed' : 'pointer'}`,
          ].join(';');

          const slotNumber = document.createElement('span');
          slotNumber.textContent = String(slot.visualIndex);
          slotNumber.style.cssText = 'font-size:10px;font-family:monospace;min-width:10px;color:var(--qpm-text-muted,#777);';
          slotButton.appendChild(slotNumber);

          if (slotPet?.species) {
            const slotImg = document.createElement('img');
            slotImg.src = getPetSpriteDataUrlWithMutations(slotPet.species, slotPet.mutations ?? []) ?? '';
            slotImg.dataset.qpmSprite = `pet:${slotPet.species}`;
            slotImg.alt = slotPet.species;
            slotImg.style.cssText = 'width:18px;height:18px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';
            slotButton.appendChild(slotImg);
          } else {
            const slotSpacer = document.createElement('span');
            slotSpacer.style.cssText = 'width:18px;height:18px;display:inline-block;flex-shrink:0;';
            slotButton.appendChild(slotSpacer);
          }

          const slotName = document.createElement('span');
          slotName.textContent = (slotPet?.name || slotPet?.species || 'Empty').slice(0, 14);
          slotName.style.cssText = 'font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-align:left;';
          slotButton.appendChild(slotName);

          slotButton.addEventListener('click', async () => {
            if (state.nearMaxBusyPetKey || !pet.itemId) {
              return;
            }

            state.nearMaxBusyPetKey = petKey;
            void updateNearMaxLevelDisplay(state);

            if (pet.source !== 'hutch' && pet.source !== 'inventory') return;

            // Empty slot → PlacePet; occupied slot → SwapPet
            const result = targetSlotId
              ? await swapPetIntoActiveSlot({
                  source: pet.source,
                  itemId: pet.itemId,
                  targetSlotId,
                  storageId: pet.source === 'hutch' ? pet.storageId : null,
                })
              : await placePetIntoActiveSlot({
                  source: pet.source,
                  itemId: pet.itemId,
                  storageId: pet.source === 'hutch' ? pet.storageId : null,
                });

            state.nearMaxBusyPetKey = null;
            if (result.ok) {
              state.nearMaxExpandedPetKey = null;
              setNearMaxStatus(state, petKey, 'Swapped into active slot.', 'success');
            } else {
              state.nearMaxExpandedPetKey = petKey;
              setNearMaxStatus(state, petKey, mapSwapErrorReason(result.reason), 'error');
            }
            void updateNearMaxLevelDisplay(state);
          });

          picker.appendChild(slotButton);
        }

        rowShell.appendChild(picker);
      }

      if (state.nearMaxStatus?.key === petKey) {
        const status = document.createElement('div');
        status.textContent = state.nearMaxStatus.text;
        const tone = state.nearMaxStatus.tone;
        status.style.cssText = [
          'padding-left:28px',
          'font-size:11px',
          `color:${tone === 'success'
            ? 'var(--qpm-positive,#4CAF50)'
            : tone === 'error'
              ? 'var(--qpm-danger,#f44)'
              : 'var(--qpm-text-muted,#777)'}`,
        ].join(';');
        rowShell.appendChild(status);
      }

      list.appendChild(rowShell);
    }

    container.appendChild(list);
  } catch (e) {
    log('Near max update failed', e);
    container.innerHTML = '<div style="padding:12px 14px;color:var(--qpm-danger,#f44);font-size:12px;">Failed to load near max pets</div>';
  }
  state.updateScale?.();
}

// ============================================================================
// CREATE WINDOW
// ============================================================================

export function createXpTrackerWindow(): XpTrackerWindowState {
  const layout = loadLayout();
  const initWidth = Math.max(320, Math.min(layout?.width ?? defaultWidth(), window.innerWidth - 32));
  const initHeight = Math.max(200, Math.min(layout?.height ?? defaultHeight(), window.innerHeight - 48));

  // Restore position ratios (or center)
  currentPct = layout ? { xPct: layout.xPct, yPct: layout.yPct } : { xPct: 0.5, yPct: 0.5 };
  const initPos = layoutPctToPixels(currentPct.xPct, currentPct.yPct, initWidth, initHeight);

  // ── Root window ──
  const root = document.createElement('div');
  root.style.cssText = [
    'position:fixed',
    `top:${initPos.y}px`,
    `left:${initPos.x}px`,
    `width:${initWidth}px`,
    `height:${initHeight}px`,
    'min-width:320px',
    'min-height:200px',
    'max-width:calc(100vw - 16px)',
    'max-height:calc(100vh - 16px)',
    'background:var(--qpm-background,rgba(10,10,10,0.97))',
    'border:1px solid var(--qpm-border,#2a2a2a)',
    'border-radius:8px',
    'box-shadow:0 8px 40px rgba(0,0,0,0.75)',
    'z-index:10002',
    "font-family:'Inter', 'Segoe UI', 'Roboto', 'Helvetica Neue', Arial, 'Apple Color Emoji', 'Segoe UI Emoji', 'Segoe UI Symbol', 'Noto Color Emoji', sans-serif",
    'display:none',
    'flex-direction:column',
    'overflow:hidden',
  ].join(';');

  // ── Title bar (drag handle, always visible) ──
  const titleBar = document.createElement('div');
  titleBar.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:10px',
    'padding:9px 12px',
    'background:var(--qpm-surface-1,#141414)',
    'border-bottom:1px solid var(--qpm-border,#2a2a2a)',
    'cursor:move',
    'flex-shrink:0',
    'user-select:none',
  ].join(';');

  const titleText = document.createElement('span');
  titleText.textContent = '✨ XP Tracker';
  titleText.style.cssText = 'color:var(--qpm-text,#fff);font-size:14px;font-weight:700;flex:1;pointer-events:none;';

  const closeBtn = document.createElement('button');
  closeBtn.innerHTML = '&#x2715;';
  closeBtn.title = 'Close';
  closeBtn.style.cssText = [
    'background:transparent',
    'border:none',
    'color:var(--qpm-text-muted,#777)',
    'font-size:15px',
    'cursor:pointer',
    'padding:0 4px',
    'line-height:1',
    'border-radius:4px',
    'flex-shrink:0',
  ].join(';');
  closeBtn.addEventListener('mouseenter', () => { closeBtn.style.color = '#fff'; });
  closeBtn.addEventListener('mouseleave', () => { closeBtn.style.color = 'var(--qpm-text-muted,#777)'; });
  closeBtn.addEventListener('click', (e) => { e.stopPropagation(); root.style.display = 'none'; });

  titleBar.appendChild(titleText);
  titleBar.appendChild(closeBtn);
  root.appendChild(titleBar);

  // ── Summary strip (XP rate — compact, always visible) ──
  const summaryStrip = document.createElement('div');
  summaryStrip.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:6px',
    'flex-wrap:wrap',
    'padding:6px 14px',
    'background:var(--qpm-surface-1,#111)',
    'border-bottom:1px solid var(--qpm-border,#2a2a2a)',
    'font-size:11px',
    'font-family:monospace',
    'color:var(--qpm-text-muted,#777)',
    'flex-shrink:0',
  ].join(';');
  summaryStrip.textContent = 'Loading…';
  root.appendChild(summaryStrip);

  // ── Scrollable content area ──
  const scrollContent = document.createElement('div');
  scrollContent.style.cssText = [
    'flex:1',
    'overflow-y:auto',
    'overflow-x:hidden',
    'min-height:0',
    'scrollbar-width:thin',
    'scrollbar-color:rgba(255,255,255,0.1) transparent',
  ].join(';');

  // scaleOuter: height-tracking wrapper (transform on scaleWrapper doesn't affect layout)
  const scaleOuter = document.createElement('div');

  // scaleWrapper: scaled via transform so card backgrounds grow/shrink with the window
  const scaleWrapper = document.createElement('div');
  scaleWrapper.style.cssText = 'display:flex;flex-direction:column;';

  // Active pets section
  const activeSec = createCollapsible('🐾 Active Pets', true);
  const petCardsContainer = document.createElement('div');
  petCardsContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px 12px 10px;';

  const loadingCard = document.createElement('div');
  loadingCard.textContent = 'Loading…';
  loadingCard.style.cssText = 'padding:12px;color:var(--qpm-text-muted,#555);font-style:italic;font-size:12px;';
  petCardsContainer.appendChild(loadingCard);

  activeSec.content.appendChild(petCardsContainer);
  scaleWrapper.appendChild(activeSec.wrapper);

  // Near Max Level section (collapsed by default)
  const nearMaxSec = createCollapsible('🏆 Near Max Level', false);
  const nearMaxContainer = document.createElement('div');
  nearMaxSec.content.appendChild(nearMaxContainer);
  scaleWrapper.appendChild(nearMaxSec.wrapper);

  scaleOuter.appendChild(scaleWrapper);
  scrollContent.appendChild(scaleOuter);
  root.appendChild(scrollContent);

  // ── Resize handle (corner grip) ──
  const resizeHandle = document.createElement('div');
  resizeHandle.title = 'Drag to resize';
  resizeHandle.style.cssText = [
    'position:absolute',
    'bottom:0',
    'right:0',
    'width:14px',
    'height:14px',
    'cursor:se-resize',
    'z-index:1',
    'background:linear-gradient(135deg,transparent 50%,rgba(255,255,255,0.12) 50%)',
    'border-radius:0 0 7px 0',
  ].join(';');
  root.appendChild(resizeHandle);

  document.body.appendChild(root);

  // ── State ──
  const state: XpTrackerWindowState = {
    root,
    scrollContent,
    summaryStrip,
    petCardsContainer,
    nearMaxContainer,
    latestPets: [],
    latestStats: [],
    totalTeamXpPerHour: 0,
    lastKnownSpecies: new Set(),
    unsubscribePets: null,
    unsubscribeXpTracker: null,
    resizeListener: null,
    currentWeather: 'unknown',
    updateInterval: null, // unused, kept for API compat
    scaleWrapper,
    scaleOuter,
    updateScale: null,
    resizeObserver: null,
    nearMaxExpandedPetKey: null,
    nearMaxBusyPetKey: null,
    nearMaxStatus: null,
    nearMaxStatusTimer: null,
  };

  // ── Window behaviours ──
  const onLayoutChange = () => { /* drag/resize already save via capturePositionAndSave */ };

  makeDraggable(root, titleBar, onLayoutChange);
  makeResizable(root, resizeHandle, onLayoutChange);

  const resizeListener = () => {
    if (root.style.display !== 'none') applyCurrentPosition(root);
  };
  window.addEventListener('resize', resizeListener);
  state.resizeListener = resizeListener;

  // Content scaling — live update as the user drags the resize handle
  const doUpdateScale = () => updateContentScale(scaleWrapper, scaleOuter, DESIGN_WIDTH);
  state.updateScale = doUpdateScale;
  const scaleObserver = new ResizeObserver(doUpdateScale);
  scaleObserver.observe(root);
  state.resizeObserver = scaleObserver;

  // ── Subscriptions ──
  const throttledPetUpdate = throttle((pets: ActivePetInfo[]) => {
    state.latestPets = pets;
    updateXpTrackerDisplay(state);
  }, 500);
  state.unsubscribePets = onActivePetInfos(throttledPetUpdate);

  // Re-render cards when XP config changes (no new full stats calculation needed)
  state.unsubscribeXpTracker = onXpTrackerUpdate(() => {
    renderPetCards(state);
  });

  // If catalogs weren't ready when the window first rendered, re-populate the near max
  // list once they arrive (getSpeciesXpPerLevel returns null without catalogs, silently
  // skipping every inventory/hutch pet).
  onCatalogsReady(() => { void updateNearMaxLevelDisplay(state); });

  return state;
}

// ============================================================================
// PUBLIC API
// ============================================================================

export function showXpTrackerWindow(state: XpTrackerWindowState): void {
  state.root.style.display = 'flex';
  applyCurrentPosition(state.root);
  updateXpTrackerDisplay(state); // calls state.updateScale?.() internally
}

export function hideXpTrackerWindow(state: XpTrackerWindowState): void {
  state.root.style.display = 'none';
}

export function destroyXpTrackerWindow(state: XpTrackerWindowState): void {
  if (state.updateInterval) state.updateInterval();
  if (state.nearMaxStatusTimer != null) {
    window.clearTimeout(state.nearMaxStatusTimer);
    state.nearMaxStatusTimer = null;
  }
  state.resizeObserver?.disconnect();
  if (state.resizeListener) window.removeEventListener('resize', state.resizeListener);
  state.unsubscribePets?.();
  state.unsubscribeXpTracker?.();
  state.root.remove();
}

/**
 * No-op — kept for API compatibility with originalPanel.ts.
 * Global window callbacks have been replaced with proper event listeners.
 */
export function setGlobalXpTrackerState(_state: XpTrackerWindowState): void {
  // intentionally empty
}
