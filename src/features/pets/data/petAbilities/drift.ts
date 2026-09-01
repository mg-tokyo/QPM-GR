import { getAbilityDef, getAllAbilities } from '../../../../catalogs/gameCatalogs';
import { ABILITY_DEFINITIONS } from './definitions';
import { KNOWN_PARAMETER_KEYS } from './catalogAdapter';
import { isHighValueAbility, isLowValueAbility } from './classification';

const KNOWN_TRIGGERS = new Set(['continuous', 'hatchEgg', 'sellAllCrops', 'sellPet', 'harvest', 'playerActivated']);

export interface AbilityCatalogDrift {
  catalogOnly: string[];
  hardcodedOnly: string[];
  unknownParamKeys: string[];
  unknownTriggers: string[];
  unclassified: string[];
}

export function getAbilityCatalogDrift(): AbilityCatalogDrift {
  const catalogIds = getAllAbilities();
  const hardcoded = new Set(ABILITY_DEFINITIONS.map((d) => d.id));
  const catalogSet = new Set(catalogIds);
  const unknownParamKeys = new Set<string>();
  const unknownTriggers = new Set<string>();
  for (const id of catalogIds) {
    const entry = getAbilityDef(id);
    if (!entry) continue;
    if (typeof entry.trigger === 'string' && !KNOWN_TRIGGERS.has(entry.trigger)) unknownTriggers.add(entry.trigger);
    for (const key of Object.keys(entry.baseParameters ?? {})) {
      if (!KNOWN_PARAMETER_KEYS.has(key)) unknownParamKeys.add(key);
    }
  }
  return {
    catalogOnly: catalogIds.filter((id) => !hardcoded.has(id)),
    hardcodedOnly: [...hardcoded].filter((id) => !catalogSet.has(id)),
    unknownParamKeys: [...unknownParamKeys],
    unknownTriggers: [...unknownTriggers],
    unclassified: catalogIds.filter((id) => !isHighValueAbility(id) && !isLowValueAbility(id)),
  };
}
