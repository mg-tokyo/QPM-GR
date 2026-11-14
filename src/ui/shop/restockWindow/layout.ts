import { t } from '../../../i18n';
import { getShopFilters } from '../restockWindowConstants';
import { DEFAULT_PINNED_MAX, FILTER_LABEL_KEYS, MIN_HIST, MIN_PINNED } from './constants';

export interface ToolbarParts {
  toolbar: HTMLDivElement;
  filterBtns: HTMLButtonElement[];
  searchInput: HTMLInputElement;
  refreshBtn: HTMLButtonElement;
  refreshBudgetEl: HTMLSpanElement;
  lastUpdatedEl: HTMLSpanElement;
}

export function styleFilterButton(btn: HTMLButtonElement, active: boolean): void {
  btn.style.background    = active ? 'var(--qpm-accent-subtle)' : 'var(--qpm-accent-tint)';
  btn.style.color         = active ? 'var(--qpm-accent-hover)' : 'var(--qpm-text-muted)';
  btn.style.borderColor   = active ? 'var(--qpm-accent-emphasis)' : 'var(--qpm-accent-border)';
}

export function buildToolbar(search: string): ToolbarParts {
  const toolbar = document.createElement('div');
  toolbar.style.cssText = [
    'display:flex', 'align-items:center', 'gap:6px',
    'padding:12px 16px 8px',
    'border-bottom:1px solid var(--qpm-accent-border)',
    'flex-shrink:0', 'flex-wrap:wrap',
  ].join(';');

  const filterGroup = document.createElement('div');
  filterGroup.style.cssText = 'display:flex;gap:4px;flex-shrink:0;flex-wrap:wrap;';
  filterGroup.dataset.tour = 'restock-filters';

  const filterBtns: HTMLButtonElement[] = [];
  for (const f of getShopFilters()) {
    const btn = document.createElement('button');
    btn.type = 'button';
    const labelKey = FILTER_LABEL_KEYS[f.value];
    btn.textContent = labelKey ? t(labelKey, undefined, f.label) : f.label;
    btn.dataset.filter = f.value;
    btn.style.cssText = [
      'padding:4px 8px', 'font-size:12px', 'border-radius:4px', 'cursor:pointer',
      'border:1px solid var(--qpm-accent-border)',
      'background:var(--qpm-accent-tint)', 'color:var(--qpm-text-muted)', 'transition:all 0.12s',
    ].join(';');
    filterBtns.push(btn);
    filterGroup.appendChild(btn);
  }

  const searchInput = document.createElement('input');
  searchInput.type = 'text';
  searchInput.placeholder = t('feature.shopRestock.searchPlaceholder');
  searchInput.dataset.tour = 'restock-search';
  searchInput.style.cssText = [
    'padding:4px 12px', 'font-size:12px', 'border-radius:4px', 'flex:1', 'min-width:100px',
    'background:var(--qpm-accent-tint)', 'border:1px solid var(--qpm-accent-border)',
    'color:var(--qpm-text)', 'outline:none',
  ].join(';');
  searchInput.value = search;

  const refreshBtn = document.createElement('button');
  refreshBtn.type = 'button';
  refreshBtn.textContent = t('feature.shopRestock.refresh');
  refreshBtn.title = t('feature.shopRestock.refreshData');
  refreshBtn.style.cssText = [
    'padding:4px 12px', 'font-size:12px',
    'background:var(--qpm-accent-subtle)', 'border:1px solid var(--qpm-accent-focus)',
    'border-radius:4px', 'color:var(--qpm-accent-hover)', 'cursor:pointer', 'flex-shrink:0',
  ].join(';');

  const refreshBudgetEl = document.createElement('span');
  refreshBudgetEl.style.cssText = 'font-size:12px;color:var(--qpm-accent-hover);white-space:nowrap;flex-shrink:0;';

  const lastUpdatedEl = document.createElement('span');
  lastUpdatedEl.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);white-space:nowrap;flex-shrink:0;';

  toolbar.append(filterGroup, searchInput, refreshBtn, refreshBudgetEl, lastUpdatedEl);
  return { toolbar, filterBtns, searchInput, refreshBtn, refreshBudgetEl, lastUpdatedEl };
}

export function buildPinnedSection(pinnedHeight: number | null, collapsed: boolean): {
  predSection: HTMLDivElement;
  predHeaderRow: HTMLDivElement;
  predChevron: HTMLSpanElement;
  predBody: HTMLDivElement;
} {
  const predSection = document.createElement('div');
  predSection.style.cssText = 'flex-shrink:0;border-bottom:1px solid var(--qpm-accent-subtle);';
  predSection.dataset.tour = 'restock-pinned';

  const predHeaderRow = document.createElement('div');
  predHeaderRow.style.cssText = [
    'display:flex', 'align-items:center', 'justify-content:space-between',
    'padding:8px 16px', 'cursor:pointer', 'user-select:none',
    'background:var(--qpm-accent-tint)',
  ].join(';');
  const predTitle = document.createElement('span');
  predTitle.style.cssText = 'font-size:12px;font-weight:700;color:var(--qpm-text);';
  predTitle.textContent = t('feature.shopRestock.pinned');
  const predChevron = document.createElement('span');
  predChevron.style.cssText = 'font-size:9px;color:var(--qpm-text-muted);';
  predChevron.textContent = 'v';
  predHeaderRow.append(predTitle, predChevron);

  const predBody = document.createElement('div');
  const pinnedMaxHeight = pinnedHeight !== null ? `${pinnedHeight}px` : DEFAULT_PINNED_MAX;
  predBody.style.cssText = `padding:6px 10px 8px;display:flex;flex-direction:column;gap:2px;max-height:${pinnedMaxHeight};overflow-y:auto;`;

  predBody.style.display = collapsed ? 'none' : '';
  predChevron.textContent = collapsed ? '>' : 'v';
  predSection.append(predHeaderRow, predBody);
  return { predSection, predHeaderRow, predChevron, predBody };
}

export function buildDivider(collapsed: boolean): HTMLDivElement {
  const divider = document.createElement('div');
  divider.style.cssText = [
    'flex-shrink:0', 'height:6px', 'cursor:row-resize', 'user-select:none',
    'display:flex', 'align-items:center', 'justify-content:center',
    'background:var(--qpm-accent-tint)', 'transition:background 0.12s',
  ].join(';');
  divider.title = t('feature.shopRestock.dragToResize');
  const grip = document.createElement('div');
  grip.style.cssText = 'width:32px;height:2px;border-radius:2px;background:var(--qpm-accent-focus);';
  divider.appendChild(grip);
  divider.style.display = collapsed ? 'none' : '';
  divider.addEventListener('mouseenter', () => { divider.style.background = 'var(--qpm-accent-subtle)'; });
  divider.addEventListener('mouseleave', () => { divider.style.background = 'var(--qpm-accent-tint)'; });
  return divider;
}

export function attachPinnedResize(
  divider: HTMLDivElement,
  predBody: HTMLDivElement,
  body: HTMLDivElement,
  onResize: (height: number) => void,
  onDone: () => void,
): void {
  divider.addEventListener('mousedown', (e: MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = predBody.getBoundingClientRect().height;
    const bodyRect = body.getBoundingClientRect();
    const maxPinned = bodyRect.height - MIN_HIST;

    const onMove = (ev: MouseEvent): void => {
      const delta = ev.clientY - startY;
      const clamped = Math.max(MIN_PINNED, Math.min(maxPinned, startHeight + delta));
      predBody.style.maxHeight = `${clamped}px`;
      onResize(clamped);
    };
    const onUp = (): void => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      onDone();
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
}

export function buildItemsSection(): {
  histSection: HTMLDivElement;
  resetSortBtn: HTMLButtonElement;
  itemCountEl: HTMLSpanElement;
  tableWrap: HTMLDivElement;
} {
  const histSection = document.createElement('div');
  histSection.style.cssText = `flex:1;display:flex;flex-direction:column;min-height:${MIN_HIST}px;overflow:hidden;`; // synced with MIN_HIST

  const histHeader = document.createElement('div');
  histHeader.style.cssText = [
    'display:flex', 'align-items:center', 'padding:8px 16px',
    'border-bottom:1px solid var(--qpm-divider)',
    'background:var(--qpm-surface-1)', 'flex-shrink:0',
  ].join(';');
  const histTitle = document.createElement('span');
  histTitle.style.cssText = 'font-size:12px;font-weight:700;color:var(--qpm-text-muted);text-transform:uppercase;letter-spacing:0.5px;flex:1;';
  histTitle.textContent = t('feature.shopRestock.itemsClickToPin');
  const resetSortBtn = document.createElement('button');
  resetSortBtn.type = 'button';
  resetSortBtn.textContent = t('feature.shopRestock.defaultOrder');
  resetSortBtn.style.cssText = [
    'padding:2px 8px', 'margin-right:8px', 'font-size:10px', 'font-weight:600',
    'border-radius:9999px', 'cursor:pointer',
    'border:1px solid var(--qpm-accent-focus)', 'background:var(--qpm-accent-subtle)',
    'color:var(--qpm-accent-hover)', 'display:none',
  ].join(';');
  const itemCountEl = document.createElement('span');
  itemCountEl.style.cssText = 'font-size:12px;color:var(--qpm-text-muted);';
  histHeader.append(histTitle, resetSortBtn, itemCountEl);

  const tableWrap = document.createElement('div');
  tableWrap.style.cssText = 'flex:1;overflow-y:auto;min-height:0;';
  tableWrap.dataset.tour = 'restock-items';
  histSection.append(histHeader, tableWrap);
  return { histSection, resetSortBtn, itemCountEl, tableWrap };
}
