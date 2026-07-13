import { log } from '../../../utils/logger';
import { SLOT_MUTATION_DEBUG_LIMIT } from './constants';
import { reminderState } from './state';
import type { MutationLetter, MutationStage, MutationStageProgress, PlantSlotState } from './types';

export function normalizePlantName(name: string): string {
  let normalized = name.toLowerCase().replace(/\+\d+$/, '').trim();
  // Strip " plant" so DOM name ("Lily") matches inventory name ("Lily Plant")
  if (normalized.endsWith(' plant')) {
    normalized = normalized.slice(0, -6).trim();
  }
  return normalized;
}

function coerceStringValue(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }
  return null;
}

function coerceNumberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

export function extractProgressFromObject(value: unknown, seen: WeakSet<object>): MutationStageProgress | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  if (seen.has(value as object)) {
    return null;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (const entry of value) {
      const progress = extractProgressFromObject(entry, seen);
      if (progress) {
        return progress;
      }
    }
    return null;
  }

  const obj = value as Record<string, unknown>;
  const candidatePairs: Array<[unknown, unknown]> = [
    [obj.complete, obj.total],
    [obj.completed, obj.total],
    [obj.completed, obj.goal],
    [obj.count, obj.total],
    [obj.count, obj.required],
    [obj.current, obj.max],
    [obj.value, obj.max],
  ];

  for (const [completeRaw, totalRaw] of candidatePairs) {
    const complete = coerceNumberValue(completeRaw);
    const total = coerceNumberValue(totalRaw);
    if (complete != null && total != null && total > 0 && complete >= 0) {
      return { complete, total };
    }
  }

  const nestedKeys = ['progress', 'state', 'status', 'data', 'info', 'details', 'counts'];
  for (const key of nestedKeys) {
    const nested = obj[key];
    if (!nested) continue;
    const progress = extractProgressFromObject(nested, seen);
    if (progress) {
      return progress;
    }
  }

  return null;
}

function normalizeMutationEntry(entry: unknown, seen: WeakSet<object> = new WeakSet()): string | null {
  if (typeof entry === 'string') {
    return entry;
  }
  if (typeof entry === 'number' && Number.isFinite(entry)) {
    return entry.toString();
  }
  if (!entry || typeof entry !== 'object') {
    return null;
  }

  if (seen.has(entry as object)) {
    return null;
  }
  seen.add(entry as object);

  const obj = entry as Record<string, unknown>;
  const candidateFields = ['name', 'displayName', 'display_name', 'mutationName', 'mutation', 'label', 'title', 'text', 'type', 'kind', 'state', 'status', 'key'];
  let text: string | null = null;
  for (const field of candidateFields) {
    const value = obj[field];
    const str = coerceStringValue(value);
    if (str) {
      text = str;
      break;
    }
  }

  if (!text) {
    const nestedCandidates = ['mutation', 'mut', 'data', 'info', 'details', 'entry', 'node', 'item'];
    for (const nestedKey of nestedCandidates) {
      const nested = obj[nestedKey];
      if (!nested) continue;
      const nestedText = normalizeMutationEntry(nested, seen);
      if (nestedText) {
        text = nestedText;
        break;
      }
    }
  }

  const progress = extractProgressFromObject(obj, seen);
  if (progress) {
    if (text) {
      if (!/\d+\s*\/\s*\d+/.test(text)) {
        text = `${text} ${progress.complete}/${progress.total}`;
      }
    } else {
      text = `${progress.complete}/${progress.total}`;
    }
  }

  return text;
}

function summarizeSlotForDebug(rawSlot: any): Record<string, unknown> {
  if (!rawSlot || typeof rawSlot !== 'object') {
    return {};
  }

  const slotRecord = rawSlot as Record<string, unknown>;
  const summary: Record<string, unknown> = {};
  const keys = Object.keys(slotRecord).slice(0, 10);

  for (const key of keys) {
    const value = slotRecord[key];
    if (value == null) continue;

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      summary[key] = value;
      continue;
    }

    if (Array.isArray(value)) {
      summary[key] = value.slice(0, 3).map((entry) => {
        if (typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
          return entry;
        }
        if (entry && typeof entry === 'object') {
          const nestedRecord = entry as Record<string, unknown>;
          const nestedKey = Object.keys(nestedRecord).find((candidate) => {
            const nestedValue = nestedRecord[candidate];
            return typeof nestedValue === 'string' || typeof nestedValue === 'number';
          });
          if (nestedKey) {
            return nestedRecord[nestedKey];
          }
          return Object.keys(nestedRecord).slice(0, 3);
        }
        return typeof entry;
      });
      continue;
    }

    if (typeof value === 'object') {
      const nestedRecord = value as Record<string, unknown>;
      const nestedSummary: Record<string, unknown> = {};
      for (const nestedKey of Object.keys(nestedRecord).slice(0, 5)) {
        const nestedValue = nestedRecord[nestedKey];
        if (typeof nestedValue === 'string' || typeof nestedValue === 'number' || typeof nestedValue === 'boolean') {
          nestedSummary[nestedKey] = nestedValue;
        }
      }
      if (Object.keys(nestedSummary).length > 0) {
        summary[key] = nestedSummary;
      }
    }
  }

  return summary;
}

export function extractMutationStringsFromSlot(rawSlot: any): string[] {
  if (!rawSlot || typeof rawSlot !== 'object') {
    return [];
  }

  const slotRecord = rawSlot as Record<string, unknown>;
  const results: string[] = [];
  const seen = new Set<string>();
  const push = (text: string | null): void => {
    if (!text) return;
    const normalized = text.trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    results.push(normalized);
  };

  const candidateCollections = [
    slotRecord['mutations'],
    slotRecord['mutationStates'],
    slotRecord['mutation_states'],
    slotRecord['mutationHistory'],
    slotRecord['appliedMutations'],
    slotRecord['pendingMutations'],
    slotRecord['mutationsList'],
  ];

  for (const collection of candidateCollections) {
    if (!collection) continue;
    if (Array.isArray(collection)) {
      for (const entry of collection) {
        push(normalizeMutationEntry(entry));
      }
      continue;
    }

    if (typeof collection === 'object') {
      for (const entry of Object.values(collection as Record<string, unknown>)) {
        push(normalizeMutationEntry(entry));
      }
    }
  }

  const candidateFields = [
    'mutation',
    'mutationName',
    'mutationType',
    'currentMutation',
    'activeMutation',
    'latestMutation',
  ];

  for (const field of candidateFields) {
    push(normalizeMutationEntry(slotRecord[field]));
  }

  if (results.length === 0) {
    const stageKeys: Array<[string, MutationStage]> = [
      ['wet', 'wet'],
      ['water', 'wet'],
      ['rain', 'wet'],
      ['freeze', 'wet'],
      ['frozen', 'wet'],
      ['chill', 'wet'],
      ['dawn', 'dawn'],
      ['amber', 'amber'],
    ];

    for (const [key, value] of Object.entries(slotRecord)) {
      const lowerKey = key.toLowerCase();
      const stageEntry = stageKeys.find(([needle]) => lowerKey.includes(needle));
      if (!stageEntry) continue;
      const [, stage] = stageEntry;
      const progress = extractProgressFromObject(value, new WeakSet<object>());
      if (progress) {
        push(`${stage} ${progress.complete}/${progress.total}`);
      }
    }
  }

  return results;
}

export function buildSlotStateFromInventorySlot(rawSlot: any): PlantSlotState {
  const mutations = extractMutationStringsFromSlot(rawSlot);
  if (mutations.length === 0 && reminderState.slotMutationDebugSamples < SLOT_MUTATION_DEBUG_LIMIT) {
    const slotKeys = rawSlot && typeof rawSlot === 'object' ? Object.keys(rawSlot).slice(0, 10) : [];
    log('[Mutations] Inventory slot missing mutation text', {
      keys: slotKeys,
      sample: summarizeSlotForDebug(rawSlot),
    });
    reminderState.slotMutationDebugSamples += 1;
  }
  return computeSlotStateFromMutationNames(mutations);
}

export function computeSlotStateFromMutationNames(mutations: string[]): PlantSlotState {
  const letters = new Set<MutationLetter>();

  let hasFrozen = false;
  let hasWet = false;
  let hasChilled = false;
  let hasDawnlit = false;
  let hasAmberlit = false;
  let hasDawnbound = false;
  let hasAmberbound = false;
  let hasRainbow = false;
  let hasGold = false;
  const unknownMutations: string[] = [];
  const progress: Partial<Record<MutationStage, MutationStageProgress>> = {};
  let wetOccurrences = 0;
  let dawnOccurrences = 0;
  let amberOccurrences = 0;

  const recordProgress = (stage: MutationStage, complete: number, total: number): void => {
    if (!Number.isFinite(complete) || !Number.isFinite(total)) return;
    if (total <= 0 || complete < 0) return;
    const existing = progress[stage];
    if (!existing || total > existing.total || (total === existing.total && complete > existing.complete)) {
      progress[stage] = { complete, total };
    }
  };

  for (const raw of mutations) {
    const normalized = String(raw ?? '').toLowerCase();

    const frozenLike = normalized.includes('frozen') || normalized.includes('freeze');
    if (frozenLike) {
      hasFrozen = true;
      letters.add('F');
    }

    const wetLike = normalized.includes('wet');
    if (wetLike) {
      hasWet = true;
      letters.add('W');
    }

    const chilledLike = normalized.includes('chill');
    if (chilledLike) {
      hasChilled = true;
      letters.add('C');
    }

    if (frozenLike || wetLike || chilledLike) {
      wetOccurrences += 1;
    }

    const isDawnbound = normalized.includes('dawnbound');
    if (isDawnbound) {
      hasDawnbound = true;
      letters.add('D');
    }

    const isAmberbound = normalized.includes('amberbound');
    if (isAmberbound) {
      hasAmberbound = true;
      letters.add('A');
    }

    const dawnLike = (normalized.includes('dawnlit') || normalized.includes('dawnlight') || normalized.includes('dawn')) && !isDawnbound;
    if (dawnLike) {
      hasDawnlit = true;
      letters.add('D');
    }

    if (dawnLike || isDawnbound) {
      dawnOccurrences += 1;
    }

    const amberLike = (normalized.includes('amberlit') || normalized.includes('amberlight') || normalized.includes('amber')) && !isAmberbound;
    if (amberLike) {
      hasAmberlit = true;
      letters.add('A');
    }

    if (amberLike || isAmberbound) {
      amberOccurrences += 1;
    }

    const rainbowLike = normalized.includes('rainbow');
    if (rainbowLike) {
      hasRainbow = true;
      letters.add('R');
    }

    const goldLike = normalized.includes('gold');
    if (goldLike) {
      hasGold = true;
      letters.add('G');
    }

    const isKnown = frozenLike || wetLike || chilledLike || isDawnbound || isAmberbound || dawnLike || amberLike || rainbowLike || goldLike;
    if (!isKnown && raw && typeof raw === 'string') {
      unknownMutations.push(raw);
    }

    const progressMatch = normalized.match(/(\d+)\s*\/\s*(\d+)/);
    if (progressMatch) {
      const complete = Number.parseInt(progressMatch[1] ?? '0', 10);
      const total = Number.parseInt(progressMatch[2] ?? '0', 10);
      if (frozenLike || wetLike || chilledLike) {
        recordProgress('wet', complete, total);
      }
      if (dawnLike || isDawnbound) {
        recordProgress('dawn', complete, total);
      }
      if (amberLike || isAmberbound) {
        recordProgress('amber', complete, total);
      }
    }
  }

  const orderedLetters = Array.from(letters).sort();

  if (!progress.wet && wetOccurrences > 0) {
    progress.wet = { complete: wetOccurrences, total: wetOccurrences };
  }
  if (!progress.dawn && dawnOccurrences > 0) {
    progress.dawn = { complete: dawnOccurrences, total: dawnOccurrences };
  }
  if (!progress.amber && amberOccurrences > 0) {
    progress.amber = { complete: amberOccurrences, total: amberOccurrences };
  }

  return {
    letters: orderedLetters,
    hasFrozen,
    hasWet,
    hasChilled,
    hasDawnlit,
    hasAmberlit,
    hasDawnbound,
    hasAmberbound,
    hasRainbow,
    hasGold,
    unknownMutations,
    progress,
  };
}

export function cloneSlotState(slot: PlantSlotState): PlantSlotState {
  return {
    letters: [...slot.letters],
    hasFrozen: slot.hasFrozen,
    hasWet: slot.hasWet,
    hasChilled: slot.hasChilled,
    hasDawnlit: slot.hasDawnlit,
    hasAmberlit: slot.hasAmberlit,
    hasDawnbound: slot.hasDawnbound,
    hasAmberbound: slot.hasAmberbound,
    hasRainbow: slot.hasRainbow,
    hasGold: slot.hasGold,
    unknownMutations: [...(slot.unknownMutations ?? [])],
    progress: { ...(slot.progress ?? {}) },
  };
}
