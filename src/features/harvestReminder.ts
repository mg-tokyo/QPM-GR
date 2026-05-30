// src/features/harvestReminder.ts
// Harvest reminder tuned for Quinoa garden state snapshots.

import { pageWindow, shareGlobal } from '../core/pageContext';
import { log } from '../utils/logger';
import { GardenSnapshot, getGardenSnapshot, onGardenSnapshot } from './gardenBridge';
import { calculatePlantValue, formatCoins } from './economy/valueCalculator';
import { computeMutationMultiplier, normalizeMutationName } from '../utils/cropMultipliers';
import type { MutationMultiplierBreakdown } from '../utils/cropMultipliers';
// Garden highlight overlay removed for performance - functions are no-ops
const updateGardenHighlightOverlay = (_matches: unknown, _snapshot: unknown): boolean => false;
const clearGardenHighlightOverlay = (): void => {};
const disposeGardenHighlightOverlay = (): void => {};
import { lookupMaxScale } from '../utils/plantScales';
import { normalizeSpeciesKey } from '../utils/helpers';
import { onWeatherSnapshot, startWeatherHub, WeatherSnapshot } from '../store/weatherHub';
import { isDebugGlobalsEnabled } from '../utils/debugGlobals';
import { getFriendBonusMultiplier } from '../store/friendBonus';

declare global {
  interface Window {
    highlightTilesByMutation?: (options: Record<string, unknown>) => void;
    removeAllTileOverrides?: () => void;
    queueNotification?: (message: string, persistent?: boolean) => void;
    __qpmHarvestDebugMatches?: HarvestMatch[];
    __qpmHarvestDebugConfig?: Record<string, unknown> | null;
  }
}

export type HarvestMutationKey =
  | 'Rainbow'
  | 'Gold'
  | 'Frozen'
  | 'Wet'
  | 'Chilled'
  | 'Dawnlit'
  | 'Amberlit'
  | 'Amberbound'
  | 'Dawnbound';

export interface HarvestReminderConfig {
  enabled?: boolean;
  highlightEnabled?: boolean;
  toastEnabled?: boolean;
  minSize?: number;
  selectedMutations?: Partial<Record<HarvestMutationKey, boolean>>;
}

export interface HarvestSummary {
  readyCount: number;
  mutatedCount: number;
  totalValue: number;
  highestValue: {
    species: string;
    value: number;
    mutations: string[];
    size: number;
    multiplier: MutationMultiplierBreakdown;
    breakdownText: string;
    totalMultiplierText: string;
    unknownMutations: string[];
  } | null;
  friendBonus: number;
}

interface HarvestMatch {
  key: string;
  tileId: string;
  slotIndex: number;
  species: string;
  mutations: string[];
  size: number;
  value: number;
  multiplier: MutationMultiplierBreakdown;
  unknownMutations: string[];
}

type WeatherState = 'noweather' | 'weather' | 'unknown';

interface HarvestMutationRule {
  label: string;
  highlightNames: readonly string[];
  canonicalNames: readonly string[];
}

const MUTATION_RULES: Record<HarvestMutationKey, HarvestMutationRule> = {
  Rainbow: { label: 'Rainbow', highlightNames: ['Rainbow'], canonicalNames: ['Rainbow'] },
  Gold: { label: 'Gold', highlightNames: ['Gold'], canonicalNames: ['Gold'] },
  Frozen: { label: 'Frozen', highlightNames: ['Frozen'], canonicalNames: ['Frozen'] },
  Wet: { label: 'Wet', highlightNames: ['Wet'], canonicalNames: ['Wet'] },
  Chilled: { label: 'Chilled', highlightNames: ['Chilled'], canonicalNames: ['Chilled'] },
  Dawnlit: { label: 'Dawnlit', highlightNames: ['Dawnlit'], canonicalNames: ['Dawnlit'] },
  Amberlit: {
    label: 'Amberlit',
    highlightNames: ['Amberlit', 'Ambershine'],
    canonicalNames: ['Amberlit', 'Ambershine'],
  },
  Amberbound: {
    label: 'Amberbound',
    highlightNames: ['Amberbound', 'Ambercharged', 'Amber Radiant', 'Amberradiant', 'Amber-radiant'],
    canonicalNames: ['Amberbound', 'Ambercharged'],
  },
  Dawnbound: {
    label: 'Dawnbound (charged)',
    highlightNames: ['Dawnbound', 'Dawncharged'],
    canonicalNames: ['Dawnbound', 'Dawncharged'],
  },
};

const DEFAULT_MIN_SIZE = 80;
const DEFAULT_MUTATIONS: Record<HarvestMutationKey, boolean> = {
  Rainbow: true,
  Gold: false,
  Frozen: false,
  Wet: false,
  Chilled: false,
  Dawnlit: false,
  Amberlit: false,
  Amberbound: false,
  Dawnbound: false,
};

const summaryListeners = new Set<(summary: HarvestSummary) => void>();
const toastListeners = new Set<(text: string) => void>();

interface HarvestReminderState {
  enabled: boolean;
  highlightEnabled: boolean;
  toastEnabled: boolean;
  minSize: number;
  selectedMutations: Record<HarvestMutationKey, boolean>;
}

const state: HarvestReminderState = {
  enabled: false,
  highlightEnabled: true,
  toastEnabled: true,
  minSize: DEFAULT_MIN_SIZE,
  selectedMutations: { ...DEFAULT_MUTATIONS },
};

let initialized = false;
let latestSnapshot: GardenSnapshot | null = null;
let lastHarvestFingerprint = '';
let summary: HarvestSummary = {
  readyCount: 0,
  mutatedCount: 0,
  totalValue: 0,
  highestValue: null,
  friendBonus: getFriendBonusMultiplier(),
};

let snapshotUnsubscribe: (() => void) | null = null;
let weatherUnsubscribe: (() => void) | null = null;
let currentWeather: WeatherState = 'unknown';
let activeMatches: HarvestMatch[] = [];
let announcedKeys = new Set<string>();
let activeHighlightSignature: string | null = null;

export function initializeHarvestReminder(config?: HarvestReminderConfig): void {
  if (initialized) {
    if (config) configureHarvestReminder(config);
    return;
  }

  initialized = true;
  if (config) configureHarvestReminder(config);

  latestSnapshot = getGardenSnapshot();

  snapshotUnsubscribe = onGardenSnapshot((snapshot) => {
    latestSnapshot = snapshot;
    if (!state.enabled) return;
    const fp = getHarvestFingerprint(snapshot);
    if (fp === lastHarvestFingerprint) return;
    lastHarvestFingerprint = fp;
    evaluateSnapshot();
  }, false);

  ensureWeatherSubscription();
  evaluateSnapshot();
  log('🌾 Harvest reminder ready');
}

export function disposeHarvestReminder(): void {
  snapshotUnsubscribe?.();
  snapshotUnsubscribe = null;
  weatherUnsubscribe?.();
  weatherUnsubscribe = null;
  initialized = false;
  latestSnapshot = null;
  lastHarvestFingerprint = '';
  resetCycle();
  disposeGardenHighlightOverlay();
}

export function configureHarvestReminder(config: HarvestReminderConfig): void {
  if (typeof config.enabled === 'boolean') {
    state.enabled = config.enabled;
  }
  if (typeof config.highlightEnabled === 'boolean') {
    state.highlightEnabled = config.highlightEnabled;
    if (!state.highlightEnabled) {
      clearHighlights();
    } else if (activeMatches.length > 0) {
      applyHighlights(activeMatches);
    }
  }
  if (typeof config.toastEnabled === 'boolean') {
    state.toastEnabled = config.toastEnabled;
  }
  if (typeof config.minSize === 'number') {
    state.minSize = Math.min(100, Math.max(50, Math.round(config.minSize)));
  }
  if (config.selectedMutations) {
    for (const key of Object.keys(MUTATION_RULES) as HarvestMutationKey[]) {
      const value = config.selectedMutations[key];
      if (typeof value === 'boolean') {
        state.selectedMutations[key] = value;
      }
    }
  }

  if (state.enabled) {
    ensureWeatherSubscription();
  }

  if (state.enabled) {
    evaluateSnapshot();
  } else {
    resetCycle();
  }
}

export function setHarvestReminderEnabled(enabled: boolean): void {
  state.enabled = enabled;
  if (!enabled) {
    resetCycle();
  } else {
    lastHarvestFingerprint = '';
    ensureWeatherSubscription();
    evaluateSnapshot();
  }
}

export function onHarvestSummary(cb: (summary: HarvestSummary) => void, fireImmediately = true): () => void {
  summaryListeners.add(cb);
  if (fireImmediately) {
    try {
      cb(summary);
    } catch (error) {
      log('⚠️ Harvest summary listener error', error);
    }
  }
  return () => {
    summaryListeners.delete(cb);
  };
}

export function onHarvestToast(cb: (text: string) => void): () => void {
  toastListeners.add(cb);
  return () => {
    toastListeners.delete(cb);
  };
}

export function getHarvestSummary(): HarvestSummary {
  return summary;
}

export function runHarvestHighlightDebug(): void {
  if (!state.enabled) {
    log('🧪 Harvest highlight test skipped (reminder disabled)');
    return;
  }

  const snapshot = latestSnapshot ?? getGardenSnapshot();
  if (!snapshot || !snapshot.tileObjects) {
    setSummary([]);
    resetHighlights();
    log('🧪 Harvest highlight test found no tiles to evaluate');
    return;
  }

  const matches = collectMatches(snapshot, activeMutationKeys(), Date.now());
  if (isDebugGlobalsEnabled()) {
    shareGlobal('__qpmHarvestDebugMatches', matches);
  }
  if (matches.length > 0) {
    const preview = matches.slice(0, Math.min(5, matches.length)).map((match) => ({
      species: match.species,
      mutations: [...match.mutations],
      size: match.size,
    }));
    log('🧪 Harvest debug sample', preview);
  } else {
    log('🧪 Harvest debug found no matching crops');
  }
  setSummary(matches);
  activeHighlightSignature = null;
  applyHighlights(matches);
  log(`🧪 Harvest highlight test applied (${matches.length} matches)`);
}

function notifySummaryListeners(): void {
  for (const listener of summaryListeners) {
    try {
      listener(summary);
    } catch (error) {
      log('⚠️ Harvest summary listener error', error);
    }
  }
}

function ensureWeatherSubscription(): void {
  startWeatherHub();
  if (weatherUnsubscribe) return;

  weatherUnsubscribe = onWeatherSnapshot(handleWeatherSnapshot, true);
}

function handleWeatherSnapshot(snapshot: WeatherSnapshot): void {
  const nextState = deriveWeatherState(snapshot);
  if (nextState === currentWeather) return;

  currentWeather = nextState;
  if (currentWeather === 'noweather') {
    announcedKeys.clear();
  }

  if (state.enabled) {
    evaluateSnapshot();
  } else if (currentWeather !== 'noweather') {
    clearHighlights();
  }
}

function deriveWeatherState(snapshot: WeatherSnapshot): WeatherState {
  if (snapshot.raw === 'weather') return 'weather';
  if (snapshot.raw === 'noweather') return 'noweather';
  return 'unknown';
}

function evaluateSnapshot(): void {
  if (!state.enabled) return;

  const snapshot = latestSnapshot ?? getGardenSnapshot();
  if (!snapshot || !snapshot.tileObjects) {
    setSummary([]);
    resetHighlights();
    return;
  }

  const matches = collectMatches(snapshot, activeMutationKeys(), Date.now());

  setSummary(matches);
  applyHighlights(matches);
  announceNewMatches(matches);
}

function activeMutationKeys(): HarvestMutationKey[] {
  return (Object.keys(MUTATION_RULES) as HarvestMutationKey[]).filter((key) => state.selectedMutations[key]);
}

function matchesSelectedMutations(mutations: string[], required: HarvestMutationKey[]): boolean {
  if (required.length === 0) return true;
  if (!mutations || mutations.length === 0) return false;

  const canonicalMutations = new Set<string>();
  for (const mutation of mutations) {
    const canonical = normalizeMutationName(mutation);
    if (canonical) {
      canonicalMutations.add(canonical);
    }
  }

  if (canonicalMutations.size === 0) {
    return false;
  }

  return required.some((key) => MUTATION_RULES[key].canonicalNames.some((name) => canonicalMutations.has(name)));
}

// Cheap fingerprint: plant-tile count + number of mature slots (endTime <= now).
// Changes when tiles are added/removed or when a plant ripens.
function getHarvestFingerprint(snapshot: GardenSnapshot | null): string {
  if (!snapshot?.tileObjects) return '';
  let tileCount = 0;
  let matureCount = 0;
  const now = Date.now();
  for (const rawTile of Object.values(snapshot.tileObjects)) {
    if (!rawTile || typeof rawTile !== 'object') continue;
    const tile = rawTile as Record<string, unknown>;
    if (tile.objectType !== 'plant') continue;
    tileCount++;
    const slots = Array.isArray(tile.slots) ? (tile.slots as Record<string, unknown>[]) : [];
    for (const slot of slots) {
      const endTimeRaw = slot?.endTime ?? slot?.readyAt ?? slot?.harvestReadyAt;
      const endTime = typeof endTimeRaw === 'number' ? endTimeRaw : Number(endTimeRaw);
      if (Number.isFinite(endTime) && endTime <= now) matureCount++;
    }
  }
  return `${tileCount}:${matureCount}`;
}

function collectMatches(snapshot: GardenSnapshot | null, required: HarvestMutationKey[], now: number): HarvestMatch[] {
  const matches: HarvestMatch[] = [];

  if (!snapshot || !snapshot.tileObjects) {
    return matches;
  }

  for (const [tileId, rawTile] of Object.entries(snapshot.tileObjects)) {
    if (!rawTile || typeof rawTile !== 'object') continue;
    const tile = rawTile as Record<string, unknown>;
    if (tile.objectType !== 'plant') continue;

    const slots = Array.isArray(tile.slots) ? (tile.slots as Record<string, unknown>[]) : [];
    slots.forEach((slot, slotIndex) => {
      const species = typeof slot?.species === 'string' ? slot.species : null;
      if (!species) return;

      const endTimeRaw = slot?.endTime ?? slot?.readyAt ?? slot?.harvestReadyAt;
      const endTime = typeof endTimeRaw === 'number' ? endTimeRaw : Number(endTimeRaw);
      if (!Number.isFinite(endTime) || endTime > now) return;

      const mutationsRaw = Array.isArray(slot?.mutations) ? slot.mutations : [];
      const mutations = (mutationsRaw as unknown[]).filter((value): value is string => typeof value === 'string');
      if (!matchesSelectedMutations(mutations, required)) return;

      const scaleRaw = slot?.targetScale;
      const scale = typeof scaleRaw === 'number' && Number.isFinite(scaleRaw) ? scaleRaw : 1;
      const size = convertScaleToSize(scale, species, slot);
      if (size < state.minSize) return;

      const multiplier = computeMutationMultiplier(mutations);
      const unknownMutations = mutations.filter((mutation) => !normalizeMutationName(mutation));

      const value = calculatePlantValue(species, scale, mutations, getFriendBonusMultiplier());
      const key = `${tileId}:${slotIndex}`;

      matches.push({ key, tileId, slotIndex, species, mutations, size, value, multiplier, unknownMutations });
    });
  }

  matches.sort((a, b) => b.value - a.value);
  return matches;
}

function convertScaleToSize(scale: number, species: string, slot?: Record<string, unknown>): number {
  const MIN_SCALE = 1;
  const MIN_PERCENT = 50;
  const MAX_PERCENT = 100;
  const FALLBACK_MAX_SCALE = 2;

  const safeScale = Number.isFinite(scale) && scale > 0 ? scale : MIN_SCALE;

  let maxScale: number | null = null;
  if (slot && typeof slot === 'object') {
    const rawMax = Number((slot as Record<string, unknown>).maxScale);
    if (Number.isFinite(rawMax) && rawMax > MIN_SCALE) {
      maxScale = rawMax;
    }
  }

  if (typeof maxScale !== 'number' || !Number.isFinite(maxScale) || maxScale <= MIN_SCALE) {
    const normalized = normalizeSpeciesKey(species);
    const lookup = normalized ? lookupMaxScale(normalized) : null;
    maxScale = lookup ?? FALLBACK_MAX_SCALE;
  }

  const cappedMax = Math.max(MIN_SCALE + 0.01, maxScale);
  const clamped = Math.min(cappedMax, Math.max(MIN_SCALE, safeScale));
  const ratio = cappedMax > MIN_SCALE ? (clamped - MIN_SCALE) / (cappedMax - MIN_SCALE) : 0;
  const percent = MIN_PERCENT + ratio * (MAX_PERCENT - MIN_PERCENT);
  return Math.round(percent);
}

function setSummary(matches: HarvestMatch[]): void {
  activeMatches = matches;
  if (matches.length === 0) {
    summary = {
      readyCount: 0,
      mutatedCount: 0,
      totalValue: 0,
      highestValue: null,
      friendBonus: getFriendBonusMultiplier(),
    };
  } else {
    const top = matches[0]!;
    summary = {
      readyCount: matches.length,
      mutatedCount: matches.filter((match) => match.mutations.length > 0).length,
      totalValue: matches.reduce((sum, match) => sum + match.value, 0),
      highestValue: {
        species: top.species,
        value: top.value,
        mutations: top.mutations,
        size: top.size,
        multiplier: top.multiplier,
        breakdownText: describeMutationBreakdown(top.multiplier, top.unknownMutations),
        totalMultiplierText: formatMultiplierValue(top.multiplier.totalMultiplier),
        unknownMutations: top.unknownMutations,
      },
      friendBonus: getFriendBonusMultiplier(),
    };
  }
  notifySummaryListeners();
}

function applyHighlights(matches: HarvestMatch[]): void {
  if (!state.highlightEnabled) {
    resetHighlights();
    return;
  }

  const signature = matches.map((match) => match.key).join('|');
  if (signature === activeHighlightSignature) return;
  activeHighlightSignature = signature;

  if (matches.length === 0) {
    resetHighlights();
    return;
  }

  updateGardenHighlightOverlay(matches, latestSnapshot);

  try {
    const highlightFn = (pageWindow as typeof window).highlightTilesByMutation;
    if (typeof highlightFn !== 'function') return;

    try {
      const removeFn = (pageWindow as typeof window).removeAllTileOverrides;
      if (typeof removeFn === 'function') {
        removeFn.call(pageWindow);
      }
    } catch (error) {
      log('⚠️ Failed to clear previous highlights', error);
    }

    const species = Array.from(new Set(matches.map((match) => match.species)));
    const mutationFilter = buildHighlightMutationList();
    const highlightMutations = species.map(() => (mutationFilter.length > 0 ? mutationFilter[0]! : null));

    const config = {
      highlightSpecies: species,
      highlightMutations,
      slotIndex: 0,
      highlightScale: null,
      hiddenSpecies: 'Carrot',
      hiddenScale: 0.1,
    } satisfies Record<string, unknown>;
    if (isDebugGlobalsEnabled()) {
      shareGlobal('__qpmHarvestDebugConfig', {
        ...config,
        attemptedMutations: mutationFilter,
      });
    }
    highlightFn.call(pageWindow, config);

    const setTimeoutFn = (pageWindow as typeof window).setTimeout;
    setTimeoutFn?.call(pageWindow, () => {
      try {
        (pageWindow as typeof window).dispatchEvent?.(new Event('visibilitychange'));
      } catch (error) {
        log('⚠️ Failed to nudge render after highlight', error);
      }
    }, 120);
  } catch (error) {
    log('⚠️ Failed to apply harvest highlight', error);
  }
}

function buildHighlightMutationList(): string[] {
  const result: string[] = [];
  for (const key of activeMutationKeys()) {
    result.push(...MUTATION_RULES[key].highlightNames);
  }
  return Array.from(new Set(result));
}

function resetHighlights(): void {
  activeHighlightSignature = null;
  clearHighlights();
}

function clearHighlights(): void {
  try {
    const removeFn = (pageWindow as typeof window).removeAllTileOverrides;
    if (typeof removeFn === 'function') {
      removeFn.call(pageWindow);
    }
  } catch (error) {
    log('⚠️ Unable to clear harvest highlights', error);
  }
  clearGardenHighlightOverlay();
}

function announceNewMatches(matches: HarvestMatch[]): void {
  if (!state.toastEnabled) return;
  if (matches.length === 0) return;

  const freshMatches = matches.filter((match) => !announcedKeys.has(match.key));
  if (freshMatches.length === 0) return;

  for (const match of freshMatches) {
    announcedKeys.add(match.key);
  }

  const top = freshMatches[0]!;
  const message = formatHarvestToast(top);

  for (const listener of toastListeners) {
    try {
      listener(message);
    } catch (error) {
      log('⚠️ Harvest toast listener error', error);
    }
  }

  try {
    window.queueNotification?.(message, false);
  } catch (error) {
    log('⚠️ Failed to queue harvest notification', error);
  }
}

function formatHarvestToast(match: HarvestMatch): string {
  const { species, size, value, multiplier, mutations, unknownMutations } = match;
  const breakdownText = describeMutationBreakdown(multiplier, unknownMutations);
  const totalText = formatMultiplierValue(multiplier.totalMultiplier);
  const mutationLabel = mutations.length ? breakdownText : 'No bonus mutations';
  return `🌾 ${species} — ${mutationLabel} → total x${totalText} • size ${size} (~${formatCoins(value)} coins)`;
}

function describeMutationBreakdown(
  breakdown: MutationMultiplierBreakdown,
  unknownMutations: readonly string[],
): string {
  const parts: string[] = [];

  if (breakdown.color) {
    parts.push(`${breakdown.color.definition.name} x${formatMultiplierValue(breakdown.color.definition.multiplier)}`);
  }

  if (breakdown.combo) {
    parts.push(
      `${breakdown.combo.weather.name} + ${breakdown.combo.time.name} combo x${formatMultiplierValue(breakdown.combo.multiplier)}`,
    );
  } else {
    if (breakdown.weather) {
      parts.push(`${breakdown.weather.definition.name} x${formatMultiplierValue(breakdown.weather.definition.multiplier)}`);
    }
    if (breakdown.time) {
      parts.push(`${breakdown.time.definition.name} x${formatMultiplierValue(breakdown.time.definition.multiplier)}`);
    }
  }

  if (!parts.length && breakdown.totalMultiplier === 1) {
    parts.push('No bonus mutations');
  }

  if (unknownMutations.length) {
    const label = unknownMutations.length === 1 ? '1 unrecognized mutation' : `${unknownMutations.length} unrecognized mutations`;
    parts.push(label);
  }

  return parts.join(' + ');
}

function formatMultiplierValue(value: number): string {
  return Number.isInteger(value) ? value.toString() : value.toFixed(2);
}

function resetCycle(): void {
  activeMatches = [];
  announcedKeys.clear();
  summary = {
    readyCount: 0,
    mutatedCount: 0,
    totalValue: 0,
    highestValue: null,
    friendBonus: getFriendBonusMultiplier(),
  };
  notifySummaryListeners();
  resetHighlights();
}
