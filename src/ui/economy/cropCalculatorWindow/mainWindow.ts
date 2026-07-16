import { areCatalogsReady, onCatalogsReady } from '../../../catalogs/gameCatalogs';
import { onSpritesReady } from '../../../sprite-v2/compat';
import { toggleWindow } from '../../core/modalWindow';
import { t } from '../../../i18n';
import { watchDetach } from '../../../utils/dom/dom';
import { MUTED } from './constants';
import { el } from './domHelpers';
import { buildPillRow } from './inputs';
import { renderCropTab } from './cropTab';
import { renderPetTab } from './petTab';

export function renderCalculator(root: HTMLElement): void {
  root.style.cssText = 'display:flex;flex-direction:column;padding:16px;gap:16px;overflow-y:auto;max-width:460px;';

  // Catalog guard
  if (!areCatalogsReady()) {
    const placeholder = el(
      'div',
      `text-align:center;color:${MUTED};font-size:12px;padding:24px 16px;`,
      t('feature.cropCalc.waitingForData'),
    );
    root.appendChild(placeholder);

    const unsub = onCatalogsReady(() => {
      root.innerHTML = '';
      renderCalculator(root);
    });

    watchDetach(root, () => {
      unsub();
    });
    return;
  }

  // Track current tab's update function for sprites-ready callback
  let currentUpdateFn: (() => void) | null = null;

  // --- Tab bar ---
  const { container: tabBar } = buildPillRow(
    [
      { label: t('feature.cropCalc.tabCrop'), value: 'crop' },
      { label: t('feature.cropCalc.tabPet'), value: 'pet' },
    ],
    'crop',
    (value) => {
      if (value === 'crop' || value === 'pet') switchTab(value);
    },
  );
  root.appendChild(tabBar);

  // --- Content area ---
  const contentDiv = el('div', 'display:flex;flex-direction:column;flex:1;min-height:0;');
  root.appendChild(contentDiv);

  function switchTab(tab: 'crop' | 'pet'): void {
    contentDiv.innerHTML = '';
    if (tab === 'crop') {
      currentUpdateFn = renderCropTab(contentDiv);
    } else {
      currentUpdateFn = renderPetTab(contentDiv);
    }
  }

  // Default tab
  switchTab('crop');

  // Sprites-ready callback
  const stopSpritesReady = onSpritesReady(() => {
    currentUpdateFn?.();
  });

  watchDetach(root, () => {
    stopSpritesReady();
  });
}

export function openCalculatorWindow(): void {
  toggleWindow('calculator', `🧮 ${t('feature.cropCalc.windowTitle')}`, renderCalculator, '500px', '90vh');
}
