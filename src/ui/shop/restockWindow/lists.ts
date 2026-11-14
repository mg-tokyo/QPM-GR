import { openItemRestockDetail } from '../itemRestockDetailWindow';
import { getItemProbability, type RestockItem } from '../../../utils/restock/dataService';
import { t } from '../../../i18n';
import { getShopOrder, ITEM_HIDDEN, ITEM_EXPIRY } from '../restockWindowConstants';
import {
  getItemName,
  getCatalogOrder,
  isCelestial,
  type SortColumn,
  type SortDirection,
} from '../restockWindowMeta';
import { buildPredRow, type EtaRef } from '../restockWindowRows';
import { TH_BASE } from './constants';

export function renderPinnedRows(
  predBody: HTMLDivElement,
  allData: RestockItem[],
  trackedItems: Set<string>,
  onUnpin: (key: string) => void,
): { etaRefs: EtaRef[]; cleanups: Array<() => void> } {
  predBody.innerHTML = '';
  const etaRefs: EtaRef[] = [];
  const cleanups: Array<() => void> = [];
  const frag = document.createDocumentFragment();

  const pinned = allData
    .filter(item => trackedItems.has(`${item.shop_type}:${item.item_id}`))
    .sort((a, b) => {
      const aEmpty = (a.total_occurrences ?? 0) < 2 || !(a.estimated_next_timestamp ?? 0);
      const bEmpty = (b.total_occurrences ?? 0) < 2 || !(b.estimated_next_timestamp ?? 0);
      if (aEmpty && !bEmpty) return 1;
      if (!aEmpty && bEmpty) return -1;
      return (getItemProbability(b) ?? -1) - (getItemProbability(a) ?? -1);
    });

  if (!pinned.length) {
    const empty = document.createElement('div');
    empty.style.cssText = 'padding:8px 4px;font-size:12px;color:var(--qpm-text-muted);font-style:italic;';
    empty.textContent = t('feature.shopRestock.pinHint');
    frag.appendChild(empty);
    predBody.appendChild(frag);
    return { etaRefs, cleanups };
  }

  for (const item of pinned) {
    const key = `${item.shop_type}:${item.item_id}`;
    const { row, etaRef, cleanups: rowCleanups } = buildPredRow(item, key, {
      onUnpin,
      openDetail: openItemRestockDetail,
    });
    frag.appendChild(row);
    etaRefs.push(etaRef);
    cleanups.push(...rowCleanups);
  }

  const hint = document.createElement('div');
  hint.style.cssText = 'padding:8px 12px 4px;font-size:12px;opacity:0.5;';
  hint.textContent = t('feature.shopRestock.unpinHint');
  frag.appendChild(hint);
  predBody.appendChild(frag);
  return { etaRefs, cleanups };
}

export function filterAndSortHistory(
  allData: RestockItem[],
  trackedItems: Set<string>,
  currentFilter: string,
  search: string,
  sortColumn: SortColumn,
  sortDirection: SortDirection,
  now: number,
): RestockItem[] {
  let filtered = allData.filter(item => {
    const key = `${item.shop_type}:${item.item_id}`;
    if (trackedItems.has(key)) return false;           // pinned items not shown in history

    const expiryMs = ITEM_EXPIRY[key] ?? null;
    if (expiryMs && expiryMs <= now) return false;     // expired seasonal items
    if (ITEM_HIDDEN.has(key)) return false;             // manually hidden entries

    if (currentFilter === 'celestial') {
      if (!isCelestial(item.item_id)) return false;
    } else if (currentFilter !== 'all') {
      if (item.shop_type !== currentFilter) return false;
    }

    if (search) {
      const name = getItemName(item.item_id, item.shop_type).toLowerCase();
      if (!name.includes(search) && !(item.item_id ?? '').toLowerCase().includes(search)) return false;
    }
    return true;
  });

  if (sortColumn) {
    filtered = filtered.slice().sort((a, b) => {
      let aVal: unknown;
      let bVal: unknown;
      if (sortColumn === 'item') {
        aVal = getItemName(a.item_id, a.shop_type).toLowerCase();
        bVal = getItemName(b.item_id, b.shop_type).toLowerCase();
      } else if (sortColumn === 'qty') {
        aVal = a.total_quantity ?? (a.total_occurrences ?? 0);
        bVal = b.total_quantity ?? (b.total_occurrences ?? 0);
      } else { // last
        aVal = a.last_seen ?? 0;
        bVal = b.last_seen ?? 0;
      }
      if (aVal === bVal) return 0;
      const cmp = (aVal as number) > (bVal as number) ? 1 : -1;
      return sortDirection === 'asc' ? cmp : -cmp;
    });
  } else {
    // Default: shop type (Seeds/Eggs/Decor) -> in-game catalog order -> name fallback
    filtered = filtered.slice().sort((a, b) => {
      const shopA = getShopOrder(a.shop_type);
      const shopB = getShopOrder(b.shop_type);
      if (shopA !== shopB) return shopA - shopB;

      const orderA = getCatalogOrder(a.item_id, a.shop_type);
      const orderB = getCatalogOrder(b.item_id, b.shop_type);
      if (orderA !== null || orderB !== null) {
        if (orderA === null) return 1;
        if (orderB === null) return -1;
        if (orderA !== orderB) return orderA - orderB;
      }

      return getItemName(a.item_id, a.shop_type)
        .localeCompare(getItemName(b.item_id, b.shop_type), undefined, { sensitivity: 'base' });
    });
  }
  return filtered;
}

export function buildHistoryTable(
  sortColumn: SortColumn,
  sortDirection: SortDirection,
  onSort: (col: Exclude<SortColumn, null>) => void,
): { table: HTMLTableElement; tbody: HTMLTableSectionElement } {
  const sortIndicator = (col: 'item' | 'qty' | 'last'): string => {
    if (sortColumn !== col) return '';
    return sortDirection === 'asc' ? ' ^' : ' v';
  };

  const table = document.createElement('table');
  table.style.cssText = 'width:100%;border-collapse:separate;border-spacing:0 2px;font-size:12px;';

  const thead = document.createElement('thead');
  const hr = document.createElement('tr');

  const thItem = document.createElement('th');
  thItem.className = 'qpm-sr-th';
  thItem.style.cssText = TH_BASE + 'text-align:left;width:60%;';
  thItem.textContent = `${t('feature.shopRestock.thItem')}${sortIndicator('item')}`;
  thItem.addEventListener('click', () => onSort('item'));

  const thQty = document.createElement('th');
  thQty.className = 'qpm-sr-th';
  thQty.style.cssText = TH_BASE + 'text-align:center;width:20%;';
  thQty.textContent = `${t('feature.shopRestock.thQty')}${sortIndicator('qty')}`;
  thQty.addEventListener('click', () => onSort('qty'));

  const thLast = document.createElement('th');
  thLast.className = 'qpm-sr-th';
  thLast.style.cssText = TH_BASE + 'text-align:right;width:20%;';
  thLast.textContent = `${t('feature.shopRestock.thSeen')}${sortIndicator('last')}`;
  thLast.addEventListener('click', () => onSort('last'));

  const thDetail = document.createElement('th');
  thDetail.style.cssText = TH_BASE + 'text-align:center;width:48px;';

  hr.append(thItem, thQty, thLast, thDetail);
  thead.appendChild(hr);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  table.appendChild(tbody);
  return { table, tbody };
}
