import { createCard } from '../core/panelHelpers';
import { fetchImageUrl } from '../../utils/imageFetcher';
import { t } from '../../i18n';

export function createGuideSection(): HTMLElement {
  const { root, body } = createCard(`📖 ${t('feature.guide.title')}`, {
    subtitle: t('feature.guide.subtitle'),
  });
  root.dataset.qpmSection = 'guide';

  const imageContainer = document.createElement('div');
  imageContainer.style.cssText = `
    width: 100%;
    text-align: center;
    padding: 12px;
    background: var(--qpm-surface-1, #1a1a1a);
    border-radius: 8px;
    position: relative;
  `;

  const clickHint = document.createElement('div');
  clickHint.textContent = t('feature.guide.clickHint');
  clickHint.style.cssText = `
    position: absolute;
    top: 20px;
    right: 20px;
    color: rgba(150, 150, 150, 0.7);
    font-size: 12px;
    font-style: italic;
    background: rgba(0, 0, 0, 0.5);
    padding: 4px 8px;
    border-radius: 4px;
    pointer-events: none;
    z-index: 10;
  `;

  const img = document.createElement('img');
  img.alt = t('feature.guide.title');
  // Use GM_xmlhttpRequest to bypass CSP img-src restrictions (e.g. Discord)
  const guideUrl = 'https://raw.githubusercontent.com/mg-tokyo/QPM-GR/master/docs/product/MGGuide.jpeg';
  fetchImageUrl(guideUrl).then((src) => { img.src = src; });
  img.style.cssText = `
    width: 100%;
    max-width: 100%;
    height: auto;
    border-radius: 8px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.3);
    cursor: pointer;
    transition: transform 0.2s;
    display: block;
  `;

  img.addEventListener('mouseenter', () => {
    img.style.transform = 'scale(1.02)';
  });

  img.addEventListener('mouseleave', () => {
    img.style.transform = 'scale(1)';
  });

  // Click to open full-size in new tab
  img.addEventListener('click', () => {
    window.open(img.src, '_blank');
  });

  img.onerror = () => {
    imageContainer.textContent = '';
    const errorDiv = document.createElement('div');
    errorDiv.style.cssText = 'padding: 40px; color: var(--qpm-text-muted, #999); font-style: italic;';
    errorDiv.textContent = `📖 ${t('feature.guide.imageError')}`;
    imageContainer.appendChild(errorDiv);
  };

  imageContainer.appendChild(clickHint);
  imageContainer.appendChild(img);
  body.appendChild(imageContainer);

  return root;
}
