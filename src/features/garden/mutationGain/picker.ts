// ALR-6.4: the picker's sections, one per game mutation family. A family that a catalog weather
// applies is titled by those weathers; the families no weather reaches share one "other" section.

import { getAllWeatherDefsSafe, getMutationGroupSafe, getMutationsSafe, type WeatherDefSafe } from '../../../utils/game/catalogHelpers';

export interface PickerWeather {
  name: string;
  spriteKey: string | null;
}

export interface PickerMutation {
  id: string;
  /** Name of the weather that applies it; null for combines, abilities and growth mutations. */
  weather: string | null;
}

export interface PickerSection {
  /** Empty for the shared section of families no weather applies. */
  weathers: PickerWeather[];
  mutations: PickerMutation[];
}

type WeatherInput = Pick<WeatherDefSafe, 'name' | 'spriteKey' | 'mutation'>;

const OTHER = '\u0000other';
const familyOf = (groupOf: (id: string) => string | null, id: string): string => groupOf(id) ?? `mutation:${id}`;

export function buildPickerSections(
  mutationIds: readonly string[],
  groupOf: (id: string) => string | null,
  weathers: readonly WeatherInput[],
): PickerSection[] {
  const known = new Set(mutationIds);
  const appliedBy = new Map<string, string>();
  const weathersByFamily = new Map<string, PickerWeather[]>();
  for (const w of weathers) {
    if (!w.mutation || !known.has(w.mutation)) continue;
    if (!appliedBy.has(w.mutation)) appliedBy.set(w.mutation, w.name);
    const family = familyOf(groupOf, w.mutation);
    const list = weathersByFamily.get(family) ?? [];
    if (!list.some((x) => x.name === w.name)) list.push({ name: w.name, spriteKey: w.spriteKey });
    weathersByFamily.set(family, list);
  }

  const sections = new Map<string, PickerSection>();
  for (const id of mutationIds) {
    const family = familyOf(groupOf, id);
    const familyWeathers = weathersByFamily.get(family);
    const key = familyWeathers ? family : OTHER;
    let section = sections.get(key);
    if (!section) {
      section = { weathers: familyWeathers ?? [], mutations: [] };
      sections.set(key, section);
    }
    section.mutations.push({ id, weather: appliedBy.get(id) ?? null });
  }
  return [...sections.values()];
}

/** Sections from the live catalogs; empty while the mutation catalog is absent. */
export function getMutationPickerSections(): PickerSection[] {
  return buildPickerSections(getMutationsSafe(), getMutationGroupSafe, getAllWeatherDefsSafe());
}
