import {
  getOptimizerConfig,
  setOptimizerConfig,
  type OptimizerCompareFilter,
  type RecommendationMode,
} from '../../features/petOptimizer';
import { COMPARE_GROUP_FILTER_OPTIONS } from '../../data/petCompareRules';
import { t } from '../../i18n';
import {
  clearFiltersCleanup,
  getGlobalState,
  setFiltersCleanup,
} from './windowState';

export function renderFilters(
  onRenderCurrentAnalysis: () => void,
  onRefreshAnalysis: (forceRefresh?: boolean) => void,
): void {
  const globalState = getGlobalState();
  if (!globalState) return;

  clearFiltersCleanup();
  setFiltersCleanup(null);

  const config = getOptimizerConfig();
  const filtersDiv = document.createElement('div');
  filtersDiv.style.cssText = 'display:flex;gap:10px;align-items:center;flex-wrap:wrap;';

  const groupWrap = document.createElement('div');
  groupWrap.style.cssText = 'position:relative; min-width:190px;';
  const groupBtn = document.createElement('button');
  groupBtn.type = 'button';
  groupBtn.style.cssText = [
    'height:30px',
    'width:100%',
    'padding:0 10px',
    'border-radius:6px',
    'border:1px solid rgba(143,130,255,0.45)',
    'background:rgba(12,16,24,0.95)',
    'color:#ecefff',
    'font-size:12px',
    'text-align:left',
    'cursor:pointer',
  ].join(';');

  const groupMenu = document.createElement('div');
  groupMenu.style.cssText = [
    'position:absolute',
    'left:0',
    'right:0',
    'top:calc(100% + 4px)',
    'background:rgba(10,14,22,0.98)',
    'border:1px solid rgba(143,130,255,0.45)',
    'border-radius:8px',
    'padding:4px',
    'display:none',
    'z-index:40',
    'box-shadow:0 8px 24px rgba(0,0,0,0.45)',
  ].join(';');

  const groupOptions: Array<{ id: OptimizerCompareFilter; label: string }> = [
    { id: 'all', label: t('feature.petOptimizer.allGroups') },
    ...COMPARE_GROUP_FILTER_OPTIONS.map((entry) => ({ id: entry.id as OptimizerCompareFilter, label: entry.label })),
  ];

  let open = false;
  const setOpen = (next: boolean): void => {
    open = next;
    groupMenu.style.display = open ? '' : 'none';
    groupBtn.style.borderColor = open ? 'rgba(143,130,255,0.8)' : 'rgba(143,130,255,0.45)';
  };

  const selectedLabel = groupOptions.find((entry) => entry.id === config.selectedStrategy)?.label ?? t('feature.petOptimizer.allGroups');
  groupBtn.textContent = `${selectedLabel} ▾`;
  groupBtn.addEventListener('click', () => setOpen(!open));

  for (const option of groupOptions) {
    const optionBtn = document.createElement('button');
    optionBtn.type = 'button';
    optionBtn.textContent = option.label;
    optionBtn.style.cssText = [
      'width:100%',
      'padding:6px 8px',
      'border-radius:6px',
      'border:1px solid transparent',
      'background:transparent',
      `color:${option.id === config.selectedStrategy ? '#cfc6ff' : '#e0e0e0'}`,
      'font-size:12px',
      'text-align:left',
      'cursor:pointer',
    ].join(';');
    optionBtn.addEventListener('mouseenter', () => {
      optionBtn.style.background = 'rgba(143,130,255,0.16)';
      optionBtn.style.borderColor = 'rgba(143,130,255,0.35)';
    });
    optionBtn.addEventListener('mouseleave', () => {
      optionBtn.style.background = 'transparent';
      optionBtn.style.borderColor = 'transparent';
    });
    optionBtn.addEventListener('click', () => {
      setOptimizerConfig({ selectedStrategy: option.id });
      groupBtn.textContent = `${option.label} ▾`;
      setOpen(false);
      onRenderCurrentAnalysis();
    });
    groupMenu.appendChild(optionBtn);
  }

  const outsideClick = (event: MouseEvent): void => {
    if (!groupWrap.contains(event.target as Node)) setOpen(false);
  };
  document.addEventListener('mousedown', outsideClick);
  setFiltersCleanup(() => document.removeEventListener('mousedown', outsideClick));

  groupWrap.append(groupBtn, groupMenu);
  filtersDiv.appendChild(groupWrap);

  const modeWrap = document.createElement('div');
  modeWrap.style.cssText = 'display:inline-flex;align-items:center;border:1px solid rgba(143,130,255,0.4);border-radius:8px;overflow:hidden;background:rgba(10,14,22,0.75);';
  const modeOptions: Array<{ id: RecommendationMode; label: string }> = [
    { id: 'specialist', label: t('feature.petOptimizer.specialist') },
    { id: 'slot_efficiency', label: t('feature.petOptimizer.slotEfficiency') },
  ];
  for (const option of modeOptions) {
    const button = document.createElement('button');
    button.type = 'button';
    const isActive = config.recommendationMode === option.id;
    button.textContent = option.label;
    button.style.cssText = [
      'padding:6px 10px',
      'font-size:12px',
      'font-weight:600',
      'border:none',
      'cursor:pointer',
      'transition:all 0.15s ease',
      isActive
        ? 'background:rgba(143,130,255,0.24);color:#f0edff;'
        : 'background:transparent;color:#b6bdd8;',
    ].join(';');
    button.addEventListener('click', () => {
      if (config.recommendationMode === option.id) return;
      setOptimizerConfig({ recommendationMode: option.id });
      renderFilters(onRenderCurrentAnalysis, onRefreshAnalysis);
      onRefreshAnalysis(true);
    });
    modeWrap.appendChild(button);
  }
  filtersDiv.appendChild(modeWrap);

  const sellCheckbox = document.createElement('input');
  sellCheckbox.type = 'checkbox';
  sellCheckbox.checked = config.showSell;
  sellCheckbox.id = 'show-sell-checkbox';
  sellCheckbox.style.cssText = 'cursor: pointer;';
  sellCheckbox.addEventListener('change', () => {
    setOptimizerConfig({ showSell: sellCheckbox.checked });
    onRenderCurrentAnalysis();
  });
  const sellLabel = document.createElement('label');
  sellLabel.htmlFor = 'show-sell-checkbox';
  sellLabel.style.cssText = 'font-size:12px; cursor:pointer;';
  sellLabel.textContent = t('feature.petOptimizer.showSell');
  filtersDiv.append(sellCheckbox, sellLabel);

  const reviewCheckbox = document.createElement('input');
  reviewCheckbox.type = 'checkbox';
  reviewCheckbox.checked = config.showReview;
  reviewCheckbox.id = 'show-review-checkbox';
  reviewCheckbox.style.cssText = 'cursor: pointer;';
  reviewCheckbox.addEventListener('change', () => {
    setOptimizerConfig({ showReview: reviewCheckbox.checked });
    onRenderCurrentAnalysis();
  });
  const reviewLabel = document.createElement('label');
  reviewLabel.htmlFor = 'show-review-checkbox';
  reviewLabel.style.cssText = 'font-size:12px; cursor:pointer;';
  reviewLabel.textContent = t('feature.petOptimizer.showReview');
  filtersDiv.append(reviewCheckbox, reviewLabel);

  const keepsCheckbox = document.createElement('input');
  keepsCheckbox.type = 'checkbox';
  keepsCheckbox.checked = config.showAllKeeps;
  keepsCheckbox.id = 'show-all-keeps-checkbox';
  keepsCheckbox.style.cssText = 'cursor: pointer;';
  keepsCheckbox.addEventListener('change', () => {
    setOptimizerConfig({ showAllKeeps: keepsCheckbox.checked });
    onRenderCurrentAnalysis();
  });
  const keepsLabel = document.createElement('label');
  keepsLabel.htmlFor = 'show-all-keeps-checkbox';
  keepsLabel.style.cssText = 'font-size:12px; cursor:pointer;';
  keepsLabel.textContent = t('feature.petOptimizer.showAllKeeps');
  filtersDiv.append(keepsCheckbox, keepsLabel);

  const dislikeGoldCheckbox = document.createElement('input');
  dislikeGoldCheckbox.type = 'checkbox';
  dislikeGoldCheckbox.checked = config.dislikeGold;
  dislikeGoldCheckbox.id = 'dislike-gold-checkbox';
  dislikeGoldCheckbox.style.cssText = 'cursor: pointer;';
  dislikeGoldCheckbox.addEventListener('change', () => {
    setOptimizerConfig({ dislikeGold: dislikeGoldCheckbox.checked });
    onRefreshAnalysis(true);
  });
  const dislikeGoldLabel = document.createElement('label');
  dislikeGoldLabel.htmlFor = 'dislike-gold-checkbox';
  dislikeGoldLabel.style.cssText = 'font-size:12px; cursor:pointer;';
  dislikeGoldLabel.textContent = t('feature.petOptimizer.dislikeGold');
  filtersDiv.append(dislikeGoldCheckbox, dislikeGoldLabel);

  const refreshButton = document.createElement('button');
  refreshButton.textContent = t('feature.petOptimizer.refresh');
  refreshButton.style.cssText = `
    padding: 5px 11px;
    background: rgba(66, 165, 245, 0.15);
    border: 1px solid rgba(66,165,245,0.4);
    border-radius: 5px;
    color: #42A5F5;
    cursor: pointer;
    font-size: 12px;
  `;
  refreshButton.addEventListener('click', () => onRefreshAnalysis(true));
  filtersDiv.appendChild(refreshButton);

  globalState.filtersContainer.innerHTML = '';
  globalState.filtersContainer.appendChild(filtersDiv);
}
