import { createMutationBadge } from '../components/mutationBadge';
import { createProgressBar } from '../components/progressBar';
import {
  formatSpeciesDisplayName,
  getSpeciesNotes,
  saveSpeciesNotes,
  GRADIENT_RAINBOW,
} from './constants';
import { t } from '../../i18n';

export interface VariantInfo {
  variant: string;
  collected: boolean;
}

export interface SpeciesCardParams {
  species: string;
  variants: VariantInfo[];
  spriteDataUrl: string | null;
  isTall?: boolean;
  color: string;
  gradient: string;
  percentage: number;
  collectedCount: number;
  totalCount: number;
  isComplete: boolean;
  notesKey: string;
}

export function buildSpeciesCard(params: SpeciesCardParams): HTMLElement {
  const {
    species, variants, spriteDataUrl, isTall, color, gradient,
    percentage, collectedCount, totalCount, isComplete, notesKey,
  } = params;

  const card = document.createElement('div');

  if (isComplete) {
    card.classList.add('qpm-rainbow-complete');
    card.style.cssText =
      'border-radius:var(--qpm-radius-md);padding:16px;margin-bottom:10px;' +
      'border:1px solid var(--qpm-border);transition:all 0.2s;';
  } else {
    card.style.cssText =
      'background:var(--qpm-surface-2);border-radius:var(--qpm-radius-md);' +
      'padding:16px;margin-bottom:10px;border:1px solid var(--qpm-border);transition:all 0.2s;';
  }

  card.addEventListener('mouseenter', () => {
    if (!isComplete) card.style.borderColor = `${color}44`;
    card.style.transform = 'translateX(4px)';
  });
  card.addEventListener('mouseleave', () => {
    if (!isComplete) card.style.borderColor = '';
    card.style.transform = 'translateX(0)';
  });

  // ── Sprite + header row ───────────────────────────────────────────────────
  const topRow = document.createElement('div');
  topRow.style.cssText = 'display:flex;gap:12px;margin-bottom:12px;';

  if (spriteDataUrl) {
    const spriteEl = document.createElement('div');
    const h = isTall ? '92px' : '64px';
    const bgSize = isTall ? 'auto 96%' : 'contain';
    spriteEl.style.cssText =
      `width:64px;height:${h};background-image:url(${spriteDataUrl});` +
      `background-size:${bgSize};background-repeat:no-repeat;background-position:center bottom;` +
      `border-radius:var(--qpm-radius-md);border:2px solid ${isComplete ? color : 'var(--qpm-border)'};` +
      `flex-shrink:0;image-rendering:pixelated;` +
      (isComplete ? `box-shadow:0 0 20px ${color}80;` : '');
    topRow.appendChild(spriteEl);
  } else {
    const placeholder = document.createElement('div');
    placeholder.style.cssText =
      'width:64px;height:64px;background:var(--qpm-surface-3);' +
      'border-radius:var(--qpm-radius-md);border:2px solid var(--qpm-border);' +
      'flex-shrink:0;display:flex;align-items:center;justify-content:center;' +
      'font-size:24px;color:var(--qpm-text-muted);';
    placeholder.textContent = '?';
    topRow.appendChild(placeholder);
  }

  const headerArea = document.createElement('div');
  headerArea.style.cssText = 'flex:1;min-width:0;';

  const headerRow = document.createElement('div');
  headerRow.style.cssText =
    'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;';

  const nameGroup = document.createElement('div');
  nameGroup.style.cssText = 'display:flex;align-items:center;gap:8px;';
  const nameEl = document.createElement('strong');
  nameEl.style.cssText = 'color:var(--qpm-text);font-size:var(--qpm-font-subtitle);';
  nameEl.textContent = formatSpeciesDisplayName(species);
  nameGroup.appendChild(nameEl);
  if (isComplete) {
    const sparkle = document.createElement('span');
    sparkle.style.fontSize = '16px';
    sparkle.textContent = '✨';
    nameGroup.appendChild(sparkle);
  }

  const statsGroup = document.createElement('div');
  statsGroup.style.cssText = 'display:flex;align-items:center;gap:8px;';

  const countEl = document.createElement('span');
  countEl.style.cssText = `color:${color};font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-bold);`;
  countEl.textContent = `${collectedCount}/${totalCount}`;
  statsGroup.appendChild(countEl);

  const pctBadge = document.createElement('span');
  pctBadge.style.cssText =
    `background:${isComplete ? color : 'var(--qpm-surface-3)'};` +
    `color:${isComplete ? '#000' : 'var(--qpm-text)'};` +
    'padding:2px 8px;border-radius:var(--qpm-radius-pill);' +
    'font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-bold);';
  pctBadge.textContent = `${Math.round(percentage)}%`;
  statsGroup.appendChild(pctBadge);

  headerRow.appendChild(nameGroup);
  headerRow.appendChild(statsGroup);
  headerArea.appendChild(headerRow);
  topRow.appendChild(headerArea);
  card.appendChild(topRow);

  // ── Progress bar ──────────────────────────────────────────────────────────
  const pb = createProgressBar({
    value: collectedCount,
    max: totalCount,
    gradient: isComplete ? GRADIENT_RAINBOW : gradient,
    height: 6,
  });
  pb.root.style.marginBottom = '12px';

  card.appendChild(pb.root);

  // ── Variant chips ─────────────────────────────────────────────────────────
  if (variants.length > 0) {
    const chipsContainer = document.createElement('div');
    chipsContainer.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;';
    for (const v of variants) {
      chipsContainer.appendChild(
        createMutationBadge(v.variant, { size: 'compact', grayed: !v.collected }),
      );
    }
    card.appendChild(chipsContainer);
  }

  // ── Notes ─────────────────────────────────────────────────────────────────
  const notesContainer = document.createElement('div');
  notesContainer.style.cssText =
    'margin-top:12px;padding-top:12px;border-top:1px solid var(--qpm-border);';

  const notesLabel = document.createElement('div');
  notesLabel.style.cssText =
    'font-size:var(--qpm-font-body);color:var(--qpm-text-muted);margin-bottom:6px;' +
    'font-weight:var(--qpm-weight-medium);';
  notesLabel.textContent = `📝 ${t('feature.journal.notes')}`;
  notesContainer.appendChild(notesLabel);

  const textarea = document.createElement('textarea');
  textarea.value = getSpeciesNotes(notesKey);
  textarea.placeholder = t('feature.journal.notesPlaceholder');
  textarea.style.cssText =
    'width:100%;min-height:60px;padding:8px;box-sizing:border-box;' +
    'background:rgba(0,0,0,0.3);border:1px solid var(--qpm-border);' +
    'border-radius:var(--qpm-radius-sm);color:var(--qpm-text);' +
    'font-size:var(--qpm-font-body);font-family:inherit;resize:vertical;';
  textarea.addEventListener('blur', () => saveSpeciesNotes(notesKey, textarea.value));
  notesContainer.appendChild(textarea);
  card.appendChild(notesContainer);

  return card;
}
