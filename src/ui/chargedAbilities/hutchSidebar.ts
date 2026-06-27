// src/ui/chargedAbilities/hutchSidebar.ts
// Sidebar showing other charged-ability pets sitting in the hutch — informs
// swap decisions from the Charged Abilities window.

import { t } from '../../i18n';
import { getAllAbilityProjections, getAbilityProjection } from '../../features/chargedAbilities/abilities';
import { readAtomValueSync } from '../../core/atomRegistry';
import { buildPetIcon } from './cardHelpers';
import type { AbilityProjection } from '../../features/chargedAbilities/abilities/types';

const HUTCH_SIDEBAR_PET_ICON = 28;

interface HutchPetEntry {
  species: string;
  ability: AbilityProjection;
}

function extractSpecies(item: Record<string, unknown>): string | null {
  const raw = item.petSpecies ?? item.species ?? (item.pet as Record<string, unknown> | undefined)?.species;
  if (typeof raw === 'string' && raw.trim()) return raw;
  return null;
}

function extractAbilities(item: Record<string, unknown>): string[] {
  const sources: unknown[] = [
    item.abilities,
    (item.pet as Record<string, unknown> | undefined)?.abilities,
    (item.slot as Record<string, unknown> | undefined)?.abilities,
  ];
  const out: string[] = [];
  for (const source of sources) {
    if (Array.isArray(source)) {
      for (const entry of source) {
        if (typeof entry === 'string' && entry.trim()) out.push(entry);
      }
    }
  }
  return out;
}

function collectHutchEntries(): HutchPetEntry[] {
  const pets = readAtomValueSync('hutchPets');
  if (!Array.isArray(pets)) return [];

  const projections = getAllAbilityProjections();
  if (projections.length === 0) return [];

  const entries: HutchPetEntry[] = [];
  for (const raw of pets) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const species = extractSpecies(item);
    if (!species) continue;
    const abilities = extractAbilities(item);
    for (const abilityId of abilities) {
      const projection = getAbilityProjection(abilityId);
      if (projection) {
        entries.push({ species, ability: projection });
        break; // first matching player-activated ability per pet
      }
    }
  }
  return entries;
}

function groupEntries(entries: readonly HutchPetEntry[]): Array<{
  species: string;
  ability: AbilityProjection;
  count: number;
}> {
  const map = new Map<string, { species: string; ability: AbilityProjection; count: number }>();
  for (const e of entries) {
    const key = `${e.species}|${e.ability.abilityId}`;
    const bucket = map.get(key);
    if (bucket) bucket.count += 1;
    else map.set(key, { species: e.species, ability: e.ability, count: 1 });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export function renderHutchSidebar(): HTMLElement {
  const root = document.createElement('div');
  root.className = 'qpm-charged-abilities__hutch-sidebar';

  const heading = document.createElement('div');
  heading.className = 'qpm-charged-abilities__hutch-heading';
  heading.textContent = t('feature.chargedAbilities.window.hutchTitle');
  root.appendChild(heading);

  const groups = groupEntries(collectHutchEntries());
  if (groups.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'qpm-charged-abilities__hutch-empty';
    empty.textContent = t('feature.chargedAbilities.window.hutchEmpty');
    root.appendChild(empty);
    return root;
  }

  const list = document.createElement('div');
  list.className = 'qpm-charged-abilities__hutch-list';

  for (const group of groups) {
    const row = document.createElement('div');
    row.className = 'qpm-charged-abilities__hutch-row';

    row.appendChild(buildPetIcon(group.species, group.ability.accentColor, HUTCH_SIDEBAR_PET_ICON));

    const info = document.createElement('div');
    info.className = 'qpm-charged-abilities__hutch-info';
    const name = document.createElement('div');
    name.className = 'qpm-charged-abilities__hutch-name';
    name.textContent = `${group.species} × ${group.count}`;
    const abilityLabel = document.createElement('div');
    abilityLabel.className = 'qpm-charged-abilities__hutch-ability';
    abilityLabel.textContent = group.ability.abilityName;
    info.append(name, abilityLabel);
    row.appendChild(info);

    list.appendChild(row);
  }
  root.appendChild(list);
  return root;
}
