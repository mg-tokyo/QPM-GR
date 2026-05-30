import {
  getOptimizerConfig,
  setOptimizerConfig,
  type OptimizerCompareFilter,
  type RecommendationMode,
} from '../../../features/pets/optimizer';
import { COMPARE_GROUP_FILTER_OPTIONS } from '../../../features/pets/data/petCompareRules';
import { t } from '../../../i18n';
import { createButton, createToggle } from '../../components';
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
  groupWrap.dataset.tour = 'optimizer-group-filter';
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
      `color:${option.id === config.selectedStrategy ? '#cfc6ff' : 'var(--qpm-text)'}`,
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
  modeWrap.dataset.tour = 'optimizer-mode';
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

  const sellToggle = createToggle({
    size: 'compact',
    checked: config.showSell,
    label: t('feature.petOptimizer.showSell'),
    onChange: (checked) => {
      setOptimizerConfig({ showSell: checked });
      onRenderCurrentAnalysis();
    },
  });
  sellToggle.root.dataset.tour = 'optimizer-sell-toggle';
  filtersDiv.appendChild(sellToggle.root);

  const reviewToggle = createToggle({
    size: 'compact',
    checked: config.showReview,
    label: t('feature.petOptimizer.showReview'),
    onChange: (checked) => {
      setOptimizerConfig({ showReview: checked });
      onRenderCurrentAnalysis();
    },
  });
  filtersDiv.appendChild(reviewToggle.root);

  const keepsToggle = createToggle({
    size: 'compact',
    checked: config.showAllKeeps,
    label: t('feature.petOptimizer.showAllKeeps'),
    onChange: (checked) => {
      setOptimizerConfig({ showAllKeeps: checked });
      onRenderCurrentAnalysis();
    },
  });
  filtersDiv.appendChild(keepsToggle.root);

  const dislikeGoldToggle = createToggle({
    size: 'compact',
    checked: config.dislikeGold,
    label: t('feature.petOptimizer.dislikeGold'),
    onChange: (checked) => {
      setOptimizerConfig({ dislikeGold: checked });
      onRefreshAnalysis(true);
    },
  });
  dislikeGoldToggle.root.dataset.tour = 'optimizer-dislike-gold';
  filtersDiv.appendChild(dislikeGoldToggle.root);

  const refreshButton = createButton(t('feature.petOptimizer.refresh'), {
    variant: 'secondary',
    size: 'sm',
    onClick: () => onRefreshAnalysis(true),
  });
  filtersDiv.appendChild(refreshButton);

  globalState.filtersContainer.innerHTML = '';
  globalState.filtersContainer.appendChild(filtersDiv);
}
