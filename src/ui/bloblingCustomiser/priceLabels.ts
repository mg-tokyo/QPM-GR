import { t } from '../../i18n';
import { createCurrencyAmount, type CurrencyAmountOptions } from '../components/currencyAmount';
import type { CosmeticCatalogEntry, CurrencyTotal } from '../../features/bloblingCustomiser';

function createFreeLabel(): HTMLElement {
  const free = document.createElement('span');
  free.style.fontWeight = 'var(--qpm-weight-semibold)';
  free.textContent = t('feature.bloblingCustomiser.free');
  return free;
}

export function createPriceLabel(entry: CosmeticCatalogEntry, options: CurrencyAmountOptions = {}): HTMLElement {
  return entry.price > 0 ? createCurrencyAmount(entry.currency, entry.price, options) : createFreeLabel();
}

export function createTotalsLabel(totals: readonly CurrencyTotal[], options: CurrencyAmountOptions = {}): HTMLElement {
  if (!totals.length) return createFreeLabel();
  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;flex-wrap:wrap;justify-content:flex-end;align-items:center;gap:var(--qpm-space-2) var(--qpm-space-4);';
  for (const total of totals) wrap.appendChild(createCurrencyAmount(total.currency, total.amount, options));
  return wrap;
}

export function buyAndEquipLabel(count: number): string {
  return count === 1
    ? t('feature.bloblingCustomiser.buyAndEquipOne')
    : t('feature.bloblingCustomiser.buyAndEquipCount', { count: String(count) });
}
