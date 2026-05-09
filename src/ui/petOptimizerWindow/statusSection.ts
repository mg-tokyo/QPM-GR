import { getOptimizerConfig, type PetComparison } from '../../features/petOptimizer';
import { t } from '../../i18n';
import { getAbilityColor } from '../../utils/petCardRenderer';
import { createFamilyTeam } from './actions';
import { createPetCard } from './card';
import {
  buildFamilyGroups,
  deduplicateFamilyGroups,
  getTopTeamCandidatesForFamily,
  sortFamilyGroups,
} from './familyGroups';
import { showFamilySellModal } from './sell';
import type { StatusSectionId } from './types';

/** Convert a color string to rgba at the given alpha. Handles hex and falls back for gradients. */
function colorWithAlpha(color: string, alpha: number): string {
  if (color.includes('gradient') || color.includes('rgb')) {
    return `rgba(143,130,255,${alpha})`;
  }
  const hex = color.replace('#', '');
  if (hex.length >= 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return `rgba(${r},${g},${b},${alpha})`;
    }
  }
  return `rgba(143,130,255,${alpha})`;
}

function getStatusConfig(status: StatusSectionId): { icon: string; title: string; color: string; bgColor: string; desc: string } {
  const configs: Record<StatusSectionId, { icon: string; title: string; color: string; bgColor: string; desc: string }> = {
    review: {
      icon: '📝',
      title: t('feature.petOptimizer.reviewNeeded'),
      color: '#FFC107',
      bgColor: 'rgba(255, 193, 7, 0.1)',
      desc: t('feature.petOptimizer.reviewDesc'),
    },
    sell: {
      icon: '💰',
      title: t('feature.petOptimizer.sellPets'),
      color: '#f44336',
      bgColor: 'rgba(244, 67, 54, 0.1)',
      desc: t('feature.petOptimizer.sellDesc'),
    },
    keep: {
      icon: '✅',
      title: t('feature.petOptimizer.keepThese'),
      color: '#4CAF50',
      bgColor: 'rgba(76, 175, 80, 0.1)',
      desc: t('feature.petOptimizer.keepDesc'),
    },
  };
  return configs[status];
}

export function createStatusSection(
  status: StatusSectionId,
  comparisons: PetComparison[],
  allComparisons: PetComparison[],
  onAfterSell: () => void,
  onAfterKeep: () => void,
): HTMLElement {
  const sectionConfig = getStatusConfig(status);
  const optimizerConfig = getOptimizerConfig();

  // Build a map of familyKey → all comparisons in that family (across all statuses).
  // Used to populate the competitors compare button on keep-section cards.
  const familyPeersMap = new Map<string, PetComparison[]>();
  if (status === 'keep') {
    for (const comparison of allComparisons) {
      for (const rank of (comparison.familyRanks ?? [])) {
        let bucket = familyPeersMap.get(rank.familyKey);
        if (!bucket) {
          bucket = [];
          familyPeersMap.set(rank.familyKey, bucket);
        }
        bucket.push(comparison);
      }
    }
  }

  const section = document.createElement('div');
  section.style.cssText = `
    margin-bottom: 16px;
    background: ${sectionConfig.bgColor};
    border-radius: 8px;
    border: 1px solid ${sectionConfig.color}44;
    overflow: hidden;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    font-size: 15px;
    font-weight: 600;
    color: ${sectionConfig.color};
    padding: 12px 16px;
    background: rgba(0, 0, 0, 0.3);
    cursor: pointer;
    user-select: none;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: background 0.2s;
  `;

  const headerLeft = document.createElement('div');
  headerLeft.innerHTML = `
    <span style="font-size: 16px; margin-right: 8px;">${sectionConfig.icon}</span>
    <span>${sectionConfig.title}</span>
    <span style="
      background: ${sectionConfig.color}33;
      color: ${sectionConfig.color};
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 11px;
      margin-left: 8px;
      font-weight: 700;
    ">${comparisons.length}</span>
    <span style="font-size: 11px; color: #888; font-weight: normal; margin-left: 12px;">${sectionConfig.desc}</span>
  `;

  const collapseIcon = document.createElement('span');
  collapseIcon.textContent = '▼';
  collapseIcon.style.cssText = 'font-size: 10px; transition: transform 0.3s;';

  header.appendChild(headerLeft);
  header.appendChild(collapseIcon);
  section.appendChild(header);

  const petsContainer = document.createElement('div');
  petsContainer.style.cssText = 'padding: 12px; display: flex; flex-direction: column; gap: 8px;';

  const familyGroups = sortFamilyGroups(deduplicateFamilyGroups(buildFamilyGroups(comparisons)));
  for (const family of familyGroups) {
    const abilityColor = getAbilityColor(family.representativeAbilityName);
    const bgTint = colorWithAlpha(abilityColor.base, 0.06);
    const borderTint = colorWithAlpha(abilityColor.base, 0.18);

    // Wrapper groups header + cards visually
    const familyWrapper = document.createElement('div');
    familyWrapper.style.cssText = `
      margin-top: 8px;
      border-radius: 6px;
      background: ${bgTint};
      border: 1px solid ${borderTint};
      overflow: hidden;
    `;

    const abilityHeader = document.createElement('div');
    abilityHeader.dataset.familyKey = family.familyKey;
    abilityHeader.style.cssText = `
      padding: 6px 10px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    `;

    const headerMeta = document.createElement('div');
    headerMeta.style.cssText = 'display:flex; align-items:center; gap:8px;';

    // Colored dot matching the ability color
    const colorDot = document.createElement('span');
    const dotBg = abilityColor.base.includes('gradient') ? '#8f82ff' : abilityColor.base;
    colorDot.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotBg};flex-shrink:0;`;
    headerMeta.appendChild(colorDot);

    const headerTitle = document.createElement('span');
    headerTitle.style.cssText = 'font-size: 12px; font-weight: 600; color: #ccc;';
    headerTitle.textContent = family.pets.length === 1
      ? t('feature.petOptimizer.familyPetCount', { family: family.familyLabel, count: '1' })
      : t('feature.petOptimizer.familyPetCounts', { family: family.familyLabel, count: String(family.pets.length) });
    headerMeta.appendChild(headerTitle);

    abilityHeader.appendChild(headerMeta);

    const headerBtnGroup = document.createElement('div');
    headerBtnGroup.style.cssText = 'display:flex;gap:6px;align-items:center;';

    const topCandidates = getTopTeamCandidatesForFamily(family, comparisons);
    if (topCandidates.length > 0) {
      const createBtn = document.createElement('button');
      createBtn.type = 'button';
      createBtn.textContent = t('feature.petOptimizer.createTeam');
      createBtn.style.cssText = [
        'padding:4px 9px',
        'font-size:11px',
        'font-weight:600',
        'border-radius:6px',
        'border:1px solid rgba(143,130,255,0.45)',
        'background:linear-gradient(180deg, rgba(143,130,255,0.24), rgba(143,130,255,0.12))',
        'color:#e7e2ff',
        'cursor:pointer',
        'white-space:nowrap',
        'transition:all 0.15s ease',
      ].join(';');
      createBtn.title = t('feature.petOptimizer.createTeamTooltip', { family: family.familyLabel, count: String(topCandidates.length) });
      createBtn.addEventListener('mouseenter', () => {
        createBtn.style.borderColor = 'rgba(143,130,255,0.75)';
        createBtn.style.background = 'linear-gradient(180deg, rgba(143,130,255,0.35), rgba(143,130,255,0.20))';
      });
      createBtn.addEventListener('mouseleave', () => {
        createBtn.style.borderColor = 'rgba(143,130,255,0.45)';
        createBtn.style.background = 'linear-gradient(180deg, rgba(143,130,255,0.24), rgba(143,130,255,0.12))';
      });
      createBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        createFamilyTeam(family.familyLabel, topCandidates);
      });
      headerBtnGroup.appendChild(createBtn);
    }

    if (family.pets.length > 0) {
      const familySellBtn = document.createElement('button');
      familySellBtn.type = 'button';
      familySellBtn.textContent = t('feature.petOptimizer.sell');
      familySellBtn.style.cssText = [
        'padding:4px 9px',
        'font-size:11px',
        'font-weight:600',
        'border-radius:6px',
        'border:1px solid rgba(244,67,54,0.45)',
        'background:linear-gradient(180deg, rgba(244,67,54,0.24), rgba(244,67,54,0.12))',
        'color:#ff9e95',
        'cursor:pointer',
        'white-space:nowrap',
        'transition:all 0.15s ease',
      ].join(';');
      familySellBtn.title = t('feature.petOptimizer.sellFamilyTooltip', { family: family.familyLabel });
      familySellBtn.addEventListener('mouseenter', () => {
        familySellBtn.style.borderColor = 'rgba(244,67,54,0.75)';
        familySellBtn.style.background = 'linear-gradient(180deg, rgba(244,67,54,0.35), rgba(244,67,54,0.20))';
      });
      familySellBtn.addEventListener('mouseleave', () => {
        familySellBtn.style.borderColor = 'rgba(244,67,54,0.45)';
        familySellBtn.style.background = 'linear-gradient(180deg, rgba(244,67,54,0.24), rgba(244,67,54,0.12))';
      });
      familySellBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        showFamilySellModal(family.familyLabel, family.pets, onAfterSell);
      });
      headerBtnGroup.appendChild(familySellBtn);
    }

    abilityHeader.appendChild(headerBtnGroup);
    familyWrapper.appendChild(abilityHeader);

    const cardsArea = document.createElement('div');
    cardsArea.style.cssText = 'display:flex;flex-direction:column;gap:6px;padding:0 8px 8px 8px;';

    const visiblePets = status === 'keep'
      ? (optimizerConfig.showAllKeeps ? family.pets : family.pets.slice(0, 3))
      : family.pets;

    for (const entry of visiblePets) {
      const peers = status === 'keep'
        ? (familyPeersMap.get(entry.familyKey) ?? []).filter((p) => p.pet.id !== entry.comparison.pet.id)
        : undefined;
      const petCard = createPetCard(entry.comparison, entry, peers, onAfterSell, onAfterKeep);
      cardsArea.appendChild(petCard);
    }

    familyWrapper.appendChild(cardsArea);
    petsContainer.appendChild(familyWrapper);
  }

  section.appendChild(petsContainer);

  let isCollapsed = false;
  header.addEventListener('click', () => {
    isCollapsed = !isCollapsed;
    petsContainer.style.display = isCollapsed ? 'none' : 'flex';
    collapseIcon.style.transform = isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)';
  });
  header.addEventListener('mouseenter', () => {
    header.style.background = 'rgba(0, 0, 0, 0.4)';
  });
  header.addEventListener('mouseleave', () => {
    header.style.background = 'rgba(0, 0, 0, 0.3)';
  });

  return section;
}
