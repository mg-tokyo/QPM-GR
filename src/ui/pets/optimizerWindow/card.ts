import {
  getOptimizerConfig,
  protectPet,
  unprotectPet,
  type PetComparison,
} from '../../../features/pets/optimizer';
import { getOptimizerAbilityFamilyInfo } from '../../../features/pets/compare';
import { t } from '../../../i18n';
import { getAbilityColor, normalizeAbilityName } from '../../../utils/petCardRenderer';
import { openBetterPetsCompare, openCompetitorsPetCompare } from './actions';
import { appendSellButton } from './sell';
import { getLocationIcon, getPetSprite, renderAbilitySquares } from './sprites';
import type { FamilyPetEntry } from './types';

function getRankColor(rank: number): string {
  if (rank === 1) return 'var(--qpm-gold)';
  if (rank <= 3) return 'var(--qpm-positive)';
  if (rank <= 6) return '#e8e0ff';
  return 'rgba(255,255,255,0.4)';
}

function buildFamilyRankMap(comparison: PetComparison): Map<string, number> {
  const map = new Map<string, number>();
  const ranks = comparison.familyRanks;
  if (!Array.isArray(ranks)) return map;
  for (const entry of ranks) {
    map.set(entry.familyKey, entry.rank);
  }
  return map;
}

function getAbilityFamilyKey(abilityId: string, abilityName: string): string | null {
  const info = getOptimizerAbilityFamilyInfo(abilityId, abilityName);
  return info?.exactFamilyKey?.trim().toLowerCase() ?? null;
}

function formatStrength(strength: number, maxStrength: number | null | undefined): string {
  if (!maxStrength || maxStrength <= strength) return t('feature.petOptimizer.strValue', { value: String(strength) });
  return t('feature.petOptimizer.strWithMax', { value: String(strength), max: String(maxStrength) });
}

function makeSmallButton(
  text: string,
  palette: { border: string; background: string; color: string },
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = text;
  btn.style.cssText = [
    'padding:3px 8px',
    'border-radius:5px',
    `border:1px solid ${palette.border}`,
    `background:${palette.background}`,
    `color:${palette.color}`,
    'font-size:10px',
    'font-weight:600',
    'cursor:pointer',
    'white-space:nowrap',
    'line-height:1',
    'transition:opacity 0.15s, filter 0.15s',
  ].join(';');
  btn.addEventListener('mouseenter', () => { btn.style.filter = 'brightness(1.15)'; });
  btn.addEventListener('mouseleave', () => { btn.style.filter = 'none'; });
  return btn;
}

function appendButtonRow(
  card: HTMLElement,
  comparison: PetComparison,
  familyEntry: FamilyPetEntry | undefined,
  familyPeers: PetComparison[] | undefined,
  onAfterSell: () => void,
  onAfterKeep: () => void,
): void {
  const isManuallyProtected = getOptimizerConfig().protectedPetIds.has(comparison.pet.id);
  const canKeepManually = comparison.status === 'sell' || comparison.status === 'review';
  const canReturnToOptimizer = comparison.status === 'keep' && isManuallyProtected;
  const showManualKeep = canKeepManually || canReturnToOptimizer;

  const hasRankContext = !!familyEntry && Number.isFinite(familyEntry.rank) && familyEntry.rank < Number.MAX_SAFE_INTEGER;
  const rankMetaLabel = hasRankContext && familyEntry?.totalCompetitors
    ? familyEntry.totalCompetitors === 1 ? t('feature.petOptimizer.competitor', { count: '1' }) : t('feature.petOptimizer.competitors', { count: String(familyEntry.totalCompetitors) })
    : null;
  const showCompetitors = comparison.status === 'keep' && !!rankMetaLabel && !!familyPeers && familyPeers.length > 0;

  const row = document.createElement('div');
  row.style.cssText = 'position:absolute;top:8px;right:8px;display:flex;gap:4px;z-index:6;';

  if (showCompetitors && familyEntry) {
    const btn = makeSmallButton(rankMetaLabel!, {
      border: 'rgba(143,130,255,0.4)',
      background: 'rgba(143,130,255,0.12)',
      color: '#d8d1ff',
    });
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      openCompetitorsPetCompare(comparison, familyEntry.familyLabel, familyPeers!);
    });
    row.appendChild(btn);
  }

  if (showManualKeep) {
    const isReturn = canReturnToOptimizer;
    const palette = isReturn
      ? { border: 'rgba(255,193,7,0.55)', background: 'rgba(255,193,7,0.16)', color: '#ffe08a' }
      : { border: 'rgba(76,175,80,0.55)', background: 'rgba(76,175,80,0.18)', color: '#9de6a8' };
    const btn = makeSmallButton(isReturn ? t('feature.petOptimizer.returnBtn') : t('feature.petOptimizer.keepBtn'), palette);
    btn.title = isReturn ? t('feature.petOptimizer.returnTooltip') : t('feature.petOptimizer.keepTooltip');
    btn.addEventListener('click', (event) => {
      event.stopPropagation();
      btn.disabled = true;
      btn.style.opacity = '0.6';
      btn.style.pointerEvents = 'none';
      try {
        if (isReturn) { unprotectPet(comparison.pet.id); }
        else { protectPet(comparison.pet.id); }
        onAfterKeep();
      } catch (error) {
        console.error('[Pet Optimizer] Failed to update manual keep status:', error);
        btn.disabled = false;
        btn.style.opacity = '1';
        btn.style.pointerEvents = 'auto';
      }
    });
    row.appendChild(btn);
  }

  // Sell button
  appendSellButton(row, comparison, onAfterSell);

  card.appendChild(row);
}

export function createPetCard(
  comparison: PetComparison,
  familyEntry: FamilyPetEntry | undefined,
  familyPeers: PetComparison[] | undefined,
  onAfterSell: () => void,
  onAfterKeep: () => void,
): HTMLElement {
  const { pet, score, status, reason, betterAlternatives, decisionFamilyLabel } = comparison;

  const card = document.createElement('div');
  card.style.cssText = `
    background: var(--qpm-surface-2);
    border-radius: 8px;
    padding: 14px;
    border: 1px solid var(--qpm-border);
    transition: all 0.2s;
    position: relative;
  `;

  card.addEventListener('mouseenter', () => {
    card.style.borderColor = 'var(--qpm-accent-subtle)';
    card.style.transform = 'translateX(4px)';
  });
  card.addEventListener('mouseleave', () => {
    card.style.borderColor = 'var(--qpm-border)';
    card.style.transform = 'translateX(0)';
  });

  const sprite = getPetSprite(pet.species, pet.hasRainbow, pet.hasGold);
  const betterPetsHeading = decisionFamilyLabel ? t('feature.petOptimizer.betterFamilyPets', { family: decisionFamilyLabel }) : t('feature.petOptimizer.betterPets');

  // Build the title line: name + optional species subtitle + location icon
  const displayName = pet.name || pet.species;
  const showSpeciesSubtitle = pet.name && pet.species !== pet.name;

  // Build ability-to-rank map for rank badges
  const familyRankMap = buildFamilyRankMap(comparison);

  card.innerHTML = `
    <div style="display: flex; gap: 10px; align-items: start;">
      <div style="flex-shrink: 0; display: flex; align-items: center; gap: 3px;">
        ${renderAbilitySquares(pet.abilities, 10)}
        <div style="
          width: 48px;
          height: 48px;
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          ${sprite ? `
            <img src="${sprite}" alt="${pet.species}" style="
              width: 100%;
              height: 100%;
              object-fit: contain;
              image-rendering: pixelated;
            ">
          ` : `
            <span style="font-size: 18px; color: #666;">\u2022</span>
          `}
        </div>
      </div>

      <div style="flex: 1; min-width: 0;">
        <div style="display: flex; align-items: center; gap: 6px; margin-bottom: 6px; flex-wrap: wrap;">
          <span style="font-size: 14px; font-weight: 600; color: #fff;">${displayName}</span>
          ${showSpeciesSubtitle ? `<span style="font-size: 12px; color: #666;">${pet.species}</span>` : ''}
          <span style="font-size: 12px; color: #888;">${formatStrength(pet.strength, pet.maxStrength)}</span>
          <span data-location-icon style="display:flex;align-items:center;"></span>
        </div>

        <div data-ability-pills style="display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px;">
          ${pet.abilities.map((ability, idx) => {
            const normalizedName = normalizeAbilityName(ability);
            const color = getAbilityColor(ability);
            const abilityId = pet.abilityIds[idx] ?? ability;
            const fKey = getAbilityFamilyKey(abilityId, ability);
            const rank = fKey ? familyRankMap.get(fKey) : undefined;

            let background: string;
            let textColor: string;
            const abilityLower = ability.toLowerCase().replace(/\s+/g, '');
            const isRainbowGranter = abilityLower.includes('rainbowgranter') || abilityLower.includes('raingranter');
            const isGoldGranter = abilityLower.includes('goldgranter');

            if (isRainbowGranter) {
              background = 'linear-gradient(135deg, #ff0080, #ff8c00, #40e0d0, #8a2be2, #ff0080)';
              textColor = '#fff';
            } else if (isGoldGranter) {
              background = 'linear-gradient(135deg, #ffd700, #ffed4e, #ffd700)';
              textColor = '#000';
            } else {
              background = color.base;
              textColor = color.text;
            }

            const rankBadge = (rank != null && Number.isFinite(rank) && rank < Number.MAX_SAFE_INTEGER)
              ? `<span style="
                  position:absolute;top:-7px;right:-6px;
                  font-size:12px;font-weight:800;
                  color:${getRankColor(rank)};
                  transform:rotate(12deg);
                  font-variant-numeric:tabular-nums;
                  text-shadow:-1px -1px 0 rgba(0,0,0,0.9),1px -1px 0 rgba(0,0,0,0.9),-1px 1px 0 rgba(0,0,0,0.9),1px 1px 0 rgba(0,0,0,0.9),0 0 4px rgba(0,0,0,0.6);
                  pointer-events:none;
                ">#${rank}</span>`
              : '';

            return `
              <span style="
                position: relative;
                padding: 4px 10px;
                border-radius: 4px;
                font-size: 12px;
                background: ${background};
                ${(isRainbowGranter || isGoldGranter) ? 'background-size: 200% 200%; animation: shimmer 3s ease infinite;' : ''}
                color: ${textColor};
                border: 1px solid ${(isRainbowGranter || isGoldGranter) ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.3)'};
                font-weight: ${(isRainbowGranter || isGoldGranter) ? '600' : '500'};
              ">${normalizedName}${rankBadge}</span>
            `;
          }).join('')}
        </div>

        <div style="display:flex;align-items:baseline;gap:6px;">
          <div style="flex:1;font-size: 12px; color: #ccc;">
            ${reason}
          </div>
          <div style="flex-shrink:0;display:flex;align-items:center;gap:4px;">
            <span style="font-size:10px;color:var(--qpm-text-muted);">${t('feature.petOptimizer.score')}</span>
            <span style="font-size:14px;font-weight:bold;color:var(--qpm-credits);">${Math.round(score.total - score.granterBonus)}</span>
            ${score.granterBonus > 0 ? `
              <span style="
                font-size:12px;font-weight:600;
                ${score.granterType === 'rainbow'
                  ? 'background: linear-gradient(135deg, #ff0080, #ff8c00, #40e0d0, #8a2be2, #ff0080); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;'
                  : 'background: linear-gradient(135deg, #ffd700, #ffed4e, #ffd700); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;'
                }
              ">+${Math.round(score.granterBonus)}</span>
            ` : ''}
          </div>
        </div>

        ${betterAlternatives.length > 0 ? `
          <div style="font-size: 12px; color: #888; margin-top: 6px; padding-top: 6px; border-top: 1px solid var(--qpm-border);">
            <button
              type="button"
              data-better-compare="true"
              style="
                border: 1px solid rgba(143,130,255,0.4);
                background: rgba(143,130,255,0.12);
                color: #d8d1ff;
                border-radius: 5px;
                font-size: 10px;
                font-weight: 600;
                padding: 3px 8px;
                cursor: pointer;
                margin-right: 6px;
              "
            >${betterPetsHeading}</button>
            ${betterAlternatives.map((betterPet) =>
              `${betterPet.name || betterPet.species} (STR ${betterPet.strength}${betterPet.maxStrength ? `/${betterPet.maxStrength}` : ''})`,
            ).join(', ')}
          </div>
        ` : ''}
      </div>
    </div>
  `;

  // Insert location icon (DOM element, not innerHTML)
  const locationSlot = card.querySelector<HTMLElement>('[data-location-icon]');
  if (locationSlot) {
    locationSlot.appendChild(getLocationIcon(pet.location));
  }

  // Build the button row (sell, keep/return, competitors)
  appendButtonRow(card, comparison, familyEntry, familyPeers, onAfterSell, onAfterKeep);

  const compareBtn = card.querySelector<HTMLButtonElement>('button[data-better-compare="true"]');
  if (compareBtn) {
    compareBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      openBetterPetsCompare(comparison);
    });
  }

  return card;
}
