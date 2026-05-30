// src/ui/petPickerModal/comparePanel.ts
// Compare panel builder for the pet picker modal.

import { getAbilityDefinition, computeAbilityStats, computeEffectPerHour, type AbilityDefinition } from '../../data/petAbilities';
import { formatCoinsAbbreviated } from '../../features/economy/valueCalculator';
import { buildAbilityValuationContext, resolveDynamicAbilityEffect, type AbilityValuationContext } from '../../features/abilityValuation';
import { buildCompareCardViewModel } from '../comparePresentation';
import { calculateMaxStrength } from '../../store/xpTracker';
import type { PooledPet } from '../../types/petTeams';
import type { CompareStage } from '../../data/petCompareRules';
import type { CompareAbilityStats } from './types';
import { getSpriteSrc } from './helpers';
import { buildGroupedAbilityGroups, resolveSavedAbilityFilter } from './abilityFilter';

// ---------------------------------------------------------------------------
// Compare panel helper functions
// ---------------------------------------------------------------------------

export function isEventTriggeredAbility(definition: AbilityDefinition): boolean {
  return definition.trigger !== 'continuous';
}

export function getTriggerLabel(definition: AbilityDefinition): string {
  if (definition.trigger === 'harvest') return 'Harvest';
  if (definition.trigger === 'sellAllCrops') return 'Sell';
  if (definition.trigger === 'sellPet') return 'Pet Sell';
  if (definition.trigger === 'hatchEgg') return 'Hatch';
  return 'Trigger';
}

export function formatProcValue(definition: AbilityDefinition, valuePerProc: number): string {
  if (definition.effectUnit === 'minutes' || definition.category === 'plantGrowth' || definition.category === 'eggGrowth') {
    return `${valuePerProc.toFixed(1)} min/proc`;
  }
  if (definition.effectUnit === 'xp' || definition.category === 'xp') {
    return `${formatCoinsAbbreviated(valuePerProc)} xp/proc`;
  }
  return `${formatCoinsAbbreviated(valuePerProc)} $/proc`;
}

export function computePetAbilityStatsForCompare(
  pet: PooledPet,
  abilityId: string,
  valuationContext: AbilityValuationContext | null,
): CompareAbilityStats | null {
  const def = getAbilityDefinition(abilityId);
  if (!def) return null;
  const str = pet.strength ?? calculateMaxStrength(pet.targetScale, pet.species) ?? 100;
  const stats = computeAbilityStats(def, str);
  const isEventTriggered = isEventTriggeredAbility(def);
  const triggerChancePercent = Math.max(0, Math.min(100, stats.chancePerMinute));

  let valuePerProc = 0;
  if (valuationContext) {
    const dynamic = resolveDynamicAbilityEffect(def.id, valuationContext, str);
    if (dynamic && Number.isFinite(dynamic.effectPerProc) && dynamic.effectPerProc > 0) {
      valuePerProc = dynamic.effectPerProc;
    }
  }
  if (valuePerProc <= 0 && Number.isFinite(def.effectValuePerProc) && (def.effectValuePerProc ?? 0) > 0) {
    valuePerProc = def.effectValuePerProc!;
  }

  const impactPerHour = valuePerProc > 0
    ? valuePerProc * stats.procsPerHour
    : computeEffectPerHour(def, stats, str);
  const expectedValuePerTrigger = valuePerProc > 0 ? (triggerChancePercent / 100) * valuePerProc : 0;

  return {
    procsPerHour: stats.procsPerHour,
    impactPerHour,
    triggerChancePercent,
    valuePerProc,
    expectedValuePerTrigger,
    isEventTriggered,
    triggerLabel: getTriggerLabel(def),
  };
}

// ---------------------------------------------------------------------------
// Compare panel builder
// ---------------------------------------------------------------------------

export function buildComparePanel(
  petA: PooledPet,
  petB: PooledPet,
  container: HTMLElement,
  abilityFilter: string,
  stage: CompareStage,
  onFilterChange: (newFilter: string) => void,
): void {
  container.innerHTML = '';
  container.className = 'qpm-compare-panel';
  let valuationContext: AbilityValuationContext | null = null;
  try {
    valuationContext = buildAbilityValuationContext();
  } catch {
    valuationContext = null;
  }

  const quickFilterAbilityIds = [...new Set([...petA.abilities, ...petB.abilities])];
  const compareAbilitySelectionMap = new Map<string, Set<string>>();
  const compareAbilityGroups = buildGroupedAbilityGroups(quickFilterAbilityIds, 'compare');
  for (const option of compareAbilityGroups) {
    compareAbilitySelectionMap.set(option.value, option.abilityIds);
  }
  const resolvedAbilityFilter = resolveSavedAbilityFilter(
    abilityFilter,
    compareAbilitySelectionMap,
    'compare',
  );

  const sharedModel = buildCompareCardViewModel({
    petA,
    petB,
    abilityFilter: resolvedAbilityFilter,
    valuationContext,
    stage,
    poolForRank: [petA, petB],
    compactNumbers: true,
  });

  const sharedHeader = document.createElement('div');
  sharedHeader.className = 'qpm-compare__header';
  const sharedTitle = document.createElement('div');
  sharedTitle.className = 'qpm-compare__title';
  sharedTitle.textContent = `Compare • ${stage.toUpperCase()}`;
  sharedHeader.appendChild(sharedTitle);
  container.appendChild(sharedHeader);

  if (compareAbilityGroups.length > 0) {
    const filterSel = document.createElement('select');
    filterSel.className = 'qpm-compare__ability-filter qpm-select';
    const allOpt = document.createElement('option');
    allOpt.value = 'all';
    allOpt.textContent = 'All Abilities';
    filterSel.appendChild(allOpt);
    for (const group of compareAbilityGroups) {
      const opt = document.createElement('option');
      opt.value = group.value;
      opt.textContent = group.label;
      filterSel.appendChild(opt);
    }
    filterSel.value = resolvedAbilityFilter;
    filterSel.addEventListener('change', () => onFilterChange(filterSel.value));
    container.appendChild(filterSel);
  }

  const sprites = document.createElement('div');
  sprites.className = 'qpm-compare__sprites';
  const makeSpriteCol = (pet: PooledPet): HTMLElement => {
    const col = document.createElement('div');
    col.className = 'qpm-compare__sprite-col';
    const src = getSpriteSrc(pet.species, pet.mutations);
    if (src) {
      const img = document.createElement('img');
      img.className = 'qpm-compare__sprite';
      img.src = src;
      img.alt = pet.species;
      col.appendChild(img);
    } else {
      const placeholder = document.createElement('div');
      placeholder.className = 'qpm-compare__sprite-placeholder';
      placeholder.textContent = '•';
      col.appendChild(placeholder);
    }
    const name = document.createElement('div');
    name.className = 'qpm-compare__pet-name';
    name.textContent = pet.name || pet.species;
    col.appendChild(name);
    return col;
  };
  sprites.appendChild(makeSpriteCol(petA));
  const vs = document.createElement('div');
  vs.className = 'qpm-compare__vs';
  vs.textContent = 'vs';
  sprites.appendChild(vs);
  sprites.appendChild(makeSpriteCol(petB));
  container.appendChild(sprites);

  const addRow = (
    label: string,
    aText: string,
    bText: string,
    winner: 'a' | 'b' | 'tie' | 'review',
  ): void => {
    const row = document.createElement('div');
    row.className = 'qpm-compare__stat-row';
    const a = document.createElement('div');
    a.className = 'qpm-compare__stat-a';
    a.textContent = aText;
    const mid = document.createElement('div');
    mid.className = 'qpm-compare__stat-lbl';
    mid.textContent = label;
    const b = document.createElement('div');
    b.className = 'qpm-compare__stat-b';
    b.textContent = bText;
    if (winner === 'a') {
      a.classList.add('qpm-compare__winner');
      b.classList.add('qpm-compare__loser');
    } else if (winner === 'b') {
      b.classList.add('qpm-compare__winner');
      a.classList.add('qpm-compare__loser');
    }
    row.append(a, mid, b);
    container.appendChild(row);
  };

  const strA = petA.strength ?? calculateMaxStrength(petA.targetScale, petA.species) ?? 100;
  const strB = petB.strength ?? calculateMaxStrength(petB.targetScale, petB.species) ?? 100;
  addRow('STR', String(strA), String(strB), strA > strB ? 'a' : strB > strA ? 'b' : 'tie');

  if (!sharedModel) {
    addRow('Status', 'Review', 'Review', 'review');
    return;
  }

  for (const rowData of sharedModel.ledgerRows) {
    addRow(rowData.label, rowData.a, rowData.b, rowData.winner);
  }
}
