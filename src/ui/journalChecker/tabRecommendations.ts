import { createProgressBar } from '../components/progressBar';
import { createEmptyState } from '../components/emptyState';
import { getRecommendationSpriteUrl } from './sprites';
import { COLOR_TIPS, COLOR_MISSING } from './constants';
import { t } from '../../i18n';

export async function renderRecommendationsTab(container: HTMLElement): Promise<void> {
  const {
    generateJournalStrategy,
    getDifficultyEmoji,
    getDifficultyDescription,
  } = await import('../../features/journal/recommendations');

  const strategy = await generateJournalStrategy();

  if (!strategy) {
    container.appendChild(
      createEmptyState(t('feature.journal.unableToRecommend')),
    );
    return;
  }

  if (strategy.recommendedFocus.length > 0) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:24px;';

    const title = document.createElement('div');
    title.style.cssText =
      `font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-bold);` +
      `color:${COLOR_TIPS};margin-bottom:12px;padding-bottom:8px;` +
      `border-bottom:2px solid ${COLOR_TIPS}33;`;
    title.textContent = `🎯 ${t('feature.journal.recommendedFocus', { count: String(Math.min(10, strategy.recommendedFocus.length)) })}`;
    section.appendChild(title);

    for (const rec of strategy.recommendedFocus.slice(0, 10)) {
      const priorityColor = rec.priority === 'high'
        ? 'var(--qpm-danger)'
        : rec.priority === 'medium' ? COLOR_MISSING : 'var(--qpm-text-muted)';

      const card = document.createElement('div');
      card.style.cssText =
        `background:var(--qpm-surface-2);border-left:4px solid ${priorityColor};` +
        'border-radius:var(--qpm-radius-md);padding:14px;margin-bottom:10px;transition:all 0.2s;';

      card.addEventListener('mouseenter', () => {
        card.style.transform = 'translateX(4px)';
        card.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.transform = 'translateX(0)';
        card.style.boxShadow = 'none';
      });

      const priorityLabel = rec.priority === 'high'
        ? t('feature.journal.priorityHigh')
        : rec.priority === 'medium' ? t('feature.journal.priorityMed') : t('feature.journal.priorityLow');

      const spriteUrl = getRecommendationSpriteUrl(rec);
      const spriteHtml = spriteUrl
        ? `<img src="${spriteUrl}" alt="${rec.species}" style="width:32px;height:32px;image-rendering:pixelated;">`
        : `<span style="font-size:18px;">${rec.type === 'produce' ? '🌿' : '🐾'}</span>`;

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${spriteHtml}
            <strong style="color:var(--qpm-text);font-size:var(--qpm-font-subtitle);">${rec.species}</strong>
          </div>
          <div style="display:flex;gap:6px;">
            <span style="background:${priorityColor}33;color:${priorityColor};padding:2px 8px;border-radius:var(--qpm-radius-sm);font-size:var(--qpm-font-caption);font-weight:var(--qpm-weight-bold);">${priorityLabel}</span>
            <span style="background:var(--qpm-surface-3);color:var(--qpm-text);padding:2px 8px;border-radius:var(--qpm-radius-sm);font-size:var(--qpm-font-caption);font-weight:var(--qpm-weight-bold);">${getDifficultyEmoji(rec.difficulty)} ${getDifficultyDescription(rec.difficulty)}</span>
          </div>
        </div>
      `;

      const pb = createProgressBar({
        value: rec.completionPct,
        max: 100,
        gradient: `linear-gradient(90deg, ${COLOR_TIPS}, #BA68C8)`,
        height: 4,
      });
      pb.root.style.marginBottom = '8px';
      card.appendChild(pb.root);

      const info = document.createElement('div');
      info.style.cssText = 'color:var(--qpm-text-muted);font-size:var(--qpm-font-body);margin-bottom:6px;';
      info.innerHTML =
        `<strong style="color:${COLOR_TIPS};">${t('feature.journal.pctComplete', { pct: rec.completionPct.toFixed(0) })}</strong>` +
        ` &bull; ${rec.missingVariants.length !== 1
          ? t('feature.journal.variantsRemaining', { count: String(rec.missingVariants.length) })
          : t('feature.journal.variantRemaining', { count: String(rec.missingVariants.length) })
        } &bull; ${t('feature.journal.estTime', { time: rec.estimatedTime })}`;
      card.appendChild(info);

      const strategyText = document.createElement('div');
      strategyText.style.cssText = 'color:var(--qpm-text);font-size:var(--qpm-font-body);margin-bottom:8px;line-height:1.4;opacity:0.85;';
      strategyText.textContent = rec.strategy;
      card.appendChild(strategyText);

      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;';
      chips.innerHTML = rec.missingVariants.map((v: string) =>
        `<span style="padding:4px 8px;border-radius:var(--qpm-radius-sm);font-size:var(--qpm-font-caption);background:var(--qpm-surface-3);color:var(--qpm-text-muted);">${v}</span>`,
      ).join('');
      card.appendChild(chips);

      section.appendChild(card);
    }
    container.appendChild(section);
  }

  if (strategy.lowHangingFruit.length > 0) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:24px;';

    const title = document.createElement('div');
    title.style.cssText =
      'font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-bold);' +
      'color:var(--qpm-positive);margin-bottom:12px;padding-bottom:8px;' +
      'border-bottom:2px solid rgba(79,209,139,0.2);';
    title.textContent = `🍒 ${t('feature.journal.quickWins')}`;
    section.appendChild(title);

    for (const rec of strategy.lowHangingFruit.slice(0, 5)) {
      const card = document.createElement('div');
      card.style.cssText =
        'background:var(--qpm-surface-2);border:1px solid rgba(79,209,139,0.2);' +
        'border-radius:var(--qpm-radius-sm);padding:10px;margin-bottom:8px;' +
        'display:flex;justify-content:space-between;align-items:center;transition:all 0.2s;';

      card.addEventListener('mouseenter', () => {
        card.style.background = 'var(--qpm-surface-3)';
        card.style.borderColor = 'rgba(79,209,139,0.35)';
      });
      card.addEventListener('mouseleave', () => {
        card.style.background = 'var(--qpm-surface-2)';
        card.style.borderColor = 'rgba(79,209,139,0.2)';
      });

      const spriteUrl = getRecommendationSpriteUrl(rec);

      card.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px;">
          ${spriteUrl
            ? `<img src="${spriteUrl}" style="width:32px;height:32px;image-rendering:pixelated;" alt="${rec.species}" />`
            : `<span style="font-size:20px;">${rec.type === 'produce' ? '🌿' : '🐾'}</span>`}
          <div>
            <div style="font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-semibold);color:var(--qpm-text);">${rec.species}</div>
            <div style="font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);">${rec.missingVariants.join(', ')}</div>
          </div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:var(--qpm-font-body);color:var(--qpm-positive);font-weight:var(--qpm-weight-bold);">${rec.estimatedTime}</div>
          <div style="font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);">${getDifficultyEmoji(rec.difficulty)} ${getDifficultyDescription(rec.difficulty)}</div>
        </div>
      `;
      section.appendChild(card);
    }
    container.appendChild(section);
  }

  if (strategy.fastestPath.steps.length > 0) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:24px;';

    const title = document.createElement('div');
    title.style.cssText =
      `font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-bold);` +
      `color:${COLOR_MISSING};margin-bottom:12px;padding-bottom:8px;` +
      `border-bottom:2px solid ${COLOR_MISSING}33;`;
    title.textContent = `🚀 ${t('feature.journal.fastestPath', { count: String(strategy.fastestPath.expectedCompletion) })}`;
    section.appendChild(title);

    const infoBox = document.createElement('div');
    infoBox.style.cssText =
      `background:${COLOR_MISSING}22;border-left:3px solid ${COLOR_MISSING};` +
      'border-radius:var(--qpm-radius-sm);padding:12px;margin-bottom:12px;';
    infoBox.innerHTML =
      `<div style="font-size:var(--qpm-font-body);color:${COLOR_MISSING};font-weight:var(--qpm-weight-semibold);margin-bottom:4px;">` +
      `⏱️ ${t('feature.journal.estimatedTime', { time: strategy.fastestPath.estimatedTime })}</div>` +
      `<div style="font-size:var(--qpm-font-body);color:var(--qpm-text-muted);">` +
      `${t('feature.journal.completeSpecies', { count: String(strategy.fastestPath.steps.length) })}</div>`;
    section.appendChild(infoBox);

    strategy.fastestPath.steps.slice(0, 8).forEach((rec, index) => {
      const card = document.createElement('div');
      card.style.cssText =
        `background:var(--qpm-surface-2);border-left:3px solid ${COLOR_MISSING};` +
        'border-radius:var(--qpm-radius-sm);padding:10px;margin-bottom:6px;' +
        'display:flex;align-items:center;gap:10px;';

      const spriteUrl = getRecommendationSpriteUrl(rec);

      card.innerHTML = `
        <div style="background:${COLOR_MISSING};color:#000;width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-bold);flex-shrink:0;">${index + 1}</div>
        ${spriteUrl
          ? `<img src="${spriteUrl}" style="width:28px;height:28px;image-rendering:pixelated;flex-shrink:0;" alt="${rec.species}" />`
          : `<span style="font-size:18px;flex-shrink:0;">${rec.type === 'produce' ? '🌿' : '🐾'}</span>`}
        <div style="flex:1;min-width:0;">
          <div style="font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-semibold);color:var(--qpm-text);margin-bottom:2px;">
            ${rec.species} (${rec.missingVariants.join(', ')})
          </div>
          <div style="font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);">${rec.estimatedTime} &bull; ${getDifficultyEmoji(rec.difficulty)} ${getDifficultyDescription(rec.difficulty)}</div>
        </div>
      `;
      section.appendChild(card);
    });
    container.appendChild(section);
  }

  if (strategy.longTermGoals.length > 0) {
    const section = document.createElement('div');
    section.style.cssText = 'margin-bottom:24px;';

    const title = document.createElement('div');
    title.style.cssText =
      'font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-bold);' +
      'color:var(--qpm-danger);margin-bottom:12px;padding-bottom:8px;' +
      'border-bottom:2px solid rgba(244,67,54,0.2);';
    title.textContent = `🎖️ ${t('feature.journal.longTermChallenges')}`;
    section.appendChild(title);

    const warning = document.createElement('div');
    warning.style.cssText =
      'background:rgba(244,67,54,0.13);border-left:3px solid var(--qpm-danger);' +
      'border-radius:var(--qpm-radius-sm);padding:10px;margin-bottom:12px;' +
      'font-size:var(--qpm-font-body);color:var(--qpm-danger);';
    warning.textContent = `⚠️ ${t('feature.journal.longTermWarning')}`;
    section.appendChild(warning);

    for (const rec of strategy.longTermGoals.slice(0, 5)) {
      const card = document.createElement('div');
      card.style.cssText =
        'background:var(--qpm-surface-2);border:1px solid rgba(244,67,54,0.2);' +
        'border-radius:var(--qpm-radius-sm);padding:10px;margin-bottom:8px;';

      const spriteUrl = getRecommendationSpriteUrl(rec);

      card.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px;">
          <div style="display:flex;align-items:center;gap:8px;">
            ${spriteUrl
              ? `<img src="${spriteUrl}" style="width:32px;height:32px;image-rendering:pixelated;" alt="${rec.species}" />`
              : `<span style="font-size:20px;">${rec.type === 'produce' ? '🌿' : '🐾'}</span>`}
            <strong style="color:var(--qpm-text);font-size:var(--qpm-font-body);">${rec.species}</strong>
          </div>
          <span style="font-size:20px;">${getDifficultyEmoji(rec.difficulty)}</span>
        </div>
        <div style="font-size:var(--qpm-font-body);color:var(--qpm-text-muted);margin-bottom:6px;">
          ${rec.missingVariants.join(', ')}
        </div>
        <div style="font-size:var(--qpm-font-caption);color:var(--qpm-text-muted);line-height:1.4;">
          ${rec.strategy}
        </div>
      `;
      section.appendChild(card);
    }
    container.appendChild(section);
  }
}
