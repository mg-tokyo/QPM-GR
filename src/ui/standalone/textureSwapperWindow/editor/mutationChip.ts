import type { SpriteService } from '../../../../sprite-v2/types';
import { getCachedThumbnailWithMutations, buildShimmerPlaceholder } from '../thumbnailCache';

export function buildMutationToggle(
  mutation: string,
  spriteKey: string,
  svc: SpriteService,
  isActive: boolean,
  color: string,
  onClick: () => void,
): HTMLElement {
  const btn = document.createElement('div');
  btn.style.cssText = [
    'display:flex;align-items:center;gap:8px',
    'padding:8px 12px',
    'border-radius:8px',
    'cursor:pointer',
    'transition:all 0.15s',
    `border:${isActive ? '2px' : '1px'} solid ${isActive ? `${color}80` : 'var(--qpm-accent-subtle)'}`,
    `background:${isActive ? `${color}18` : 'rgba(255,255,255,0.02)'}`,
    isActive ? `box-shadow:0 0 10px ${color}20` : '',
  ].join(';');

  const thumbFrame = document.createElement('div');
  thumbFrame.style.cssText = 'width:28px;height:28px;background:rgba(0,0,0,0.3);border-radius:8px;display:flex;align-items:center;justify-content:center;overflow:hidden;flex-shrink:0;';
  const thumb = getCachedThumbnailWithMutations(spriteKey, [mutation], svc, 28);
  if (thumb) {
    const clone = document.createElement('canvas');
    clone.width = thumb.width;
    clone.height = thumb.height;
    clone.getContext('2d')!.drawImage(thumb, 0, 0);
    clone.style.cssText = 'width:28px;height:28px;image-rendering:pixelated;';
    thumbFrame.appendChild(clone);
  } else {
    thumbFrame.appendChild(buildShimmerPlaceholder(28));
  }

  const label = document.createElement('span');
  label.style.cssText = `font-size:12px;${isActive ? `color:${color};font-weight:600;` : 'color:var(--qpm-text-muted);'}`;
  label.textContent = mutation;

  btn.append(thumbFrame, label);
  btn.addEventListener('click', onClick);
  return btn;
}
