import type { GardenSnapshot } from '../../garden/bridge';
import { FOCUS_KEY_SEPARATOR } from './constants';
import type { GardenSlotEstimate, TurtleTimerFocus } from './types';

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

export function isEggSlot(slot: GardenSlotEstimate): boolean {
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

export function collectSlots(snapshot: GardenSnapshot, includeBoardwalk: boolean): GardenSlotEstimate[] {
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

export function makeFocusKey(tileId: string | null, slotIndex: number | null): string | null {
  if (!tileId || slotIndex == null) {
    return null;
  }
  return `${tileId}${FOCUS_KEY_SEPARATOR}${slotIndex}`;
}

export function pickFocusSlot(
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
