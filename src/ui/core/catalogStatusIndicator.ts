/**
 * Visual indicator for catalog loading status
 * Shows in UI when catalogs aren't ready yet
 */

import { areCatalogsReady, onCatalogsReady } from '../../catalogs/gameCatalogs';

export function createCatalogStatusBanner(): HTMLElement {
  const banner = document.createElement('div');
  banner.style.cssText = `
    padding: 8px 12px;
    background: rgba(251, 191, 36, 0.2);
    border: 1px solid rgba(251, 191, 36, 0.4);
    border-radius: 6px;
    font-size: 12px;
    color: #fbbf24;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 12px;
  `;

  banner.innerHTML = `
    <span style="font-size: 16px;">⏳</span>
    <span>Loading game data catalog...</span>
  `;

  // Hide when catalogs are ready
  onCatalogsReady(() => {
    banner.style.display = 'none';
  });

  // Initial state
  if (areCatalogsReady()) {
    banner.style.display = 'none';
  }

  return banner;
}

/**
 * Wrap a UI element with catalog status indicator
 */
export function wrapWithCatalogStatus(content: HTMLElement): HTMLElement {
  const container = document.createElement('div');
  const banner = createCatalogStatusBanner();

  container.appendChild(banner);
  container.appendChild(content);

  return container;
}
