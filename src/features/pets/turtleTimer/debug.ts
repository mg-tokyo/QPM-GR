import type { GardenState } from '../../garden/bridge';
import { collectSlots, isEggSlot } from './slots';
import { config, latest } from './state';
import type { DebugEggDetectionOptions } from './types';

declare global {
  interface Window {
    debugEggDetection?: () => void;
  }
}

export function debugEggDetection(options?: DebugEggDetectionOptions): void {
  const includeBoardwalk = config.includeBoardwalk;
  const focusTileId = options?.focusTileId ?? null;
  const limit = Math.max(1, Math.floor(options?.limit ?? 10));
  const slots = collectSlots(latest.garden ?? null, includeBoardwalk);
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
    const garden = latest.garden ?? null;
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
