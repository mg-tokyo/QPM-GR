// src/features/turtleTimer.ts
// Estimate garden growth completion time with active turtle abilities.

import { log } from '../../utils/logger';
import { storage } from '../../utils/storage';
import { GardenSnapshot, GardenState, getGardenSnapshot, onGardenSnapshot } from '../garden/bridge';
import { ActivePetInfo, getActivePetInfos, onActivePetInfos, startPetInfoStore } from '../../store/pets';
import { pageWindow } from '../../core/pageContext';
import { getAbilityDefinition, computeAbilityStats, type AbilityDefinition } from './data/petAbilities';

declare global {
  interface Window {
    debugEggDetection?: () => void;
  }
}

// Manual override system for pet ability values
export interface PetManualOverride {
  xp?: number | null;
  targetScale?: number | null;
  strength?: number | null;
}

interface ManualOverridesStorage {
  [petKey: string]: PetManualOverride;
}

const MANUAL_OVERRIDES_STORAGE_KEY = 'qpm-turtle-manual-overrides';
let manualOverrides: ManualOverridesStorage = {};

function loadManualOverrides(): void {
  try {
    const stored = storage.get<ManualOverridesStorage | null>(MANUAL_OVERRIDES_STORAGE_KEY, null);
    if (stored && typeof stored === 'object') {
      manualOverrides = stored;
    }
  } catch (error) {
    log('⚠️ Failed to load manual pet overrides', error);
  }
}

function saveManualOverrides(): void {
  try {
    storage.set(MANUAL_OVERRIDES_STORAGE_KEY, manualOverrides);
  } catch (error) {
    log('⚠️ Failed to save manual pet overrides', error);
  }
}

function getPetKey(pet: ActivePetInfo): string {
  // Use petId if available, fallback to species + slot index
  if (pet.petId) return `pet:${pet.petId}`;
  if (pet.species) return `${pet.species}:${pet.slotIndex}`;
  return `slot:${pet.slotIndex}`;
}

export function getManualOverride(pet: ActivePetInfo): PetManualOverride | null {
  const key = getPetKey(pet);
  return manualOverrides[key] ?? null;
}

export function setManualOverride(pet: ActivePetInfo, override: PetManualOverride): void {
  const key = getPetKey(pet);
  if (!manualOverrides[key]) {
    manualOverrides[key] = {};
  }
  Object.assign(manualOverrides[key]!, override);
  saveManualOverrides();
  // Trigger recalculation
  recalculateTimerState();
}

export function clearManualOverride(pet: ActivePetInfo, field?: 'xp' | 'targetScale' | 'strength'): void {
  const key = getPetKey(pet);
  if (!manualOverrides[key]) return;

  if (field) {
    delete manualOverrides[key]![field];
    // If no fields left, remove the whole entry
    if (Object.keys(manualOverrides[key]!).length === 0) {
      delete manualOverrides[key];
    }
  } else {
    delete manualOverrides[key];
  }

  saveManualOverrides();
  // Trigger recalculation
  recalculateTimerState();
}

export type TurtleTimerStatus = 'disabled' | 'no-data' | 'no-crops' | 'no-eggs' | 'no-turtles' | 'estimating';

export type TurtleTimerFocus = 'latest' | 'earliest' | 'specific';

type TurtleAbilityKind = 'plant' | 'egg';

type TurtleSupportKind = 'restore' | 'slow';

export interface TurtleTimerConfig {
  enabled?: boolean;
  includeBoardwalk?: boolean;
  minActiveHungerPct?: number;
  fallbackTargetScale?: number;
  focus?: TurtleTimerFocus;
  focusTargetTileId?: string | null;
  focusTargetSlotIndex?: number | null;
  eggFocus?: TurtleTimerFocus;
  eggFocusTargetTileId?: string | null;
  eggFocusTargetSlotIndex?: number | null;
}

interface TurtleResolvedConfig {
  enabled: boolean;
  includeBoardwalk: boolean;
  minActiveHungerPct: number;
  fallbackTargetScale: number;
  focus: TurtleTimerFocus;
  maxTargetScale: number;
  focusTargetTileId: string | null;
  focusTargetSlotIndex: number | null;
  eggFocus: TurtleTimerFocus;
  eggFocusTargetTileId: string | null;
  eggFocusTargetSlotIndex: number | null;
}

const GROWTH_ABILITY_PATTERNS = [
  { kind: 'plant' as const, patterns: ['plantgrowthboost'] },
  { kind: 'egg' as const, patterns: ['egggrowthboost'] },
] as const;

interface ResolvedGrowthAbility {
  kind: 'plant' | 'egg';
  abilityId: string;
  baseProbability: number;
  effectMinutesPerProc: number;
}

function resolveGrowthAbility(rawAbility: string, normalizedAbility: string): ResolvedGrowthAbility | null {
  let matchedKind: 'plant' | 'egg' | null = null;
  for (const group of GROWTH_ABILITY_PATTERNS) {
    if (group.patterns.some((pattern) => normalizedAbility.includes(pattern))) {
      matchedKind = group.kind;
      break;
    }
  }
  if (!matchedKind) return null;

  const def = getAbilityDefinition(rawAbility);
  if (!def) return null;

  const baseProbability = def.baseProbability ?? 0;
  const effectMinutesPerProc = def.effectValuePerProc ?? 0;
  if (baseProbability <= 0 || effectMinutesPerProc <= 0) return null;

  return {
    kind: matchedKind,
    abilityId: def.id,
    baseProbability,
    effectMinutesPerProc,
  };
}

const SUPPORT_PATTERNS: Record<TurtleSupportKind, readonly string[]> = {
  restore: ['hungerrestore'],
  slow: ['hungerboost'],
};

const RESTORE_PCT_BY_LEVEL = [0, 30, 35, 40, 45];
const RESTORE_PROC_ODDS_BY_LEVEL = [0, 0.12, 0.14, 0.16, 0.18];
const SLOW_PCT_BY_LEVEL = [0, 12, 16, 20, 24];

function parseAbilityLevel(rawAbility: string, normalizedAbility: string): number {
  const numeralMatch = rawAbility.match(/\b(IV|III|II|I)\b/i);
  if (numeralMatch) {
    const token = numeralMatch[1]!.toUpperCase();
    switch (token) {
      case 'I':
        return 1;
      case 'II':
        return 2;
      case 'III':
        return 3;
      case 'IV':
        return 4;
      default:
        break;
    }
  }

  const digitMatch = rawAbility.match(/\b(\d+)\b/);
  if (digitMatch) {
    const parsed = Number.parseInt(digitMatch[1]!, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  if (normalizedAbility.endsWith('iv')) return 4;
  if (normalizedAbility.endsWith('iii')) return 3;
  if (normalizedAbility.endsWith('ii')) return 2;
  return 1;
}

function resolveSupportEffect(
  kind: TurtleSupportKind,
  rawAbility: string,
  normalizedAbility: string,
): { effectPct: number; procOdds: number | null } | null {
  const level = parseAbilityLevel(rawAbility, normalizedAbility);
  if (kind === 'restore') {
    const effectPct = RESTORE_PCT_BY_LEVEL[Math.min(level, RESTORE_PCT_BY_LEVEL.length - 1)] ?? RESTORE_PCT_BY_LEVEL[1]!;
    const procOdds = RESTORE_PROC_ODDS_BY_LEVEL[Math.min(level, RESTORE_PROC_ODDS_BY_LEVEL.length - 1)] ?? RESTORE_PROC_ODDS_BY_LEVEL[1]!;
    return { effectPct, procOdds };
  }

  if (kind === 'slow') {
    const effectPct = SLOW_PCT_BY_LEVEL[Math.min(level, SLOW_PCT_BY_LEVEL.length - 1)] ?? SLOW_PCT_BY_LEVEL[1]!;
    return { effectPct, procOdds: null };
  }

  return null;
}

function computeSupportProcPerMinute(baseScore: number, baseProcOdds: number | null): number {
  if (!baseProcOdds || baseProcOdds <= 0 || baseScore <= 0) {
    return 0;
  }
  const adjustedOdds = Math.min(0.95, Math.max(0, baseProcOdds * (baseScore / 100)));
  const perSecondChance = 1 - Math.pow(1 - adjustedOdds, 1 / 60);
  return perSecondChance * 60;
}

export interface GardenSlotEstimate {
  tileId: string;
  slotIndex: number;
  species: string | null;
  seedSpecies: string | null;
  plantSpecies: string | null;
  eggId: string | null;
  eggSpecies: string | null;
  boardwalk: boolean;
  endTime: number | null;
  readyAt: number | null;
  plantedAt: number | null;
  slotType: string | null;
  slotCategory: string | null;
  objectType: string | null;
  tileObjectType: string | null;
  tileCategory: string | null;
  slotKind: string | null;
}

export interface TurtleContribution {
  ability: TurtleAbilityKind;
  abilityNames: string[];
  slotIndex: number;
  name: string | null;
  species: string | null;
  mutations: string[];
  hungerPct: number | null;
  xp: number | null;
  targetScale: number;
  baseScore: number;
  rateContribution: number;
  perHourReduction: number;
  reductionPerProc: number;
  missingStats: boolean;
}

interface SupportAbilityBreakdown {
  abilityName: string;
  normalizedName: string;
  perTriggerPct: number | null;
  slowdownPct: number | null;
  triggersPerHour: number | null;
  pctPerHour: number | null;
  probabilityPerMinute: number | null;
}

export interface TurtleSupportEntry {
  type: TurtleSupportKind;
  abilityNames: string[];
  slotIndex: number;
  name: string | null;
  species: string | null;
  hungerPct: number | null;
  active: boolean;
  xp: number | null;
  targetScale: number;
  baseScore: number;
  missingStats: boolean;
  abilityDetails: SupportAbilityBreakdown[];
  totalRestorePerTriggerPct: number;
  totalRestorePerHourPct: number;
  totalTriggersPerHour: number;
  totalSlowPct: number;
}

export interface TurtleTimerChannel {
  status: TurtleTimerStatus;
  trackedSlots: number;
  growingSlots: number;
  maturedSlots: number;
  contributions: TurtleContribution[];
  expectedMinutesRemoved: number | null;
  effectiveRate: number | null;
  naturalMsRemaining: number | null;
  adjustedMsRemaining: number | null;
  minutesSaved: number | null;
  focusSlot: (GardenSlotEstimate & { remainingMs: number | null }) | null;
}

export interface TurtleFocusOption {
  key: string;
  tileId: string;
  slotIndex: number;
  species: string | null;
  boardwalk: boolean;
  endTime: number | null;
  remainingMs: number | null;
}

export interface TurtleTimerSupportSummary {
  restoreCount: number;
  restoreActiveCount: number;
  slowCount: number;
  slowActiveCount: number;
  restorePctTotal: number;
  restorePctActive: number;
  restorePctPerHourTotal: number;
  restorePctPerHourActive: number;
  restoreTriggersPerHourTotal: number;
  restoreTriggersPerHourActive: number;
  slowPctTotal: number;
  slowPctActive: number;
  entries: TurtleSupportEntry[];
}

export interface TurtleTimerState {
  enabled: boolean;
  now: number;
  includeBoardwalk: boolean;
  focus: TurtleTimerFocus;
  focusTargetKey: string | null;
  focusTargetAvailable: boolean;
  eggFocus: TurtleTimerFocus;
  eggFocusTargetKey: string | null;
  eggFocusTargetAvailable: boolean;
  minActiveHungerPct: number;
  fallbackTargetScale: number;
  availableTurtles: number;
  hungerFilteredCount: number;
  turtlesMissingStats: number;
  plant: TurtleTimerChannel;
  plantTargets: TurtleFocusOption[];
  egg: TurtleTimerChannel;
  eggTargets: TurtleFocusOption[];
  support: TurtleTimerSupportSummary;
}

// Completion log tracking system
export interface CompletionLogEntry {
  id: string;
  type: 'plant' | 'egg';
  species: string;
  tileId: string;
  slotIndex: number;
  startedAt: number;
  completedAt: number;
  estimatedDuration: number;
  actualDuration: number;
  hadTurtles: boolean;
}

const COMPLETION_LOG_KEY = 'qpm-turtle-completion-log';
const MAX_LOG_ENTRIES = 50;
let completionLog: CompletionLogEntry[] = [];
const trackedSlots = new Map<string, { startedAt: number; estimatedDuration: number; type: 'plant' | 'egg'; species: string }>();

function loadCompletionLog(): void {
  try {
    const stored = storage.get<CompletionLogEntry[] | null>(COMPLETION_LOG_KEY, null);
    if (Array.isArray(stored)) {
      completionLog = stored.slice(-MAX_LOG_ENTRIES);
    }
  } catch (error) {
    log('⚠️ Failed to load completion log', error);
  }
}

function saveCompletionLog(): void {
  try {
    storage.set(COMPLETION_LOG_KEY, completionLog.slice(-MAX_LOG_ENTRIES));
  } catch (error) {
    log('⚠️ Failed to save completion log', error);
  }
}

export function getCompletionLog(): CompletionLogEntry[] {
  return [...completionLog];
}

export function clearCompletionLog(): void {
  completionLog = [];
  trackedSlots.clear();
  saveCompletionLog();
}

function trackSlotStart(tileId: string, slotIndex: number, type: 'plant' | 'egg', species: string, estimatedMs: number): void {
  const key = `${tileId}:${slotIndex}`;
  trackedSlots.set(key, {
    startedAt: Date.now(),
    estimatedDuration: estimatedMs,
    type,
    species,
  });
}

function trackSlotCompletion(tileId: string, slotIndex: number, hadTurtles: boolean): void {
  const key = `${tileId}:${slotIndex}`;
  const tracked = trackedSlots.get(key);
  if (!tracked) return;

  const completedAt = Date.now();
  const actualDuration = completedAt - tracked.startedAt;

  const entry: CompletionLogEntry = {
    id: `${tileId}:${slotIndex}:${completedAt}`,
    type: tracked.type,
    species: tracked.species,
    tileId,
    slotIndex,
    startedAt: tracked.startedAt,
    completedAt,
    estimatedDuration: tracked.estimatedDuration,
    actualDuration,
    hadTurtles,
  };

  completionLog.push(entry);
  if (completionLog.length > MAX_LOG_ENTRIES) {
    completionLog = completionLog.slice(-MAX_LOG_ENTRIES);
  }
  saveCompletionLog();
  trackedSlots.delete(key);
}

function isEggSpecies(species: string | null): boolean {
  if (!species) {
    return false;
  }
  const lower = species.toLowerCase();
  if (lower.includes('eggplant')) {
    return false;
  }
  return /\begg\b/.test(lower);
}

function includesEggHint(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const lower = value.toLowerCase();
  if (lower.includes('eggplant')) {
    return false;
  }
  return lower.includes('egg');
}

function includesPlantHint(value: string | null): boolean {
  if (!value) {
    return false;
  }
  const lower = value.toLowerCase();
  return lower.includes('plant') || lower.includes('crop');
}

function isEggSlot(slot: GardenSlotEstimate): boolean {
  if (includesEggHint(slot.objectType)) {
    return true;
  }
  if (includesEggHint(slot.slotType)) {
    return true;
  }
  if (includesEggHint(slot.slotCategory)) {
    return true;
  }
  if (includesEggHint(slot.slotKind)) {
    return true;
  }
  if (includesEggHint(slot.tileObjectType)) {
    return true;
  }
  if (includesEggHint(slot.tileCategory)) {
    return true;
  }
  if (includesEggHint(slot.seedSpecies)) {
    return true;
  }
  if (includesEggHint(slot.plantSpecies)) {
    return true;
  }
  if (includesEggHint(slot.eggId)) {
    return true;
  }
  if (includesEggHint(slot.eggSpecies)) {
    return true;
  }
  return isEggSpecies(slot.species);
}

const FOCUS_KEY_SEPARATOR = '::';

const DEFAULT_CONFIG: TurtleResolvedConfig = {
  enabled: true,
  includeBoardwalk: true,
  minActiveHungerPct: 2,
  fallbackTargetScale: 1.5,
  focus: 'latest',
  maxTargetScale: 2.5,
  focusTargetTileId: null,
  focusTargetSlotIndex: null,
  eggFocus: 'latest',
  eggFocusTargetTileId: null,
  eggFocusTargetSlotIndex: null,
};

let config: TurtleResolvedConfig = { ...DEFAULT_CONFIG };
let initialized = false;
let gardenUnsubscribe: (() => void) | null = null;
let petUnsubscribe: (() => void) | null = null;
let latestGarden: GardenSnapshot = getGardenSnapshot();
let latestPets: ActivePetInfo[] = getActivePetInfos();
let lastTurtleGardenFingerprint = '';

const listeners = new Set<(state: TurtleTimerState) => void>();

function normalizeAbility(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function createEmptyChannel(status: TurtleTimerStatus = 'no-data'): TurtleTimerChannel {
  return {
    status,
    trackedSlots: 0,
    growingSlots: 0,
    maturedSlots: 0,
    contributions: [],
    expectedMinutesRemoved: null,
    effectiveRate: null,
    naturalMsRemaining: null,
    adjustedMsRemaining: null,
    minutesSaved: null,
    focusSlot: null,
  };
}

function createInitialState(): TurtleTimerState {
  return {
    enabled: config.enabled,
    now: Date.now(),
    includeBoardwalk: config.includeBoardwalk,
    focus: config.focus,
    focusTargetKey: null,
    focusTargetAvailable: false,
    eggFocus: config.eggFocus,
    eggFocusTargetKey: null,
    eggFocusTargetAvailable: false,
    minActiveHungerPct: config.minActiveHungerPct,
    fallbackTargetScale: config.fallbackTargetScale,
    availableTurtles: 0,
    hungerFilteredCount: 0,
    turtlesMissingStats: 0,
    plant: createEmptyChannel(),
    plantTargets: [],
    egg: createEmptyChannel(),
    eggTargets: [],
    support: {
      restoreCount: 0,
      restoreActiveCount: 0,
      slowCount: 0,
      slowActiveCount: 0,
      restorePctTotal: 0,
      restorePctActive: 0,
      restorePctPerHourTotal: 0,
      restorePctPerHourActive: 0,
      restoreTriggersPerHourTotal: 0,
      restoreTriggersPerHourActive: 0,
      slowPctTotal: 0,
      slowPctActive: 0,
      entries: [],
    },
  };
}

function makeFocusKey(tileId: string | null, slotIndex: number | null): string | null {
  if (!tileId || slotIndex == null) {
    return null;
  }
  return `${tileId}${FOCUS_KEY_SEPARATOR}${slotIndex}`;
}

let state: TurtleTimerState = createInitialState();

function parseTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

// Cheap fingerprint: slot count + sum of endTimes from raw snapshot data.
// Detects plant additions/removals and endTime changes without running full collectSlots+recompute.
function getTurtleGardenFingerprint(snapshot: GardenSnapshot): string {
  if (!snapshot?.tileObjects) return '';
  let slotCount = 0;
  let endTimeSum = 0;
  for (const rawTile of Object.values(snapshot.tileObjects)) {
    if (!rawTile || typeof rawTile !== 'object') continue;
    const tile = rawTile as Record<string, unknown>;
    const slots = Array.isArray(tile.slots) ? (tile.slots as Record<string, unknown>[]) : [];
    for (const slot of slots) {
      const endTime = typeof slot?.endTime === 'number' ? slot.endTime : 0;
      slotCount++;
      endTimeSum += endTime;
    }
  }
  return `${slotCount}:${endTimeSum}`;
}

function collectSlots(snapshot: GardenSnapshot, includeBoardwalk: boolean): GardenSlotEstimate[] {
  const results: GardenSlotEstimate[] = [];
  if (!snapshot) {
    return results;
  }

  const pickString = (source: Record<string, unknown>, keys: readonly string[]): string | null => {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim().length > 0) {
        return value;
      }
    }
    return null;
  };

  const readIndex = (value: unknown, fallback: number): number => {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }
    if (typeof value === 'string') {
      const parsed = Number(value);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  };

  const shouldIncludeRecord = (slot: GardenSlotEstimate): boolean => {
    if (includesPlantHint(slot.objectType) || includesPlantHint(slot.tileObjectType)) {
      return true;
    }
    if (includesPlantHint(slot.slotType) || includesPlantHint(slot.slotCategory) || includesPlantHint(slot.tileCategory)) {
      return true;
    }
    if (includesEggHint(slot.objectType) || includesEggHint(slot.slotType) || includesEggHint(slot.slotCategory)) {
      return true;
    }
    if (includesEggHint(slot.slotKind) || includesEggHint(slot.tileObjectType) || includesEggHint(slot.tileCategory)) {
      return true;
    }
    if (includesEggHint(slot.species) || includesEggHint(slot.seedSpecies) || includesEggHint(slot.plantSpecies)) {
      return true;
    }
    if (includesEggHint(slot.eggId) || includesEggHint(slot.eggSpecies)) {
      return true;
    }
    if (slot.species || slot.seedSpecies || slot.plantSpecies) {
      return true;
    }
    if (slot.endTime != null || slot.readyAt != null || slot.plantedAt != null) {
      return true;
    }
    return false;
  };

  const buildSlot = (
    tileId: string,
    boardwalk: boolean,
    source: Record<string, unknown>,
    fallbackIndex: number,
    tileDefaults: Record<string, unknown>,
  ): GardenSlotEstimate | null => {
    const slotIndex = readIndex(source.slotIndex, readIndex(tileDefaults.slotIndex, fallbackIndex));
    const endTime = parseTimestamp(
      source.endTime ??
        source.maturedAt ??
        source.readyAt ??
        source.harvestReadyAt ??
        source.finishAt ??
        tileDefaults.endTime ??
        tileDefaults.maturedAt ??
        tileDefaults.readyAt ??
        tileDefaults.harvestReadyAt ??
        tileDefaults.finishAt,
    );
    const readyAt = parseTimestamp(
      source.readyAt ??
        source.maturedAt ??
        source.harvestReadyAt ??
        source.endTime ??
        tileDefaults.readyAt ??
        tileDefaults.maturedAt ??
        tileDefaults.harvestReadyAt ??
        tileDefaults.endTime,
    );
    const plantedAt = parseTimestamp(
      source.plantedAt ??
        source.startTime ??
        source.startedAt ??
        tileDefaults.plantedAt ??
        tileDefaults.startTime ??
        tileDefaults.startedAt,
    );

    const tileObjectType = pickString(tileDefaults, ['objectType', 'object_type']);
    const tileCategory = pickString(tileDefaults, ['slotCategory', 'category', 'slot_category']);

    const objectType = pickString(source, ['objectType', 'object_type']) ?? tileObjectType;
    const slotType = pickString(source, ['type', 'slotType', 'slot_type']);
    const slotCategory = pickString(source, ['category', 'slotCategory', 'slot_category']);
    const slotKind = pickString(source, ['kind']);

    const species =
      pickString(source, ['species', 'seedSpecies', 'plantSpecies', 'petSpecies']) ??
      pickString(tileDefaults, ['species', 'seedSpecies', 'plantSpecies', 'petSpecies']);
    const seedSpecies = pickString(source, ['seedSpecies']) ?? pickString(tileDefaults, ['seedSpecies']);
    const plantSpecies = pickString(source, ['plantSpecies']) ?? pickString(tileDefaults, ['plantSpecies']);
    const eggId = pickString(source, ['eggId', 'eggID']) ?? pickString(tileDefaults, ['eggId', 'eggID']);
    const eggSpecies = pickString(source, ['eggSpecies', 'eggType']) ?? pickString(tileDefaults, ['eggSpecies', 'eggType']);

    const slot: GardenSlotEstimate = {
      tileId,
      slotIndex,
      species,
      seedSpecies,
      plantSpecies,
      eggId,
      eggSpecies,
      boardwalk,
      endTime,
      readyAt,
      plantedAt,
      slotType,
      slotCategory,
      objectType,
      tileObjectType,
      tileCategory,
      slotKind,
    };

    if (!shouldIncludeRecord(slot)) {
      return null;
    }

    return slot;
  };

  const processRecord = (record: unknown, boardwalk: boolean) => {
    if (!record || typeof record !== 'object') {
      return;
    }
    const entries = Object.entries(record as Record<string, unknown>);
    for (const [tileId, rawTile] of entries) {
      if (!rawTile || typeof rawTile !== 'object') {
        continue;
      }
      const tile = rawTile as Record<string, unknown>;
      const slots = Array.isArray(tile.slots) ? (tile.slots as unknown[]) : [];
      let slotAdded = false;

      slots.forEach((slot, index) => {
        if (!slot || typeof slot !== 'object') {
          return;
        }
        const built = buildSlot(tileId, boardwalk, slot as Record<string, unknown>, index, tile);
        if (built) {
          results.push(built);
          slotAdded = true;
        }
      });

      if (!slotAdded) {
        const built = buildSlot(tileId, boardwalk, tile, 0, tile);
        if (built) {
          results.push(built);
        }
      }
    }
  };

  processRecord(snapshot.tileObjects ?? null, false);
  if (includeBoardwalk) {
    processRecord(snapshot.boardwalkTileObjects ?? null, true);
  }

  return results;
}

function sanitizeTargetScale(scale: number | null | undefined): number {
  if (typeof scale !== 'number' || !Number.isFinite(scale)) {
    return config.fallbackTargetScale;
  }
  if (scale < 1) {
    return 1;
  }
  if (scale > config.maxTargetScale) {
    return config.maxTargetScale;
  }
  return scale;
}

interface TurtlePetStats {
  xp: number | null;
  targetScale: number;
  baseScore: number;
  missingStats: boolean;
}

function resolveTurtlePetStats(pet: ActivePetInfo): TurtlePetStats {
  // Get manual overrides if available
  const manualOverride = getManualOverride(pet);

  // Use manual override as fallback if atom data is missing
  let xp = typeof pet.xp === 'number' && Number.isFinite(pet.xp) ? pet.xp : null;
  if (xp == null && manualOverride?.xp != null) {
    xp = manualOverride.xp;
  }

  let targetScaleRaw = pet.targetScale;
  if (targetScaleRaw == null && manualOverride?.targetScale != null) {
    targetScaleRaw = manualOverride.targetScale;
  }
  const targetScale = sanitizeTargetScale(targetScaleRaw);

  // Use strength if available (most accurate)
  let strength = typeof pet.strength === 'number' && Number.isFinite(pet.strength) ? pet.strength : null;
  if (strength == null && manualOverride?.strength != null) {
    strength = manualOverride.strength;
  }

  const missingStats = pet.xp == null || pet.targetScale == null;
  const hasManualOverride = manualOverride && (manualOverride.xp != null || manualOverride.targetScale != null || manualOverride.strength != null);

  // If strength is available, use it directly as baseScore
  // Otherwise fall back to calculating from XP and targetScale
  let baseScore: number;
  if (strength != null) {
    baseScore = Math.max(0, strength);
  } else {
    const xpComponent = Math.min(Math.floor((((xp ?? 0) / (100 * 3600)) * 30)), 30);
    const scaleComponent = Math.floor(((targetScale - 1) / (config.maxTargetScale - 1)) * 20 + 80) - 30;
    baseScore = Math.max(0, xpComponent + scaleComponent);
  }

  return {
    xp,
    targetScale,
    baseScore,
    missingStats: missingStats && !hasManualOverride,
  };
}

function computeContribution(
  pet: ActivePetInfo,
  resolved: ResolvedGrowthAbility,
  abilityNames: string[],
): TurtleContribution {
  const petStats = resolveTurtlePetStats(pet);
  const { xp, targetScale, baseScore, missingStats } = petStats;

  // Use the catalog-sourced ability definition to compute stats via the linear model
  const def = getAbilityDefinition(resolved.abilityId);
  const strengthValue = baseScore > 0 ? baseScore : null;
  const abilityStats = def ? computeAbilityStats(def, strengthValue) : null;

  // Strength-scaled effect: minutes removed per proc
  const strengthScale = baseScore > 0 ? baseScore / 100 : 0;
  const reductionPerProc = resolved.effectMinutesPerProc * strengthScale;

  // procsPerHour from the linear model (p / 60 / 100 per second × 3600 seconds)
  const procsPerHour = abilityStats ? abilityStats.procsPerHour : 0;
  const perHourReduction = procsPerHour * reductionPerProc;
  const rateContribution = perHourReduction / 60; // per-minute rate for compatibility

  return {
    ability: resolved.kind,
    abilityNames,
    slotIndex: pet.slotIndex,
    name: pet.name,
    species: pet.species,
    mutations: Array.isArray(pet.mutations) ? [...pet.mutations] : [],
    hungerPct: pet.hungerPct,
    xp,
    targetScale,
    baseScore,
    rateContribution,
    perHourReduction,
    reductionPerProc,
    missingStats,
  };
}

function pickFocusSlot(
  slots: GardenSlotEstimate[],
  focus: TurtleTimerFocus,
  focusTargetTileId: string | null,
  focusTargetSlotIndex: number | null,
  now: number,
): GardenSlotEstimate | null {
  const candidates = slots.filter((slot) => slot.endTime != null && slot.endTime > now);
  if (!candidates.length) {
    return null;
  }
  if (focus === 'specific') {
    if (focusTargetTileId && focusTargetSlotIndex != null) {
      const matched = candidates.find(
        (slot) => slot.tileId === focusTargetTileId && slot.slotIndex === focusTargetSlotIndex,
      );
      if (matched) {
        return matched;
      }
    }
    return null;
  }
  if (focus === 'earliest') {
    return candidates.reduce((best, current) => {
      if (!best) return current;
      if ((current.endTime ?? Infinity) < (best.endTime ?? Infinity)) {
        return current;
      }
      return best;
    }, candidates[0]!);
  }
  return candidates.reduce((best, current) => {
    if (!best) return current;
    if ((current.endTime ?? -Infinity) > (best.endTime ?? -Infinity)) {
      return current;
    }
    return best;
  }, candidates[0]!);
}

function computeChannel(
  kind: TurtleAbilityKind,
  slots: GardenSlotEstimate[],
  contributions: TurtleContribution[],
  now: number,
  enabled: boolean,
  focusMode: TurtleTimerFocus,
  focusTargetTileId: string | null,
  focusTargetSlotIndex: number | null,
): TurtleTimerChannel {
  if (!enabled) {
    return { ...createEmptyChannel('disabled'), contributions: [] };
  }

  const trackedSlots = slots.filter((slot) => slot.endTime != null).length;
  const growingSlots = slots.filter((slot) => slot.endTime != null && slot.endTime > now).length;
  const maturedSlots = slots.filter((slot) => slot.endTime != null && slot.endTime <= now).length;

  const baseChannel: TurtleTimerChannel = {
    status: 'no-data',
    trackedSlots,
    growingSlots,
    maturedSlots,
    contributions: contributions.slice().sort((a, b) => b.rateContribution - a.rateContribution),
    expectedMinutesRemoved: null,
    effectiveRate: null,
    naturalMsRemaining: null,
    adjustedMsRemaining: null,
    minutesSaved: null,
    focusSlot: null,
  };

  if (slots.length === 0 || trackedSlots === 0) {
    return baseChannel;
  }

  if (growingSlots === 0) {
    return {
      ...baseChannel,
      status: kind === 'egg' ? 'no-eggs' : 'no-crops',
    };
  }

  const focusSlot = pickFocusSlot(slots, focusMode, focusTargetTileId, focusTargetSlotIndex, now);
  if (!focusSlot || focusSlot.endTime == null) {
    return {
      ...baseChannel,
      status: 'no-data',
    };
  }

  const naturalMsRemaining = Math.max(0, focusSlot.endTime - now);
  const naturalMinutes = naturalMsRemaining / 60000;
  const expectedMinutesRemovedRaw = contributions.reduce((sum, entry) => sum + entry.rateContribution, 0);
  const hasValidBoosters = Number.isFinite(expectedMinutesRemovedRaw) && expectedMinutesRemovedRaw > 0;
  const expectedMinutesRemoved = hasValidBoosters ? expectedMinutesRemovedRaw : 0;
  const effectiveRate = hasValidBoosters ? Math.max(0.01, 1 + expectedMinutesRemoved) : 1;
  const adjustedMinutes = naturalMinutes / Math.max(0.01, effectiveRate);
  const adjustedMsRemaining = adjustedMinutes * 60000;
  const minutesSaved = hasValidBoosters ? Math.max(0, naturalMinutes - adjustedMinutes) : null;
  const status: TurtleTimerStatus = hasValidBoosters ? 'estimating' : 'no-turtles';

  return {
    status,
    trackedSlots,
    growingSlots,
    maturedSlots,
    contributions: baseChannel.contributions,
    expectedMinutesRemoved: hasValidBoosters ? expectedMinutesRemoved : null,
    effectiveRate: hasValidBoosters ? effectiveRate : null,
    naturalMsRemaining,
    adjustedMsRemaining: hasValidBoosters ? adjustedMsRemaining : naturalMsRemaining,
    minutesSaved,
    focusSlot: {
      ...focusSlot,
      remainingMs: naturalMsRemaining,
    },
  };
}

function describePetKey(pet: ActivePetInfo): string {
  return pet.petId ?? pet.slotId ?? `${pet.slotIndex}-${pet.name ?? 'pet'}`;
}

function publish(next: TurtleTimerState): void {
  state = next;
  for (const listener of listeners) {
    try {
      listener(state);
    } catch (error) {
      log('⚠️ Turtle timer listener error', error);
    }
  }
}

function recompute(): void {
  const now = Date.now();
  const next = createInitialState();
  next.now = now;

  if (!config.enabled) {
    next.enabled = false;
    next.plant.status = 'disabled';
    next.egg.status = 'disabled';
    publish(next);
    return;
  }

  const slots = collectSlots(latestGarden, config.includeBoardwalk);
  const eggSlots = slots.filter((slot) => isEggSlot(slot));
  const plantSlots = slots.filter((slot) => !isEggSlot(slot));

  const plantContributions: TurtleContribution[] = [];
  const eggContributions: TurtleContribution[] = [];
  const supportEntries: TurtleSupportEntry[] = [];

  const availableKeys = new Set<string>();
  const hungerFilteredKeys = new Set<string>();
  const missingStatKeys = new Set<string>();

  for (const pet of latestPets) {
    if (!pet || typeof pet !== 'object') {
      continue;
    }

    const abilities = Array.isArray(pet.abilities)
      ? pet.abilities
          .filter((ability): ability is string => typeof ability === 'string' && ability.trim().length > 0)
          .map((ability) => ({ raw: ability, normalized: normalizeAbility(ability) }))
      : [];

    if (abilities.length === 0) {
      continue;
    }

    const petKey = describePetKey(pet);
    const hungerPct = pet.hungerPct;
    const hungerOk = hungerPct == null || hungerPct > config.minActiveHungerPct;

    let matchedReductionAbility = false;

    // Resolve growth abilities per-pet using catalog definitions
    const resolvedByKind = new Map<'plant' | 'egg', { resolved: ResolvedGrowthAbility; names: string[] }>();
    for (const { raw, normalized } of abilities) {
      const resolved = resolveGrowthAbility(raw, normalized);
      if (!resolved) continue;
      const existing = resolvedByKind.get(resolved.kind);
      if (existing) {
        existing.names.push(raw);
      } else {
        resolvedByKind.set(resolved.kind, { resolved, names: [raw] });
      }
    }

    for (const [kind, { resolved, names }] of resolvedByKind) {
      matchedReductionAbility = true;
      availableKeys.add(petKey);

      if (!hungerOk) {
        hungerFilteredKeys.add(petKey);
        continue;
      }

      const contribution = computeContribution(pet, resolved, names);
      if (contribution.missingStats) {
        missingStatKeys.add(petKey);
      }
      if (contribution.rateContribution <= 0) {
        continue;
      }

      if (kind === 'plant') {
        plantContributions.push(contribution);
      } else {
        eggContributions.push(contribution);
      }
    }

    const stats = resolveTurtlePetStats(pet);

    for (const supportKind of Object.keys(SUPPORT_PATTERNS) as TurtleSupportKind[]) {
      const matches = abilities
        .filter(({ normalized }) => SUPPORT_PATTERNS[supportKind].some((pattern) => normalized.includes(pattern)))
        .map(({ raw }) => raw);

      if (matches.length === 0) {
        continue;
      }

      const abilityDetails: SupportAbilityBreakdown[] = [];
      let totalRestorePerTriggerPct = 0;
      let totalRestorePerHourPct = 0;
      let totalTriggersPerHour = 0;
      let totalSlowPct = 0;

      for (const abilityName of matches) {
        const normalizedAbility = normalizeAbility(abilityName);
        const effect = resolveSupportEffect(supportKind, abilityName, normalizedAbility);
        if (!effect) {
          continue;
        }

        if (supportKind === 'restore') {
          const procsPerMinute = computeSupportProcPerMinute(stats.baseScore, effect.procOdds);
          const triggersPerHour = procsPerMinute * 60;
          const pctPerHour = triggersPerHour * effect.effectPct;
          totalRestorePerTriggerPct += effect.effectPct;
          totalRestorePerHourPct += pctPerHour;
          totalTriggersPerHour += triggersPerHour;
          abilityDetails.push({
            abilityName,
            normalizedName: normalizedAbility,
            perTriggerPct: effect.effectPct,
            slowdownPct: null,
            triggersPerHour,
            pctPerHour,
            probabilityPerMinute: procsPerMinute,
          });
        } else {
          totalSlowPct += effect.effectPct;
          abilityDetails.push({
            abilityName,
            normalizedName: normalizedAbility,
            perTriggerPct: null,
            slowdownPct: effect.effectPct,
            triggersPerHour: null,
            pctPerHour: null,
            probabilityPerMinute: null,
          });
        }
      }

      if (abilityDetails.length === 0) {
        continue;
      }

      supportEntries.push({
        type: supportKind,
        abilityNames: matches,
        slotIndex: pet.slotIndex,
        name: pet.name,
        species: pet.species,
        hungerPct,
        active: hungerOk,
        xp: stats.xp,
        targetScale: stats.targetScale,
        baseScore: stats.baseScore,
        missingStats: stats.missingStats,
        abilityDetails,
        totalRestorePerTriggerPct,
        totalRestorePerHourPct,
        totalTriggersPerHour,
        totalSlowPct,
      });
    }

    if (!matchedReductionAbility && !hungerOk) {
      hungerFilteredKeys.add(petKey);
    }
  }

  const focusTargetTileId = config.focusTargetTileId;
  const focusTargetSlotIndex = config.focusTargetSlotIndex;

  const plantChannel = computeChannel(
    'plant',
    plantSlots,
    plantContributions,
    now,
    true,
    config.focus,
    focusTargetTileId,
    focusTargetSlotIndex,
  );
  const eggFocusTargetTileId = config.eggFocusTargetTileId;
  const eggFocusTargetSlotIndex = config.eggFocusTargetSlotIndex;
  const eggChannel = computeChannel(
    'egg',
    eggSlots,
    eggContributions,
    now,
    true,
    config.eggFocus,
    eggFocusTargetTileId,
    eggFocusTargetSlotIndex,
  );

  let restoreCount = 0;
  let restoreActiveCount = 0;
  let slowCount = 0;
  let slowActiveCount = 0;
  let restorePctTotal = 0;
  let restorePctActive = 0;
  let restorePctPerHourTotal = 0;
  let restorePctPerHourActive = 0;
  let restoreTriggersPerHourTotal = 0;
  let restoreTriggersPerHourActive = 0;
  let slowPctTotal = 0;
  let slowPctActive = 0;

  supportEntries.sort((a, b) => {
    if (a.type === b.type) {
      if (a.active === b.active) {
        return (a.name ?? '').localeCompare(b.name ?? '');
      }
      return a.active ? -1 : 1;
    }
    return a.type === 'restore' ? -1 : 1;
  });

  for (const entry of supportEntries) {
    if (entry.type === 'restore') {
      restoreCount += 1;
      restorePctTotal += entry.totalRestorePerTriggerPct;
      restorePctPerHourTotal += entry.totalRestorePerHourPct;
      restoreTriggersPerHourTotal += entry.totalTriggersPerHour;
      if (entry.active) {
        restoreActiveCount += 1;
        restorePctActive += entry.totalRestorePerTriggerPct;
        restorePctPerHourActive += entry.totalRestorePerHourPct;
        restoreTriggersPerHourActive += entry.totalTriggersPerHour;
      }
    } else {
      slowCount += 1;
      slowPctTotal += entry.totalSlowPct;
      if (entry.active) {
        slowActiveCount += 1;
        slowPctActive += entry.totalSlowPct;
      }
    }
  }

  next.enabled = true;
  next.includeBoardwalk = config.includeBoardwalk;
  next.focus = config.focus;
  next.eggFocus = config.eggFocus;
  const plantTargets: TurtleFocusOption[] = plantSlots
    .filter((slot) => slot.endTime != null && slot.endTime > now)
    .map((slot) => ({
      key: makeFocusKey(slot.tileId, slot.slotIndex) ?? `${slot.tileId}${FOCUS_KEY_SEPARATOR}${slot.slotIndex}`,
      tileId: slot.tileId,
      slotIndex: slot.slotIndex,
      species: slot.species ?? slot.seedSpecies ?? slot.plantSpecies,
      boardwalk: slot.boardwalk,
      endTime: slot.endTime ?? null,
      remainingMs: slot.endTime != null ? Math.max(0, slot.endTime - now) : null,
    }));
  next.plantTargets = plantTargets;
  next.focusTargetKey = makeFocusKey(focusTargetTileId, focusTargetSlotIndex);
  next.focusTargetAvailable = next.focusTargetKey != null
    ? plantTargets.some((target) => target.key === next.focusTargetKey)
    : false;
  const eggTargets: TurtleFocusOption[] = eggSlots
    .filter((slot) => slot.endTime != null && slot.endTime > now)
    .map((slot) => ({
      key: makeFocusKey(slot.tileId, slot.slotIndex) ?? `${slot.tileId}${FOCUS_KEY_SEPARATOR}${slot.slotIndex}`,
      tileId: slot.tileId,
      slotIndex: slot.slotIndex,
      species: slot.eggSpecies ?? slot.eggId ?? slot.species,
      boardwalk: slot.boardwalk,
      endTime: slot.endTime ?? null,
      remainingMs: slot.endTime != null ? Math.max(0, slot.endTime - now) : null,
    }));
  next.eggTargets = eggTargets;
  next.eggFocusTargetKey = makeFocusKey(eggFocusTargetTileId, eggFocusTargetSlotIndex);
  next.eggFocusTargetAvailable = next.eggFocusTargetKey != null
    ? eggTargets.some((target) => target.key === next.eggFocusTargetKey)
    : false;
  next.minActiveHungerPct = config.minActiveHungerPct;
  next.fallbackTargetScale = config.fallbackTargetScale;
  next.availableTurtles = availableKeys.size;
  next.hungerFilteredCount = hungerFilteredKeys.size;
  next.turtlesMissingStats = missingStatKeys.size;
  next.plant = plantChannel;
  next.egg = eggChannel;
  next.support = {
    restoreCount,
    restoreActiveCount,
    slowCount,
    slowActiveCount,
    restorePctTotal,
    restorePctActive,
    restorePctPerHourTotal,
    restorePctPerHourActive,
    restoreTriggersPerHourTotal,
    restoreTriggersPerHourActive,
    slowPctTotal,
    slowPctActive,
    entries: supportEntries,
  };

  publish(next);
}

interface DebugEggDetectionOptions {
  includeRaw?: boolean;
  focusTileId?: string | null;
  limit?: number;
}

function debugEggDetection(options?: DebugEggDetectionOptions): void {
  const includeBoardwalk = config.includeBoardwalk;
  const focusTileId = options?.focusTileId ?? null;
  const limit = Math.max(1, Math.floor(options?.limit ?? 10));
  const slots = collectSlots(latestGarden ?? null, includeBoardwalk);
  const diagnostics = slots
    .filter((slot) => !focusTileId || slot.tileId === focusTileId)
    .map((slot) => ({
      tileId: slot.tileId,
      slotIndex: slot.slotIndex,
      boardwalk: slot.boardwalk,
      species: slot.species,
      seedSpecies: slot.seedSpecies,
      plantSpecies: slot.plantSpecies,
      eggId: slot.eggId,
      eggSpecies: slot.eggSpecies,
      slotType: slot.slotType,
      slotCategory: slot.slotCategory,
      objectType: slot.objectType,
      tileObjectType: slot.tileObjectType,
      tileCategory: slot.tileCategory,
      slotKind: slot.slotKind,
      endTime: slot.endTime,
      readyAt: slot.readyAt,
      plantedAt: slot.plantedAt,
      isEgg: isEggSlot(slot),
    }));

  const eggDiagnostics = diagnostics.filter((entry) => entry.isEgg);
  console.log('[TurtleTimer] Egg detection snapshot', {
    totalSlots: diagnostics.length,
    eggSlots: eggDiagnostics.length,
    includeBoardwalk,
    focusTileId,
  });
  if (typeof console.table === 'function') {
    console.table(diagnostics);
  } else {
    diagnostics.forEach((entry) => console.log(entry));
  }

  if (options?.includeRaw && eggDiagnostics.length > 0) {
    const garden = latestGarden ?? null;
    const resolveTile = (tileId: string, boardwalk: boolean) => {
      if (!garden || typeof garden !== 'object') {
        return null;
      }
      const container = boardwalk ? (garden as GardenState).boardwalkTileObjects : (garden as GardenState).tileObjects;
      if (!container || typeof container !== 'object') {
        return null;
      }
      const raw = (container as Record<string, unknown>)[tileId];
      return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    };

    const pickSlot = (tile: Record<string, unknown> | null, slotIndex: number) => {
      if (!tile) {
        return null;
      }
      const slotsValue = tile.slots;
      if (Array.isArray(slotsValue)) {
        const raw = slotsValue[slotIndex] ?? null;
        return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : raw;
      }
      return tile;
    };

    eggDiagnostics.slice(0, limit).forEach((entry, index) => {
      const rawTile = resolveTile(entry.tileId, entry.boardwalk);
      const rawSlot = pickSlot(rawTile, entry.slotIndex);
      console.log(`[TurtleTimer] Raw egg ${index + 1}/${Math.min(limit, eggDiagnostics.length)}`, {
        tileId: entry.tileId,
        boardwalk: entry.boardwalk,
        rawTile,
        rawSlot,
      });
    });
  }
}

function mergeConfig(next?: TurtleTimerConfig): void {
  if (!next) {
    return;
  }
  if (typeof next.enabled === 'boolean') {
    config.enabled = next.enabled;
  }
  if (typeof next.includeBoardwalk === 'boolean') {
    config.includeBoardwalk = next.includeBoardwalk;
  }
  if (typeof next.minActiveHungerPct === 'number' && Number.isFinite(next.minActiveHungerPct)) {
    const bounded = Math.max(0, Math.min(100, Math.round(next.minActiveHungerPct)));
    config.minActiveHungerPct = bounded;
  }
  if (typeof next.fallbackTargetScale === 'number' && Number.isFinite(next.fallbackTargetScale)) {
    const sanitized = Math.max(1, Math.min(config.maxTargetScale, next.fallbackTargetScale));
    config.fallbackTargetScale = sanitized;
  }
  if (next.focus === 'latest' || next.focus === 'earliest' || next.focus === 'specific') {
    config.focus = next.focus;
  }
  if (typeof next.focusTargetTileId === 'string' || next.focusTargetTileId === null) {
    config.focusTargetTileId = next.focusTargetTileId ?? null;
  }
  if (typeof next.focusTargetSlotIndex === 'number' && Number.isFinite(next.focusTargetSlotIndex)) {
    config.focusTargetSlotIndex = Math.max(0, Math.round(next.focusTargetSlotIndex));
  } else if (next.focusTargetSlotIndex === null) {
    config.focusTargetSlotIndex = null;
  }
  if (next.eggFocus === 'latest' || next.eggFocus === 'earliest' || next.eggFocus === 'specific') {
    config.eggFocus = next.eggFocus;
  }
  if (typeof next.eggFocusTargetTileId === 'string' || next.eggFocusTargetTileId === null) {
    config.eggFocusTargetTileId = next.eggFocusTargetTileId ?? null;
  }
  if (typeof next.eggFocusTargetSlotIndex === 'number' && Number.isFinite(next.eggFocusTargetSlotIndex)) {
    config.eggFocusTargetSlotIndex = Math.max(0, Math.round(next.eggFocusTargetSlotIndex));
  } else if (next.eggFocusTargetSlotIndex === null) {
    config.eggFocusTargetSlotIndex = null;
  }
}

export function initializeTurtleTimer(initialConfig?: TurtleTimerConfig): void {
  if (initialized) {
    if (initialConfig) {
      configureTurtleTimer(initialConfig);
    }
    return;
  }
  initialized = true;

  // Load manual overrides from storage
  loadManualOverrides();

  mergeConfig(initialConfig);

  try {
    const attach = (options?: DebugEggDetectionOptions) => debugEggDetection(options);
    (pageWindow as Window & { debugEggDetection?: (options?: DebugEggDetectionOptions) => void }).debugEggDetection = attach;
    if (typeof window !== 'undefined' && window !== pageWindow) {
      (window as Window & { debugEggDetection?: (options?: DebugEggDetectionOptions) => void }).debugEggDetection = attach;
    }
  } catch (error) {
    log('⚠️ Unable to attach debugEggDetection helper', error);
  }

  void startPetInfoStore();

  gardenUnsubscribe = onGardenSnapshot((snapshot) => {
    latestGarden = snapshot;
    const fp = getTurtleGardenFingerprint(snapshot);
    if (fp === lastTurtleGardenFingerprint) return;
    lastTurtleGardenFingerprint = fp;
    recompute();
  });

  petUnsubscribe = onActivePetInfos((infos) => {
    latestPets = infos;
    recompute();
  });

  recompute();
  log('🐢 Turtle timer ready');
}

export function disposeTurtleTimer(): void {
  gardenUnsubscribe?.();
  gardenUnsubscribe = null;
  petUnsubscribe?.();
  petUnsubscribe = null;
  initialized = false;
  lastTurtleGardenFingerprint = '';
  state = createInitialState();
}

export function configureTurtleTimer(next: TurtleTimerConfig): void {
  mergeConfig(next);
  recompute();
}

export function setTurtleTimerEnabled(enabled: boolean): void {
  configureTurtleTimer({ enabled });
}

export function recalculateTimerState(): void {
  recompute();
}

export function getTurtleTimerState(): TurtleTimerState {
  return state;
}

export function onTurtleTimerState(
  listener: (snapshot: TurtleTimerState) => void,
  fireImmediately = true,
): () => void {
  listeners.add(listener);
  if (fireImmediately) {
    try {
      listener(state);
    } catch (error) {
      log('⚠️ Turtle timer immediate listener error', error);
    }
  }
  return () => {
    listeners.delete(listener);
  };
}
