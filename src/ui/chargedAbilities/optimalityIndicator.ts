// src/ui/chargedAbilities/optimalityIndicator.ts
// Pill ("87% optimal" with hover tooltip) for sub-100% optimality, or a
// shimmering "$ $ $" stamp for 100%. Coloured per ability yield kind.

import { t } from '../../i18n';
import type { OptimalityResult } from '../../features/chargedAbilities/types';
import type { AbilityProjection } from '../../features/chargedAbilities/abilities/types';
import type { TilePosition } from '../../features/garden/tileRadius';

function directionText(playerPos: TilePosition, target: TilePosition): {
  distance: number;
  direction: string;
} {
  const dx = target.x - playerPos.x;
  const dy = target.y - playerPos.y;
  const distance = Math.max(Math.abs(dx), Math.abs(dy));
  if (dx === 0 && dy === 0) return { distance: 0, direction: '·' };
  const ns = dy < 0 ? 'N' : dy > 0 ? 'S' : '';
  const ew = dx < 0 ? 'W' : dx > 0 ? 'E' : '';
  return { distance, direction: `${ns}${ew}` };
}

function formatYield(kind: 'coin' | 'capsule', amount: number): string {
  if (kind === 'coin') return t('feature.chargedAbilities.gainCoin', { value: amount });
  return t('feature.chargedAbilities.gainCapsule', { count: amount });
}

export function renderOptimalityIndicator(
  result: OptimalityResult,
  ability: AbilityProjection,
  playerPos: TilePosition | null,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'qpm-charged-abilities__optimal';

  if (result.pct >= 100) {
    const full = document.createElement('span');
    full.className = 'qpm-charged-abilities__optimal-full';
    full.classList.add(
      ability.yieldKind === 'coin'
        ? 'qpm-charged-abilities__optimal-full--coin'
        : 'qpm-charged-abilities__optimal-full--capsule',
    );
    full.textContent = t('feature.chargedAbilities.optimal.full');
    wrap.appendChild(full);
    return wrap;
  }

  const pill = document.createElement('span');
  pill.className = 'qpm-charged-abilities__optimal-partial';
  pill.textContent = t('feature.chargedAbilities.optimal.partial', { pct: result.pct });

  // Tooltip is attached as a child of `wrap` (not document.body) so it
  // cascades away when the panel rebuilds during a hover — otherwise the
  // mouseleave event never fires and the tooltip orphans on document.body.
  // position:fixed still anchors it to the viewport regardless of parent.
  let tooltip: HTMLElement | null = null;

  const showTooltip = (): void => {
    if (tooltip) return;
    tooltip = document.createElement('div');
    tooltip.className = 'qpm-charged-abilities__tooltip';

    const currentRow = document.createElement('div');
    currentRow.className = 'qpm-charged-abilities__tooltip-row';
    const currentLabel = document.createElement('span');
    currentLabel.className = 'qpm-charged-abilities__tooltip-label';
    currentLabel.textContent = t('feature.chargedAbilities.optimal.tooltip.current');
    const currentValue = document.createElement('span');
    currentValue.textContent = formatYield(ability.yieldKind, result.currentGain);
    currentRow.append(currentLabel, currentValue);
    tooltip.appendChild(currentRow);

    const bestRow = document.createElement('div');
    bestRow.className = 'qpm-charged-abilities__tooltip-row';
    const bestLabel = document.createElement('span');
    bestLabel.className = 'qpm-charged-abilities__tooltip-label';
    bestLabel.textContent = t('feature.chargedAbilities.optimal.tooltip.best');
    const bestValue = document.createElement('span');
    bestValue.textContent = formatYield(ability.yieldKind, result.bestGain);
    bestRow.append(bestLabel, bestValue);
    tooltip.appendChild(bestRow);

    if (result.bestPatch && playerPos) {
      const { distance, direction } = directionText(playerPos, result.bestPatch.center);
      const dirRow = document.createElement('div');
      dirRow.className = 'qpm-charged-abilities__tooltip-row';
      const dirValue = document.createElement('span');
      dirValue.textContent = t('feature.chargedAbilities.optimal.tooltip.direction', {
        distance,
        direction,
      });
      dirRow.appendChild(dirValue);
      tooltip.appendChild(dirRow);
    }

    wrap.appendChild(tooltip);
    const rect = pill.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    tooltip.style.left = `${Math.max(8, rect.right - tipRect.width)}px`;
    tooltip.style.top = `${Math.round(rect.bottom + 4)}px`;
  };

  const hideTooltip = (): void => {
    if (!tooltip) return;
    tooltip.remove();
    tooltip = null;
  };

  pill.addEventListener('mouseenter', showTooltip);
  pill.addEventListener('mouseleave', hideTooltip);

  wrap.appendChild(pill);
  return wrap;
}
