import type { OptimizerAnalysis } from '../../../features/pets/optimizer';
import { t } from '../../../i18n';
import { getGlobalState } from './windowState';

export function renderSummary(analysis: OptimizerAnalysis): void {
  const globalState = getGlobalState();
  if (!globalState) return;

  try {
    const modeLabel = analysis.activeMode === 'slot_efficiency' ? t('feature.petOptimizer.slotEfficiency') : t('feature.petOptimizer.specialist');
    const html = `
      <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;">
        <span style="padding:3px 8px;border-radius:999px;border:1px solid rgba(66,165,245,0.35);background:rgba(66,165,245,0.12);font-size:12px;color:#8ec8ff;">${t('feature.petOptimizer.totalBadge', { count: String(analysis.totalPets) })}</span>
        <span style="padding:3px 8px;border-radius:999px;border:1px solid rgba(76,175,80,0.35);background:rgba(76,175,80,0.12);font-size:12px;color:#8ed89a;">${t('feature.petOptimizer.keepBadge', { count: String(analysis.keep.length) })}</span>
        <span style="padding:3px 8px;border-radius:999px;border:1px solid rgba(244,67,54,0.35);background:rgba(244,67,54,0.12);font-size:12px;color:#ff9e95;">${t('feature.petOptimizer.sellBadge', { count: String(analysis.sellCount) })}</span>
        <span style="padding:3px 8px;border-radius:999px;border:1px solid rgba(255,193,7,0.35);background:rgba(255,193,7,0.12);font-size:12px;color:#ffe08a;">${t('feature.petOptimizer.reviewBadge', { count: String(analysis.reviewCount) })}</span>
        <span style="padding:3px 8px;border-radius:999px;border:1px solid rgba(143,130,255,0.35);background:rgba(143,130,255,0.12);font-size:12px;color:#d8d1ff;">${t('feature.petOptimizer.modeBadge', { mode: modeLabel })}</span>
        <span style="font-size:12px;color:#888;">${t('feature.petOptimizer.locationBreakdown', { active: String(analysis.activePets), inv: String(analysis.inventoryPets), hutch: String(analysis.hutchPets) })}</span>
      </div>
    `;

    globalState.summaryContainer.innerHTML = html;
  } catch (error) {
    console.error('[Pet Optimizer] Error rendering summary:', error);
    globalState.summaryContainer.innerHTML = `<div style="color: var(--qpm-danger);">Error rendering summary: ${error instanceof Error ? error.message : 'Unknown'}</div>`;
  }
}
