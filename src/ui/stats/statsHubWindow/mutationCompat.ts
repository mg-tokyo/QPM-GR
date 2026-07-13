// src/ui/statsHubWindow/mutationCompat.ts
// Mutation compatibility engine — faithfully models game's updateMutationList.ts.

import { resolveMutation } from '../../../utils/game/cropMultipliers';
import { BASE_WATER_MUTS, UPGRADED_WATER_MUTS, UPGRADED_DAWN_MUTS, UPGRADED_AMBER_MUTS, UPGRADED_ELECTRIC_MUTS } from './constants';
import type { TileEntry } from './types';

/** Resolve any display name or alias to its canonical lowercase name. */
export const normalizeCanonical = (m: string): string =>
  resolveMutation(m)?.name.toLowerCase() ?? m.toLowerCase();

/**
 * Alias-aware comparison: 'Dawnbound' matches 'Dawncharged', 'Amberlit' matches 'Ambershine', etc.
 */
export function mutsMatch(a: string, b: string): boolean {
  if (a.toLowerCase() === b.toLowerCase()) return true;
  const defA = resolveMutation(a);
  const defB = resolveMutation(b);
  return !!(defA && defB && defA.name === defB.name);
}

/**
 * Returns true if `mutationName` can be applied to a slot with `existingCanonical` mutations.
 * `existingCanonical` must be an array of canonical lowercase names.
 * Directly mirrors game's updateMutationList.ts switch/return logic.
 *
 * Key upgrade paths allowed by the game:
 *   Dawnlit → Dawnbound (Dawncharged replaces Dawnlit)
 *   Amberlit (Ambershine) → Amberbound (Ambercharged replaces Ambershine)
 *   Wet + Chilled → Frozen (adding either base water when the other exists upgrades to Frozen)
 */
export function canApplyMutation(mutationName: string, existingCanonical: string[]): boolean {
  const ml = normalizeCanonical(mutationName);
  if (existingCanonical.includes(ml)) return false; // Already has it

  switch (ml) {
    case 'wet':
    case 'chilled':
      // Blocked by Frozen, Thunderstruck, or Thundercharged (updateMutationList.ts:32-66)
      return !existingCanonical.includes('frozen')
        && !existingCanonical.includes('thunderstruck')
        && !existingCanonical.some((m) => UPGRADED_ELECTRIC_MUTS.has(m));
    case 'frozen':
      // Blocked by Thunderstruck, existing Frozen, or Thundercharged (updateMutationList.ts:68-79)
      return !existingCanonical.includes('thunderstruck')
        && !existingCanonical.includes('frozen')
        && !existingCanonical.some((m) => UPGRADED_ELECTRIC_MUTS.has(m));
    case 'thunderstruck':
      // Blocked by any water mutation or the upgraded electric mutation (updateMutationList.ts:87-101)
      return !existingCanonical.some((m) => BASE_WATER_MUTS.has(m) || UPGRADED_WATER_MUTS.has(m) || UPGRADED_ELECTRIC_MUTS.has(m));
    case 'thundercharged':
      // Blocked by water mutations; upgrade from Thunderstruck is allowed
      // (Thunderstruck will be replaced) — updateMutationList.ts:103-123
      return !existingCanonical.some((m) => BASE_WATER_MUTS.has(m) || UPGRADED_WATER_MUTS.has(m));
    case 'dawnlit':
    case 'ambershine':
      // Base sun/moon: blocked by ANY existing sun/moon (base or upgraded)
      return !existingCanonical.some(
        (m) => m === 'dawnlit' || m === 'ambershine' || UPGRADED_DAWN_MUTS.has(m) || UPGRADED_AMBER_MUTS.has(m),
      );
    case 'dawncharged':
      // Upgrade from Dawnlit is allowed (Dawnlit will be replaced).
      // Blocked by: any upgraded sun/moon, OR Ambershine (wrong sun/moon base).
      return (
        !existingCanonical.some((m) => UPGRADED_DAWN_MUTS.has(m) || UPGRADED_AMBER_MUTS.has(m)) &&
        !existingCanonical.includes('ambershine')
      );
    case 'ambercharged':
      // Upgrade from Ambershine is allowed (Ambershine will be replaced).
      // Blocked by: any upgraded sun/moon, OR Dawnlit (wrong sun/moon base).
      return (
        !existingCanonical.some((m) => UPGRADED_DAWN_MUTS.has(m) || UPGRADED_AMBER_MUTS.has(m)) &&
        !existingCanonical.includes('dawnlit')
      );
    case 'rainbow':
    case 'gold':
      // Only one growth mutation allowed
      return !existingCanonical.some((m) => m === 'rainbow' || m === 'gold');
    default:
      return true; // Unknown mutation — don't block
  }
}

/**
 * Simulate the resulting canonical mutation list after applying `toAdd` in sequence.
 * Handles game upgrade mechanics:
 *   Wet + Chilled → Frozen  (adding either base water when the other exists)
 *   Dawnlit → Dawnbound     (Dawncharged replaces Dawnlit)
 *   Amberlit → Amberbound   (Ambercharged replaces Ambershine)
 * Returns canonical lowercase names so they work with computeMutationMultiplier.
 */
export function simulateMutationsAfterApplying(existing: string[], toAdd: string[]): string[] {
  let state = existing.map(normalizeCanonical);
  for (const m of toAdd) {
    const ml = normalizeCanonical(m);
    if (!canApplyMutation(m, state)) continue;
    switch (ml) {
      case 'wet':
        state = state.includes('chilled')
          ? [...state.filter((e) => e !== 'chilled'), 'frozen']
          : [...state, 'wet'];
        break;
      case 'chilled':
        state = state.includes('wet')
          ? [...state.filter((e) => e !== 'wet'), 'frozen']
          : [...state, 'chilled'];
        break;
      case 'frozen':
        state = [...state.filter((e) => !BASE_WATER_MUTS.has(e)), 'frozen'];
        break;
      case 'dawncharged':
        state = [...state.filter((e) => e !== 'dawnlit'), 'dawncharged'];
        break;
      case 'ambercharged':
        state = [...state.filter((e) => e !== 'ambershine'), 'ambercharged'];
        break;
      case 'thundercharged':
        // Upgrades (replaces) Thunderstruck — never stacks with it
        state = [...state.filter((e) => e !== 'thunderstruck'), 'thundercharged'];
        break;
      default:
        state = [...state, ml];
    }
  }
  return state;
}

/**
 * Filter `toAdd` mutations to only those that can be applied to `existing` mutations.
 * Correctly handles upgrade paths (Dawnlit plant CAN receive Dawnbound; Chilled plant CAN receive Wet).
 * Resolves intra-`toAdd` conflicts sequentially (first compatible wins).
 */
export function filterCompatibleMutations(existing: string[], toAdd: string[]): string[] {
  let state = existing.map(normalizeCanonical);
  const result: string[] = [];
  for (const m of toAdd) {
    if (canApplyMutation(m, state)) {
      result.push(m);
      state = simulateMutationsAfterApplying(state, [m]);
    }
  }
  return result;
}

/**
 * Returns true if at least one slot in the tile can receive at least one of the selected mutations.
 * Used to determine whether a tile belongs in "Remaining" vs "Complete/N/A".
 */
export function isTileActionable(tile: TileEntry, selected: string[]): boolean {
  if (selected.length === 0) return false;
  return tile.slots.some((slot) => {
    const slotMissing = selected.filter((sel) => !slot.mutations.some((m) => mutsMatch(m, sel)));
    return filterCompatibleMutations(slot.mutations, slotMissing).length > 0;
  });
}

/**
 * Sum of fruitCount across all slots that can still receive at least one selected mutation.
 * For multi-harvest crops (e.g. Moonbinder with 3 pods), each actionable pod contributes its
 * fruitCount rather than the whole tile counting as 1.
 */
export function countActionableFruits(tiles: TileEntry[], selected: string[]): number {
  if (selected.length === 0) return tiles.reduce((s, t) => s + tileFruitCount(t), 0);
  let total = 0;
  for (const tile of tiles) {
    for (const slot of tile.slots) {
      const slotMissing = selected.filter((sel) => !slot.mutations.some((m) => mutsMatch(m, sel)));
      if (filterCompatibleMutations(slot.mutations, slotMissing).length > 0) {
        total += slot.fruitCount;
      }
    }
  }
  return total;
}

/** Fruitcount of slots that haven't yet reached max size. */
export function countMaxSizeRemainingFruits(tiles: TileEntry[]): number {
  return tiles.reduce(
    (s, t) => s + t.slots.reduce((ss, sl) => ss + (sl.sizePercent < 100 ? sl.fruitCount : 0), 0),
    0,
  );
}

// Re-export tileFruitCount here since mutationCompat needs it internally
function tileFruitCount(tile: TileEntry): number {
  return tile.slots.reduce((s, slot) => s + slot.fruitCount, 0);
}
