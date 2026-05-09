import { dispatchCustomEventAll } from '../../core/pageContext';
import type { PetComparison } from '../../features/petOptimizer';
import { t } from '../../i18n';
import { createTeam, setTeamSlot } from '../../store/petTeams';
import { isWindowOpen } from '../modalWindow';
import { openPetPicker } from '../petPickerModal';

const PETS_WINDOW_ID = 'qpm-pets-window';
const PETS_WINDOW_SWITCH_TAB_EVENT = 'qpm:pets-window-switch-tab';

type PetsWindowTabId = 'manager' | 'feeding' | 'pet-optimizer';

interface PetsWindowSwitchDetail {
  tab: PetsWindowTabId;
  teamId?: string | null;
}

function dispatchPetsWindowSwitch(detail: PetsWindowSwitchDetail): void {
  dispatchCustomEventAll(PETS_WINDOW_SWITCH_TAB_EVENT, detail);
}

function ensureManagerView(teamId: string): void {
  const detail: PetsWindowSwitchDetail = { tab: 'manager', teamId };
  if (isWindowOpen(PETS_WINDOW_ID)) {
    dispatchPetsWindowSwitch(detail);
    return;
  }

  import('../petsWindow')
    .then(({ togglePetsWindow }) => {
      togglePetsWindow();
      requestAnimationFrame(() => dispatchPetsWindowSwitch(detail));
    })
    .catch((error) => {
      console.error('[Pet Optimizer] Failed to open Pets Manager window:', error);
    });
}

export function createFamilyTeam(familyLabel: string, pets: PetComparison[]): void {
  const topPets = pets.slice(0, 3);
  if (topPets.length === 0) return;

  const teamName = familyLabel.trim() || t('feature.petOptimizer.abilityTeam');
  const team = createTeam(teamName);

  for (let slotIndex = 0; slotIndex < 3; slotIndex += 1) {
    const petItemId = topPets[slotIndex]?.pet.itemId ?? null;
    setTeamSlot(team.id, slotIndex as 0 | 1 | 2, petItemId);
  }

  ensureManagerView(team.id);
}

export function openBetterPetsCompare(comparison: PetComparison): void {
  const current = comparison.pet;
  const better = comparison.betterAlternatives;
  if (!current || better.length === 0) return;

  const allowedItemIds = new Set<string>([
    current.itemId || current.id,
    ...better.map((pet) => pet.itemId || pet.id),
  ]);

  const preselected = [current.itemId || current.id]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  const compareTitle = comparison.decisionFamilyLabel
    ? t('feature.petOptimizer.compareBetterFamily', { family: comparison.decisionFamilyLabel })
    : t('feature.petOptimizer.compareBetter');

  void openPetPicker({
    mode: 'compare_only',
    title: compareTitle,
    allowedItemIds,
    startInCompareMode: true,
    preselectedCompareItemIds: preselected,
    onSelect: () => {},
  });
}

export function openCompetitorsPetCompare(
  comparison: PetComparison,
  familyLabel: string,
  peers: PetComparison[],
): void {
  const current = comparison.pet;
  if (!current || peers.length === 0) return;

  const allowedItemIds = new Set<string>([
    current.itemId || current.id,
    ...peers.map((peer) => peer.pet.itemId || peer.pet.id),
  ]);

  const preselected = [current.itemId || current.id]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  void openPetPicker({
    mode: 'compare_only',
    title: t('feature.petOptimizer.familyCompetitors', { family: familyLabel }),
    allowedItemIds,
    startInCompareMode: true,
    preselectedCompareItemIds: preselected,
    onSelect: () => {},
  });
}
