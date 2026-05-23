import { findVariantBadge, getVariantChipColors } from '../../data/variantBadges';

export interface MutationBadgeOptions {
  size?: 'default' | 'compact';
  clickable?: boolean;
  onClick?: () => void;
  grayed?: boolean;
}

export function createMutationBadge(
  mutationName: string,
  options: MutationBadgeOptions = {},
): HTMLElement {
  const {
    size = 'default',
    clickable = false,
    onClick,
    grayed = false,
  } = options;

  const el = document.createElement('span');
  el.textContent = mutationName;

  const fontSize = size === 'compact' ? 'var(--qpm-font-xs)' : 'var(--qpm-font-caption)';
  const padding = size === 'compact' ? '1px 5px' : '2px 7px';

  let bgColor: string;
  let textColor: string;
  let fontWeight: number;
  let border = '';

  if (grayed) {
    bgColor = 'rgba(255,255,255,0.06)';
    textColor = 'var(--qpm-text-muted)';
    fontWeight = 400;
    border = 'border:1px solid rgba(255,255,255,0.1);';
    el.style.textDecoration = 'line-through';
  } else {
    const badge = findVariantBadge(mutationName);
    if (badge?.gradient) {
      bgColor = badge.gradient;
      textColor = '#111';
      fontWeight = 600;
    } else {
      const colors = getVariantChipColors(mutationName, true);
      bgColor = colors.bg;
      textColor = colors.text;
      fontWeight = colors.weight;
    }
  }

  el.style.cssText +=
    `display:inline-flex;align-items:center;` +
    `border-radius:var(--qpm-radius-pill);` +
    `padding:${padding};font-size:${fontSize};` +
    `font-weight:${fontWeight};font-family:var(--qpm-font);` +
    `background:${bgColor};color:${textColor};${border}` +
    `white-space:nowrap;line-height:1.4;` +
    `${clickable ? 'cursor:pointer;' : ''}`;

  if (clickable && onClick) {
    el.addEventListener('click', onClick);
  }

  return el;
}
