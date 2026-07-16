import type { FilterMode, SlotView } from './types';

function setEquals(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (const x of a) if (!b.includes(x)) return false;
  return true;
}

export function matchSlots(
  hoveredWeatherSet: readonly string[],
  filterChips: readonly string[],
  mode: FilterMode,
  slots: readonly SlotView[],
): readonly SlotView[] {
  if (filterChips.length === 0) {
    return slots.filter((s) => setEquals(s.weatherMutations, hoveredWeatherSet));
  }
  if (mode === 'any') {
    return slots.filter((s) => filterChips.some((c) => s.weatherMutations.includes(c)));
  }
  return slots.filter((s) => filterChips.every((c) => s.weatherMutations.includes(c)));
}
