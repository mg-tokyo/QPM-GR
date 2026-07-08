// Watches pet ability triggers (myPetSlotInfosAtom) to expose live proc history.

import { getAtomByLabel, subscribeAtom } from '../core/jotaiBridge';
import { log } from '../utils/logger';

const ABILITY_SOURCE_LABEL = 'myPetSlotInfosAtom';
const HISTORY_LIMIT = 30;
const HISTORY_WINDOW_MS = 1000 * 60 * 60 * 6; // keep roughly six hours of events per ability
const MAX_CANONICAL_HISTORIES = 500;

type UnknownMap = Record<string, unknown>;

type RawAbilityEntry = Record<string, unknown> & {
  lastAbilityTrigger?: UnknownMap | null;
  petId?: unknown;
  slotId?: unknown;
  slot?: UnknownMap | null;
  pet?: UnknownMap | null;
  position?: UnknownMap | null;
};

type ParsedTrigger = {
  sourceKey: string;
  abilityId: string;
  performedAt: number;
  data: unknown;
  petId: string | null;
  slotId: string | null;
  slotIndex: number | null;
  position: UnknownMap | null;
};

export interface AbilityEvent {
  abilityId: string;
  performedAt: number;
  data: unknown;
  position: UnknownMap | null;
}

export interface AbilityHistory {
  abilityId: string;
  petId: string | null;
  slotId: string | null;
  slotIndex: number | null;
  events: AbilityEvent[];
  lastPerformedAt: number;
  lookupKeys: Set<string>;
}

const canonicalHistories = new Map<string, AbilityHistory>();
const lookupHistories = new Map<string, AbilityHistory>();
const listeners = new Set<(snapshot: ReadonlyMap<string, AbilityHistory>) => void>();

let started = false;
let unsubscribe: (() => void) | null = null;

const toStringOrNull = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const parseSlotIndex = (...values: unknown[]): number | null => {
  for (const candidate of values) {
    const numeric = toNumberOrNull(candidate);
    if (numeric == null) continue;
    if (!Number.isFinite(numeric)) continue;
    return Math.max(0, Math.round(numeric));
  }
  return null;
};

const pruneHistoryEvents = (history: AbilityHistory) => {
  const cutoff = Date.now() - HISTORY_WINDOW_MS;
  if (history.events.length > HISTORY_LIMIT || (history.events[0]?.performedAt ?? 0) < cutoff) {
    history.events = history.events.filter((event) => event.performedAt >= cutoff).slice(-HISTORY_LIMIT);
  }
};

const buildLookupKeys = (parsed: ParsedTrigger): string[] => {
  const keys: string[] = [];
  if (parsed.petId) keys.push(`petId:${parsed.petId}`);
  if (parsed.slotId) keys.push(`slotId:${parsed.slotId}`);
  if (parsed.slotIndex != null) keys.push(`slotIndex:${parsed.slotIndex}`);
  keys.push(`source:${parsed.sourceKey}`);
  return Array.from(new Set(keys)).map((key) => `${key}::${parsed.abilityId}`);
};

const notify = () => {
  if (!listeners.size) return;
  const snapshot = new Map(lookupHistories);
  for (const listener of listeners) {
    try {
      listener(snapshot);
    } catch (error) {
      log('⚠️ Ability history listener failed', error);
    }
  }
};

const toUnknownMap = (value: unknown): UnknownMap | null => {
  return value && typeof value === 'object' ? (value as UnknownMap) : null;
};

const parseAbilityEntry = (sourceKey: string, value: unknown): ParsedTrigger | null => {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const entry = value as RawAbilityEntry;
  const trigger = toUnknownMap(entry.lastAbilityTrigger);
  if (!trigger) {
    return null;
  }

  const abilityId = toStringOrNull(trigger.abilityId);
  if (!abilityId) {
    return null;
  }

  const performedAt = toNumberOrNull(trigger.performedAt);
  if (performedAt == null || performedAt <= 0) {
    return null;
  }

  const slot = toUnknownMap(entry.slot) ?? toUnknownMap(entry.pet?.slot);
  const pet = toUnknownMap(entry.pet);

  const petId = toStringOrNull(entry.petId ?? pet?.id ?? entry.slotId ?? sourceKey);
  const slotId = toStringOrNull(entry.slotId ?? slot?.id ?? pet?.slotId);
  const slotIndex = parseSlotIndex(
    entry.slotIndex,
    slot?.slotIndex,
    slot?.index,
    entry.index,
    trigger.slotIndex,
  );

  const position = toUnknownMap(entry.position) ?? toUnknownMap(trigger.position) ?? null;

  return {
    sourceKey,
    abilityId,
    performedAt,
    data: trigger.data ?? null,
    petId,
    slotId,
    slotIndex,
    position,
  };
};

const evictOldestCanonicalHistory = () => {
  const iter = canonicalHistories.entries();
  const next = iter.next();
  if (next.done) return;
  const [oldestKey, oldestHistory] = next.value;
  for (const lookupKey of oldestHistory.lookupKeys) {
    if (lookupHistories.get(lookupKey) === oldestHistory) {
      lookupHistories.delete(lookupKey);
    }
  }
  canonicalHistories.delete(oldestKey);
};

const upsertHistory = (parsed: ParsedTrigger): boolean => {
  const canonicalKey = `source:${parsed.sourceKey}::${parsed.abilityId}`;
  let history = canonicalHistories.get(canonicalKey);
  if (!history) {
    history = {
      abilityId: parsed.abilityId,
      petId: parsed.petId,
      slotId: parsed.slotId,
      slotIndex: parsed.slotIndex,
      events: [],
      lastPerformedAt: 0,
      lookupKeys: new Set(),
    };
    canonicalHistories.set(canonicalKey, history);
    while (canonicalHistories.size > MAX_CANONICAL_HISTORIES) {
      evictOldestCanonicalHistory();
    }
  }

  if (parsed.performedAt <= history.lastPerformedAt) {
    return false;
  }

  history.petId = history.petId ?? parsed.petId;
  history.slotId = history.slotId ?? parsed.slotId;
  history.slotIndex = history.slotIndex ?? parsed.slotIndex;

  const event: AbilityEvent = {
    abilityId: parsed.abilityId,
    performedAt: parsed.performedAt,
    data: parsed.data,
    position: parsed.position,
  };

  history.events.push(event);
  history.lastPerformedAt = parsed.performedAt;
  pruneHistoryEvents(history);

  const lookupKeys = buildLookupKeys(parsed);
  for (const key of lookupKeys) {
    history.lookupKeys.add(key);
    lookupHistories.set(key, history);
  }

  return true;
};

const processAbilitySource = (source: unknown) => {
  if (!source || typeof source !== 'object') {
    return;
  }
  const entries = source as Record<string, unknown>;
  let updated = false;
  for (const [key, value] of Object.entries(entries)) {
    const parsed = parseAbilityEntry(key, value);
    if (!parsed) {
      continue;
    }
    const didUpdate = upsertHistory(parsed);
    if (didUpdate) {
      updated = true;
    }
  }
  if (updated) {
    notify();
  }
};

export async function startAbilityTriggerStore(): Promise<void> {
  if (started) return;
  started = true;

  const atom = getAtomByLabel(ABILITY_SOURCE_LABEL);
  if (!atom) {
    started = false;
    throw new Error('myPetSlotInfosAtom not available');
  }

  try {
    unsubscribe = await subscribeAtom(atom, (value) => {
      try {
        processAbilitySource(value);
      } catch (error) {
        log('⚠️ Failed processing ability triggers', error);
      }
    });
  } catch (error) {
    started = false;
    unsubscribe = null;
    throw error;
  }
}

export function stopAbilityTriggerStore(): void {
  unsubscribe?.();
  unsubscribe = null;
  started = false;
}

const buildCandidateLookupKeys = (abilityId: string, candidates: (string | null | undefined)[]): string[] => {
  const keys: string[] = [];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const normalized = candidate.trim();
    if (!normalized) continue;
    keys.push(`petId:${normalized}::${abilityId}`);
    keys.push(`slotId:${normalized}::${abilityId}`);
    keys.push(`source:${normalized}::${abilityId}`);
  }
  return keys;
};

const buildCandidateIndexKeys = (abilityId: string, slotIndex: number | null | undefined): string[] => {
  if (slotIndex == null || !Number.isFinite(slotIndex)) return [];
  const normalized = Math.max(0, Math.round(slotIndex));
  return [`slotIndex:${normalized}::${abilityId}`];
};

export function findAbilityHistoryForIdentifiers(
  abilityId: string,
  identifiers: {
    petId?: string | null;
    slotId?: string | null;
    slotIndex?: number | null;
    fallbackKeys?: string[];
  },
): AbilityHistory | null {
  const lookupCandidates = new Set<string>();
  const { petId, slotId, slotIndex, fallbackKeys = [] } = identifiers;
  buildCandidateLookupKeys(abilityId, [petId, slotId, ...fallbackKeys]).forEach((key) => lookupCandidates.add(key));
  buildCandidateIndexKeys(abilityId, slotIndex).forEach((key) => lookupCandidates.add(key));

  for (const key of lookupCandidates) {
    const history = lookupHistories.get(key);
    if (history) {
      return history;
    }
  }
  return null;
}

export function onAbilityHistoryUpdate(cb: (snapshot: ReadonlyMap<string, AbilityHistory>) => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function getAbilityHistorySnapshot(): ReadonlyMap<string, AbilityHistory> {
  return new Map(lookupHistories);
}

export function isAbilityTriggerStoreStarted(): boolean {
  return started;
}