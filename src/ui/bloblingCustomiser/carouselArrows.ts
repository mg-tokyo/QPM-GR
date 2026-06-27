import { SLOT_CONFIG, type SlotType, type CosmeticCatalogEntry } from '../../features/bloblingCustomiser/types';

export interface CarouselHandle {
  showTooltip(text: string, priceText?: string): void;
  hideTooltip(): void;
  destroy(): void;
}

const SLOT_POSITIONS: Record<SlotType, string> = {
  Top: '26.5%',
  Expression: '42.6%',
  Mid: '57.4%',
  Bottom: '73.5%',
};

function makeArrowButton(color: string, direction: 'left' | 'right'): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  const glyph = direction === 'left' ? '◂' : '▸';
  btn.textContent = glyph;
  btn.style.cssText = `width:32px;height:32px;border-radius:50%;border:1.5px solid ${color}55;background:${color}14;color:${color};font-size:var(--qpm-font-subtitle);cursor:pointer;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px);transition:all 0.15s;position:absolute;z-index:5;padding:0;line-height:1;`;
  btn.addEventListener('mouseenter', () => { btn.style.background = `${color}33`; });
  btn.addEventListener('mouseleave', () => { btn.style.background = `${color}14`; });
  return btn;
}

export function renderCarouselArrows(
  previewArea: HTMLElement,
  onCycle: (slot: SlotType, direction: 1 | -1) => CosmeticCatalogEntry | null,
): CarouselHandle {
  const elements: HTMLElement[] = [];
  let tooltipTimer: ReturnType<typeof setTimeout> | null = null;

  const tooltip = document.createElement('div');
  tooltip.setAttribute('data-qpm-tooltip', '');
  tooltip.style.cssText = 'position:absolute;top:var(--qpm-space-6);left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);padding:var(--qpm-space-3) var(--qpm-space-6);border-radius:var(--qpm-radius-lg);font-size:var(--qpm-font-body);color:var(--qpm-text);white-space:nowrap;pointer-events:none;box-shadow:0 2px 8px rgba(0,0,0,0.3);opacity:0;transition:opacity 0.2s;z-index:10;';
  previewArea.appendChild(tooltip);

  function showTooltip(text: string, priceText?: string): void {
    tooltip.textContent = '';
    tooltip.appendChild(document.createTextNode(text));
    if (priceText) {
      tooltip.appendChild(document.createTextNode(' · '));
      const price = document.createElement('span');
      price.style.color = 'var(--qpm-gold)';
      price.textContent = priceText;
      tooltip.appendChild(price);
    }
    tooltip.style.opacity = '1';

    if (tooltipTimer) clearTimeout(tooltipTimer);
    tooltipTimer = setTimeout(() => { tooltip.style.opacity = '0'; }, 2000);
  }

  function hideTooltip(): void {
    tooltip.style.opacity = '0';
    if (tooltipTimer) { clearTimeout(tooltipTimer); tooltipTimer = null; }
  }

  function formatPrice(entry: CosmeticCatalogEntry, owned: boolean): string {
    if (owned) return 'Owned';
    return entry.price > 0 ? `\u{1F35E} ${entry.price.toLocaleString()}` : 'Free';
  }

  for (const cfg of SLOT_CONFIG) {
    const y = SLOT_POSITIONS[cfg.type];

    const left = makeArrowButton(cfg.arrowColor, 'left');
    left.style.top = y;
    left.style.left = '12px';
    left.addEventListener('click', () => {
      const entry = onCycle(cfg.type, -1);
      if (entry) showTooltip(entry.displayName, formatPrice(entry, false));
    });
    previewArea.appendChild(left);
    elements.push(left);

    const right = makeArrowButton(cfg.arrowColor, 'right');
    right.style.top = y;
    right.style.right = '12px';
    right.addEventListener('click', () => {
      const entry = onCycle(cfg.type, 1);
      if (entry) showTooltip(entry.displayName, formatPrice(entry, false));
    });
    previewArea.appendChild(right);
    elements.push(right);

  }

  return {
    showTooltip,
    hideTooltip,
    destroy(): void {
      for (const el of elements) el.remove();
      tooltip.remove();
      elements.length = 0;
      if (tooltipTimer) clearTimeout(tooltipTimer);
    },
  };
}
