import { renderIcon } from './icon';
import { formatNumber } from '../../utils/formatters';

export interface CurrencyAmountOptions {
  size?: number;
  compact?: boolean;   // e.g. "25.00K" instead of "25,000"
}

interface CurrencyStyle {
  spriteKey: string;
  color: string;
}

// Mirrors the game's currency → icon table (v1361 RightSideRailIconFace `at`); keys are the
// catalog's currency ids.
const CURRENCY_STYLES: Readonly<Record<string, CurrencyStyle>> = {
  coins: { spriteKey: 'sprite/ui/Coin', color: 'var(--qpm-gold)' },
  magicDust: { spriteKey: 'sprite/item/MagicDust', color: 'var(--qpm-dust)' },
  credits: { spriteKey: 'sprite/ui/Donut', color: 'var(--qpm-credits)' },
};

// Unknown or missing currency renders the amount alone, never a stand-in icon.
export function createCurrencyAmount(
  currency: string | null | undefined,
  amount: number,
  options: CurrencyAmountOptions = {},
): HTMLElement {
  const { size = 12, compact = false } = options;
  const style = currency ? CURRENCY_STYLES[currency] : undefined;

  const wrap = document.createElement('span');
  wrap.style.cssText = 'display:inline-flex;align-items:center;gap:var(--qpm-space-2);white-space:nowrap;';
  if (style) wrap.appendChild(renderIcon(style.spriteKey, { size }));

  const value = document.createElement('span');
  value.style.fontWeight = 'var(--qpm-weight-semibold)';
  if (style) value.style.color = style.color;
  value.textContent = compact ? formatNumber(amount) : amount.toLocaleString();
  wrap.appendChild(value);
  return wrap;
}
