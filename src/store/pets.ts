// src/store/pets.ts
// Bridge for active pet information via myPrimitivePetSlotsAtom.

import { subscribeAtomValue } from '../core/atomRegistry';
import { getHungerCapForSpecies, DEFAULT_HUNGER_CAP } from '../features/pets/data/petHungerCaps';
import { getAbilityDefinition } from '../features/pets/data/petAbilities';
import { log } from '../utils/logger';
import { recordPetXP, estimatePetLevel } from './petLevelCalculator';
import { calculateMaxStrength, getSpeciesXpPerLevel } from './xpTracker';
import { areCatalogsReady, onCatalogsReady } from '../catalogs/gameCatalogs';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storePets', 'pets');
let firstAtomValueSeen = false;
let lastPublishedCount = -1;
let lastNotifySignature: string | null = null;

export interface ActivePetInfo {
  slotIndex: number;
  slotId: string | null;
  petId: string | null;
  hungerPct: number | null;
  hungerValue: number | null;
  hungerMax: number | null;
  hungerRaw: string | null;
  name: string | null;
  species: string | null;
  targetScale: number | null;
  mutations: string[];
  abilities: string[];
  xp: number | null;
  level: number | null;
  levelRaw: string | null;
  strength: number | null;
  /** First ability ID from abilityCooldowns (charged/activatable ability), or null. */
  chargedAbilityId: string | null;
  position: { x: number | null; y: number | null } | null;
  updatedAt: number;
  raw: unknown;
}

type RawPetSlot = Record<string, unknown>;

type RawPetInfo = Record<string, unknown> & {
  slot?: RawPetSlot;
};

const PET_INFOS_LABEL = 'myPrimitivePetSlotsAtom';
const PET_INFOS_RETRY_DELAY_MS = 1500;

let cachedInfos: ActivePetInfo[] = [];
let lastRawValue: unknown = null;
let unsubscribe: (() => void) | null = null;
let initializing = false;
let catalogReadyHooked = false;
const listeners = new Set<(infos: ActivePetInfo[]) => void>();
let retryTimer: number | null = null;
let petInfosAtomRef: unknown = null;

function buildNotifySignature(infos: ActivePetInfo[]): string {
  // Per-slot signature covers every field a subscriber consumes:
  // identity (slotIndex/petId/slotId/species/name), hunger (value+pct),
  // xp/level/strength/targetScale, chargedAbilityId, mutations/abilities.
  // hungerMax/hungerRaw/levelRaw/position/updatedAt/raw are either derived
  // from species or unread by subscribers — omitted.
  let sig = '';
  for (const p of infos) {
    sig += `${p.slotIndex}|${p.petId ?? ''}|${p.slotId ?? ''}|${p.species ?? ''}|${p.name ?? ''}|${p.hungerValue ?? ''}|${p.hungerPct ?? ''}|${p.xp ?? ''}|${p.level ?? ''}|${p.strength ?? ''}|${p.targetScale ?? ''}|${p.chargedAbilityId ?? ''}|${p.mutations.join(',')}|${p.abilities.join(',')}\n`;
  }
  return sig;
}

function notify(): void {
  const signature = buildNotifySignature(cachedInfos);
  if (signature === lastNotifySignature) return;
  lastNotifySignature = signature;

  for (const listener of listeners) {
    try {
      listener(cachedInfos);
    } catch (error) {
      diag.warn('QPM-STORE-003', { phase: 'notify' }, error);
    }
  }
  const count = cachedInfos.length;
  const message = `${count} active pet(s)`;
  const metrics = { activeCount: count };
  if (!firstAtomValueSeen) {
    firstAtomValueSeen = true;
    lastPublishedCount = count;
    diag.publishOk(message, metrics);
  } else if (count !== lastPublishedCount) {
    // §7.2 — active pet count change is a meaningful state transition.
    lastPublishedCount = count;
    diag.publishMetrics(message, metrics);
  }
}

function clearStartRetry(): void {
  if (retryTimer != null) {
    window.clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleStartRetry(): void {
  if (retryTimer != null) {
    return;
  }
  retryTimer = window.setTimeout(() => {
    retryTimer = null;
    if (!unsubscribe) {
      void startPetInfoStore();
    }
  }, PET_INFOS_RETRY_DELAY_MS);
}

function parseNumeric(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === 'string') {
    const match = value.match(/-?\d+(?:\.\d+)?/);
    if (!match) return null;
    const parsed = Number(match[0]);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object') {
    return parseNumeric((value as Record<string, unknown>)?.valueOf?.());
  }
  return null;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 100) {
    return 100;
  }
  return value;
}

function normalizePercentCandidate(value: number, allowBasisPoint = false): number | null {
  if (!Number.isFinite(value)) {
    return null;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 0 && value <= 1) {
    return value * 100;
  }
  if (value >= 0 && value <= 100) {
    return value;
  }
  if (allowBasisPoint && value > 100 && value <= 10000) {
    const scaled = value / 100;
    if (scaled <= 100) {
      return scaled;
    }
  }
  return null;
}

interface HungerResolution {
  pct: number | null;
  value: number | null;
  max: number | null;
  raw: string | null;
}

function resolveHunger(
  entry: RawPetInfo,
  slot: RawPetSlot,
  stats: RawPetSlot | undefined,
  species: string | null,
): HungerResolution {
  const nested = (slot.pet as RawPetSlot | undefined) ?? (entry.pet as RawPetSlot | undefined) ?? null;
  const sources: { value: unknown; hint: string }[] = [
    { value: entry.hungerPct, hint: 'entry.hungerPct' },
    { value: entry.hunger_percentage, hint: 'entry.hunger_percentage' },
    { value: (entry as RawPetSlot).hunger, hint: 'entry.hunger' },
    { value: slot.hungerPct, hint: 'slot.hungerPct' },
    { value: slot.hunger_percentage, hint: 'slot.hunger_percentage' },
    { value: slot.hunger, hint: 'slot.hunger' },
    { value: stats?.hungerPct, hint: 'stats.hungerPct' },
    { value: stats?.hunger, hint: 'stats.hunger' },
    { value: nested?.hungerPct, hint: 'nested.hungerPct' },
    { value: nested?.hunger, hint: 'nested.hunger' },
  ];

  let firstRaw: string | null = null;
  const pctCandidates: number[] = [];
  const rawCandidates: number[] = [];

  for (const { value, hint } of sources) {
    if (value == null) {
      continue;
    }
    if (firstRaw == null) {
      firstRaw = String(value);
    }
    const numeric = parseNumeric(value);
    if (numeric == null) {
      continue;
    }

    const allowBasisPoint = /pct|percent/i.test(hint);
    const normalizedPct = normalizePercentCandidate(numeric, allowBasisPoint);
    if (normalizedPct != null && (allowBasisPoint || numeric <= 100)) {
      pctCandidates.push(normalizedPct);
      continue;
    }

    rawCandidates.push(numeric);
  }

  const rawCandidate = rawCandidates.length > 0 ? rawCandidates[0]! : null;
  const maxFromData = species ? getHungerCapForSpecies(species) : null;

  if (pctCandidates.length) {
    const pctCandidate = pctCandidates[0]!;
    return {
      pct: clampPercent(pctCandidate),
      value: rawCandidate,
      max: maxFromData,
      raw: firstRaw,
    };
  }

  if (rawCandidate != null) {
    if (maxFromData != null && maxFromData > 0) {
      const pct = clampPercent((rawCandidate / maxFromData) * 100);
      return {
        pct,
        value: rawCandidate,
        max: maxFromData,
        raw: firstRaw,
      };
    }

    if (rawCandidate > 0) {
      const pct = clampPercent((rawCandidate / DEFAULT_HUNGER_CAP) * 100);
      return {
        pct,
        value: rawCandidate,
        max: DEFAULT_HUNGER_CAP,
        raw: firstRaw,
      };
    }

    return {
      pct: 0,
      value: rawCandidate,
      max: maxFromData,
      raw: firstRaw,
    };
  }

  return {
    pct: null,
    value: null,
    max: maxFromData,
    raw: firstRaw,
  };
}

function coerceSlotIndex(entry: RawPetInfo, fallbackIndex: number): number {
  const candidates: unknown[] = [
    entry.slotIndex,
    (entry.slot as Record<string, unknown> | undefined)?.slotIndex,
    entry.order,
    entry.index,
    (entry.slot as Record<string, unknown> | undefined)?.index,
    (entry.slot as Record<string, unknown> | undefined)?.originalIndex,
    (entry.slot as Record<string, unknown> | undefined)?.orderedIndex,
    fallbackIndex,
  ];

  for (const candidate of candidates) {
    const numeric = parseNumeric(candidate);
    if (numeric != null && Number.isFinite(numeric)) {
      return Math.max(0, Math.round(numeric));
    }
  }
  return fallbackIndex;
}

function extractName(entry: RawPetInfo): string | null {
  const slot = (entry.slot as Record<string, unknown> | undefined) ?? {};
  const candidates = [entry.name, entry.displayName, slot.name, slot.displayName];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function extractSpecies(entry: RawPetInfo): string | null {
  const slot = (entry.slot as Record<string, unknown> | undefined) ?? {};
  const candidates = [
    entry.species,
    slot.species,
    slot.petSpecies,
    entry.petSpecies,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function toEntryArray(value: unknown): RawPetInfo[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.filter((entry): entry is RawPetInfo => !!entry && typeof entry === 'object');
  }
  if (value instanceof Map) {
    return Array.from(value.values()).filter((entry): entry is RawPetInfo => !!entry && typeof entry === 'object');
  }
  if (value instanceof Set) {
    return Array.from(value.values()).filter((entry): entry is RawPetInfo => !!entry && typeof entry === 'object');
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const numericEntries: RawPetInfo[] = [];
    for (const [key, val] of Object.entries(record)) {
      if (/^\d+$/.test(key) && val && typeof val === 'object') {
        numericEntries.push(val as RawPetInfo);
      }
    }
    if (numericEntries.length) {
      return numericEntries;
    }
  }
  return [];
}

function extractPetInfoEntries(raw: unknown): RawPetInfo[] {
  const queue: unknown[] = [raw];
  const seen = new Set<unknown>();
  while (queue.length) {
    const current = queue.shift();
    if (current == null) {
      continue;
    }

    const direct = toEntryArray(current);
    if (direct.length) {
      return direct;
    }

    if (typeof current === 'object') {
      if (seen.has(current)) {
        continue;
      }
      seen.add(current);

      if (current instanceof Map) {
        for (const value of current.values()) {
          queue.push(value);
        }
        continue;
      }

      if (current instanceof Set) {
        for (const value of current.values()) {
          queue.push(value);
        }
        continue;
      }

      const record = current as Record<string, unknown>;
      for (const value of Object.values(record)) {
        queue.push(value);
      }
    }
  }
  return [];
}

function getSlotRecord(entry: RawPetInfo): RawPetSlot {
  const slot = entry.slot;
  if (slot && typeof slot === 'object') {
    return slot as RawPetSlot;
  }
  return entry as RawPetSlot;
}

function coerceString(value: unknown): string | null {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function dedupeStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(value);
  }
  return result;
}

function toStringList(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === 'string') {
    const coerced = coerceString(value);
    return coerced ? [coerced] : [];
  }
  if (Array.isArray(value)) {
    const result: string[] = [];
    for (const entry of value) {
      const coerced = coerceString(entry);
      if (coerced) {
        result.push(coerced);
      }
    }
    return result;
  }
  if (value instanceof Set) {
    return toStringList(Array.from(value.values()));
  }
  return [];
}

function splitMutationTokens(value: string): string[] {
  if (!value) return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  const tokens = /[,|/;]/.test(trimmed) ? trimmed.split(/[,|/;]/g) : [trimmed];
  const result: string[] = [];
  for (const token of tokens) {
    const candidate = token.trim();
    if (!candidate || !/[a-z]/i.test(candidate)) continue;
    result.push(candidate);
  }
  return result;
}

function toMutationStringList(
  value: unknown,
  seen: WeakSet<object> = new WeakSet<object>(),
  depth = 0,
): string[] {
  if (value == null || depth > 4) return [];
  if (typeof value === 'string') {
    return splitMutationTokens(value);
  }
  if (Array.isArray(value)) {
    const result: string[] = [];
    for (const entry of value) {
      result.push(...toMutationStringList(entry, seen, depth + 1));
    }
    return result;
  }
  if (value instanceof Set) {
    return toMutationStringList(Array.from(value.values()), seen, depth + 1);
  }
  if (value instanceof Map) {
    return toMutationStringList(Array.from(value.values()), seen, depth + 1);
  }
  if (typeof value === 'object') {
    if (seen.has(value)) {
      return [];
    }
    seen.add(value);

    const record = value as Record<string, unknown>;
    const result: string[] = [];
    const keys = Object.keys(record);

    if ('mutations' in record) {
      result.push(...toMutationStringList(record.mutations, seen, depth + 1));
    }
    if ('mutation' in record) {
      result.push(...toMutationStringList(record.mutation, seen, depth + 1));
    }

    const descriptorKeys = new Set(['id', 'name', 'displayName', 'label', 'value', 'variant', 'key', 'type', 'slug', '__typename']);
    const isDescriptorObject = keys.length > 0 && keys.every((key) => descriptorKeys.has(key));
    if (isDescriptorObject) {
      const namedFields = [
        record.name,
        record.displayName,
        record.label,
        record.value,
        record.variant,
        record.key,
        record.id,
      ];
      for (const field of namedFields) {
        if (typeof field === 'string') {
          result.push(...splitMutationTokens(field));
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
            result.push(...splitMutationTokens(key));
          }
        }
      }
    }

    return result;
  }
  return [];
}

function extractSlotId(entry: RawPetInfo): string | null {
  const slot = getSlotRecord(entry);
  const nested = (slot.pet as RawPetSlot | undefined) ?? (entry.pet as RawPetSlot | undefined) ?? null;
  const candidates: unknown[] = [
    entry.slotId,
    slot.slotId,
    slot.slotID,
    slot.id,
    nested?.slotId,
    nested?.id,
    entry.id,
  ];
  for (const candidate of candidates) {
    const value = coerceString(candidate);
    if (value) {
      return value;
    }
  }
  return null;
}

function extractPetId(entry: RawPetInfo): string | null {
  const slot = getSlotRecord(entry);
  const nested = (slot.pet as RawPetSlot | undefined) ?? (entry.pet as RawPetSlot | undefined) ?? null;
  const candidates: unknown[] = [
    entry.petId,
    slot.petId,
    nested?.petId,
    nested?.id,
    slot.id,
    entry.entityId,
  ];
  for (const candidate of candidates) {
    const value = coerceString(candidate);
    if (value) {
      return value;
    }
  }
  return extractSlotId(entry);
}

function extractMutations(entry: RawPetInfo): string[] {
  const slot = getSlotRecord(entry);
  const nested = (slot.pet as RawPetSlot | undefined) ?? (entry.pet as RawPetSlot | undefined) ?? null;
  const combined = [
    ...toMutationStringList(entry.mutation),
    ...toMutationStringList(entry.mutations),
    ...toMutationStringList(slot.mutation),
    ...toMutationStringList(slot.mutations),
    ...toMutationStringList(nested?.mutation),
    ...toMutationStringList(nested?.mutations),
  ];
  return dedupeStrings(combined);
}

function extractAbilities(entry: RawPetInfo): string[] {
  const slot = getSlotRecord(entry);
  const nested = (slot.pet as RawPetSlot | undefined) ?? (entry.pet as RawPetSlot | undefined) ?? null;
  const combined = [
    ...toStringList(entry.abilities),
    ...toStringList(slot.abilities),
    ...toStringList(slot.ability),
    ...toStringList(nested?.abilities),
  ];
  return dedupeStrings(combined);
}

function extractChargedAbilityId(entry: RawPetInfo): string | null {
  const slot = getSlotRecord(entry);
  const nested = (slot.pet as RawPetSlot | undefined) ?? (entry.pet as RawPetSlot | undefined) ?? null;
  const candidates = [entry.abilityCooldowns, slot.abilityCooldowns, nested?.abilityCooldowns];
  for (const cd of candidates) {
    if (cd && typeof cd === 'object' && !Array.isArray(cd)) {
      const keys = Object.keys(cd as Record<string, unknown>);
      if (keys.length > 0) return keys[0]!;
    }
  }
  // Fallback: abilityCooldowns is empty until the ability first fires, but the
  // mount affordance must still appear pre-fire. Scan abilities[] for any ID
  // whose catalog entry has trigger === 'playerActivated'.
  const abilities = [
    ...toStringList(entry.abilities),
    ...toStringList(slot.abilities),
    ...toStringList(slot.ability),
    ...toStringList(nested?.abilities),
  ];
  for (const id of abilities) {
    if (getAbilityDefinition(id)?.trigger === 'playerActivated') return id;
  }
  return null;
}

function extractPosition(entry: RawPetInfo): { x: number | null; y: number | null } | null {
  const slot = getSlotRecord(entry);
  const candidates = [entry.position, entry.pos, slot.position, slot.pos];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const record = candidate as Record<string, unknown>;
    const x = parseNumeric(record.x ?? record.X ?? record.left ?? record.posX ?? record.longitude);
    const y = parseNumeric(record.y ?? record.Y ?? record.top ?? record.posY ?? record.latitude);
    if (x != null || y != null) {
      return { x: x ?? null, y: y ?? null };
    }
  }
  return null;
}

let _strengthCache: number[] = [];
let _strengthCacheTs = 0;

function extractStrengthFromDOM(): number[] {
  if (Date.now() - _strengthCacheTs < 2000) return _strengthCache;

  const strengthValues: number[] = [];

  try {
    // Look for <p class="chakra-text css-1jrst1o"> elements with "STR XX" pattern
    const strElements = document.querySelectorAll('p.chakra-text.css-1jrst1o');

    for (const el of strElements) {
      const text = el.textContent || '';
      const match = text.match(/\bSTR\s+(\d+)\b/i);

      if (match && match[1]) {
        const strength = parseInt(match[1], 10);
        if (!strengthValues.includes(strength)) {
          strengthValues.push(strength);
        }
      }
    }
  } catch (error) {
    // Silently fail if DOM extraction doesn't work
  }

  _strengthCache = strengthValues;
  _strengthCacheTs = Date.now();
  return strengthValues;
}

function normalizePetInfos(raw: unknown): ActivePetInfo[] {
  const entries = extractPetInfoEntries(raw);
  if (!entries.length) {
    return [];
  }

  const now = Date.now();
  const infos: ActivePetInfo[] = [];

  // Extract strength values from DOM as fallback
  const domStrengthValues = extractStrengthFromDOM();

  entries.forEach((entry, idx) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const rawInfo = entry as RawPetInfo;
    const slot = getSlotRecord(rawInfo);
    const stats = (slot.stats as RawPetSlot | undefined) ?? undefined;
    const nestedPet = (slot.pet as RawPetSlot | undefined) ?? (rawInfo.pet as RawPetSlot | undefined) ?? undefined;
    const slotIndex = coerceSlotIndex(rawInfo, idx);

    const species = extractSpecies(rawInfo);
    const hunger = resolveHunger(rawInfo, slot, stats, species);

    const xpCandidates = [slot.xp, stats?.xp, rawInfo.xp];
    let xp: number | null = null;
    for (const candidate of xpCandidates) {
      const parsed = parseNumeric(candidate);
      if (parsed != null) {
        xp = parsed;
        break;
      }
    }

    const levelCandidates = [slot.level, stats?.level, rawInfo.level, nestedPet?.level];
    let level: number | null = null;
    let levelRaw: string | null = null;
    for (const candidate of levelCandidates) {
      if (candidate != null && levelRaw == null) {
        levelRaw = typeof candidate === 'string' ? candidate : String(candidate);
      }
      const parsed = parseNumeric(candidate);
      if (parsed != null) {
        level = Math.max(0, Math.round(parsed));
        break;
      }
    }

    // Extract targetScale early (needed for strength calculation)
    const targetScaleCandidates = [
      slot.targetScale,
      stats?.targetScale,
      rawInfo.targetScale,
      nestedPet?.targetScale,
      (slot.pet as RawPetSlot | undefined)?.targetScale,
      (rawInfo.pet as RawPetSlot | undefined)?.targetScale,
    ];
    let targetScale: number | null = null;
    for (const candidate of targetScaleCandidates) {
      const parsed = parseNumeric(candidate);
      if (parsed != null) {
        targetScale = parsed;
        break;
      }
    }

    const strengthCandidates = [slot.strength, stats?.strength, rawInfo.strength];
    let atomStrength: number | null = null;
    for (const candidate of strengthCandidates) {
      const parsed = parseNumeric(candidate);
      if (parsed != null) {
        atomStrength = parsed;
        break;
      }
    }

    // Fallback: extract strength from DOM if not in Jotai data
    if (atomStrength == null && slotIndex < domStrengthValues.length) {
      atomStrength = domStrengthValues[slotIndex] ?? null;
    }

    // Calculate CURRENT strength from XP
    // Slot 2 often has no strength field in atom, so we calculate from targetScale + XP
    let strength: number | null = null;

    // Primary method: Calculate from targetScale and XP
    if (targetScale != null && xp != null && species) {
      const maxStr = calculateMaxStrength(targetScale, species);
      const xpPerLevel = getSpeciesXpPerLevel(species);

      if (maxStr != null && xpPerLevel != null && xpPerLevel > 0) {
        // Levels gained from XP (capped at 30)
        const levelsGainedFromXp = Math.floor(xp / xpPerLevel);
        const actualLevelsGained = Math.min(30, levelsGainedFromXp);

        // Hatch strength = max - 30 levels
        const hatchStrength = maxStr - 30;

        // Current strength = hatch + actual levels gained
        const calculatedCurrent = hatchStrength + actualLevelsGained;

        // Use calculated value if it makes sense
        if (calculatedCurrent >= hatchStrength && calculatedCurrent <= maxStr) {
          strength = calculatedCurrent;
        }
      }
    }

    // Fallback: If targetScale is missing, try using atomStrength
    if (strength == null && atomStrength != null && xp != null && species) {
      if (atomStrength >= 80 && atomStrength <= 100) {
        // Assume atomStrength is max strength, calculate current from XP
        const maxStr = atomStrength;
        const xpPerLevel = getSpeciesXpPerLevel(species);

        if (xpPerLevel != null && xpPerLevel > 0) {
          const levelsGainedFromXp = Math.floor(xp / xpPerLevel);
          const actualLevelsGained = Math.min(30, levelsGainedFromXp);
          const hatchStrength = maxStr - 30;
          const calculatedCurrent = hatchStrength + actualLevelsGained;

          if (calculatedCurrent >= hatchStrength && calculatedCurrent <= maxStr) {
            strength = calculatedCurrent;
          }
        }
      }
    }

    // Last resort: Use atom strength as-is (may be incorrect for slot 2)
    if (strength == null) {
      strength = atomStrength;
    }

    const petInfo: ActivePetInfo = {
      slotIndex,
      slotId: extractSlotId(rawInfo),
      petId: extractPetId(rawInfo),
      hungerPct: hunger.pct,
      hungerValue: hunger.value,
      hungerMax: hunger.max,
      hungerRaw: hunger.raw,
      name: extractName(rawInfo),
      species,
      targetScale,
      mutations: extractMutations(rawInfo),
      abilities: extractAbilities(rawInfo),
      chargedAbilityId: extractChargedAbilityId(rawInfo),
      xp,
      level,
      levelRaw,
      strength,
      position: extractPosition(rawInfo),
      updatedAt: now,
      raw: entry,
    };

    // Calculate level from XP if not available from Jotai
    if (petInfo.level == null && petInfo.xp != null && petInfo.petId) {
      // Record XP for rate tracking
      recordPetXP(petInfo);

      // Estimate level from XP gain rate
      const levelEstimate = estimatePetLevel(petInfo);
      if (levelEstimate.currentLevel != null) {
        petInfo.level = levelEstimate.currentLevel;
      }
    }

    infos.push(petInfo);
  });

  return infos.sort((a, b) => a.slotIndex - b.slotIndex);
}

export async function startPetInfoStore(): Promise<void> {
  if (unsubscribe || initializing) return;
  initializing = true;
  diag.register('Waiting for activePetSlots (registry)');
  try {
    const unsub = await subscribeAtomValue('activePetSlots', (value) => {
      lastRawValue = value;
      cachedInfos = normalizePetInfos(value);
      notify();
    });
    if (!unsub) {
      diag.warn('QPM-STORE-002', { atom: 'activePetSlots (registry)' });
      throw new Error('activePetSlots atom not resolved');
    }
    unsubscribe = unsub;

    // Re-normalize once catalogs load so strength/level calculations
    // (which depend on petCatalog maxScale/hoursToMature) get correct values.
    if (!catalogReadyHooked && !areCatalogsReady()) {
      catalogReadyHooked = true;
      onCatalogsReady(() => {
        if (lastRawValue != null) {
          cachedInfos = normalizePetInfos(lastRawValue);
          notify();
        }
      });
    }

    clearStartRetry();
  } catch (error) {
    diag.warn('QPM-STORE-001', { phase: 'startPetInfoStore' }, error);
    scheduleStartRetry();
  } finally {
    initializing = false;
  }
}

export function stopPetInfoStore(): void {
  try {
    unsubscribe?.();
  } catch {
    // noop
  }
  unsubscribe = null;
  cachedInfos = [];
  lastRawValue = null;
  petInfosAtomRef = null;
  catalogReadyHooked = false;
  firstAtomValueSeen = false;
  lastPublishedCount = -1;
  lastNotifySignature = null;
  clearStartRetry();
}

/**
 * Debug function to get current active pet data
 * Can be called from browser console via window.QPM.debugPets()
 */
export function getActivePetsDebug(): ActivePetInfo[] {
  return cachedInfos;
}

export function getActivePetInfos(): ActivePetInfo[] {
  return cachedInfos;
}

export function onActivePetInfos(
  callback: (infos: ActivePetInfo[]) => void,
  fireImmediately = true,
): () => void {
  listeners.add(callback);
  if (fireImmediately) {
    try {
      callback(cachedInfos);
    } catch (error) {
      log('⚠️ Pet info immediate callback failed', error);
    }
  }
  return () => {
    listeners.delete(callback);
  };
}
