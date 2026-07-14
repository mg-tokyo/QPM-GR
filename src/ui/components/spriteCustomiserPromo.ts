import { t } from '../../i18n';

const SPRITE_CUSTOMISER_URL = 'https://mg-tokyo.github.io/MG-Sprite-Customiser-V2/';

export function createSpriteCustomiserPromo(): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = [
    'margin-top:auto',
    'padding:6px 12px',
    'border-top:1px solid var(--qpm-accent-tint)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'gap:4px',
    'flex-shrink:0',
    'font-family:var(--qpm-font)',
    'font-size:var(--qpm-font-caption)',
    'color:var(--qpm-text-muted)',
  ].join(';');

  row.appendChild(document.createTextNode(t('feature.spriteCustomiserPromo.prefix') + ' '));

  const link = document.createElement('a');
  link.href = SPRITE_CUSTOMISER_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = "tokyo's Sprite Customiser";
  link.style.cssText = 'color:var(--qpm-accent-hover);text-decoration:none;font-weight:var(--qpm-weight-bold);';
  const onEnter = (): void => { link.style.textDecoration = 'underline'; };
  const onLeave = (): void => { link.style.textDecoration = 'none'; };
  link.addEventListener('mouseenter', onEnter);
  link.addEventListener('mouseleave', onLeave);
  row.appendChild(link);

  row.appendChild(document.createTextNode(' →'));

  return row;
}
