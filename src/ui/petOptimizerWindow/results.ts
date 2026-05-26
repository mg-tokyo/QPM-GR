import {
  getOptimizerConfig,
  type OptimizerAnalysis,
  type PetComparison,
} from '../../features/petOptimizer';
import { t } from '../../i18n';
import { createStatusSection } from './statusSection';
import type { StatusSectionId } from './types';
import { getGlobalState } from './windowState';

const STATUS_ORDER: StatusSectionId[] = ['review', 'sell', 'keep'];

function sortComparisons(comparisons: PetComparison[], config: ReturnType<typeof getOptimizerConfig>): void {
  comparisons.sort((a, b) => {
    switch (config.sortBy) {
      case 'strength':
        return config.sortDirection === 'desc'
          ? b.pet.strength - a.pet.strength
          : a.pet.strength - b.pet.strength;
      case 'maxStrength': {
        const aMax = a.pet.maxStrength || a.pet.strength;
        const bMax = b.pet.maxStrength || b.pet.strength;
        return config.sortDirection === 'desc' ? bMax - aMax : aMax - bMax;
      }
      case 'score':
        return config.sortDirection === 'desc'
          ? b.score.total - a.score.total
          : a.score.total - b.score.total;
      default:
        return 0;
    }
  });
}

export function renderResults(
  analysis: OptimizerAnalysis,
  onAfterSell: () => void,
  onAfterKeep: () => void,
): void {
  const globalState = getGlobalState();
  if (!globalState) return;

  try {
    const config = getOptimizerConfig();
    let comparisons = [...analysis.comparisons];

    if (config.selectedStrategy !== 'all') {
      const strategyPets = analysis.strategyPets.get(config.selectedStrategy);
      comparisons = strategyPets || [];
    }

    sortComparisons(comparisons, config);
    globalState.resultsContainer.innerHTML = '';

    if (comparisons.length === 0) {
      globalState.resultsContainer.innerHTML = `
        <div style="
          text-align: center;
          padding: 40px;
          color: #aaa;
          font-size: 14px;
        ">
          ${t('feature.petOptimizer.noFilterMatch')}
        </div>
      `;
      return;
    }

    const byStatus: Record<StatusSectionId, PetComparison[]> = {
      review: config.showReview ? comparisons.filter((comparison) => comparison.status === 'review') : [],
      sell: config.showSell ? comparisons.filter((comparison) => comparison.status === 'sell') : [],
      keep: comparisons.filter((comparison) => comparison.status === 'keep'),
    };

    const visibleCount = byStatus.review.length + byStatus.sell.length + byStatus.keep.length;
    if (visibleCount === 0) {
      globalState.resultsContainer.innerHTML = `
        <div style="
          text-align: center;
          padding: 40px;
          color: #aaa;
          font-size: 14px;
        ">
          ${t('feature.petOptimizer.noVisible')}
        </div>
      `;
      return;
    }

    for (const status of STATUS_ORDER) {
      const pets = byStatus[status];
      if (pets.length === 0) continue;
      const section = createStatusSection(status, pets, comparisons, onAfterSell, onAfterKeep);
      globalState.resultsContainer.appendChild(section);
    }
  } catch (error) {
    console.error('[Pet Optimizer] Error rendering results:', error);
    globalState.resultsContainer.innerHTML = `<div style="color: var(--qpm-danger);">Error rendering results: ${error instanceof Error ? error.message : 'Unknown'}</div>`;
  }
}
