import { t } from '../../i18n';
import { notify } from '../../core/notifications';
import { claimCosmetic, getCosmeticCdnUrl } from '../../features/bloblingCustomiser/cosmeticApi';
import {
  markOwned, equipFullOutfit, getSession, readCurrentOutfit,
  SLOT_TYPES, SLOT_CONFIG,
  type CartItem, type CosmeticColor,
} from '../../features/bloblingCustomiser';
import { createButton } from '../components/button';

export function showPurchasePopup(items: CartItem[], onComplete: () => void): void {
  if (!items.length) return;

  const isSingle = items.length === 1;
  const total = items.reduce((sum, item) => sum + item.entry.price, 0);

  const overlay = document.createElement('div');
  overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);display:flex;align-items:center;justify-content:center;z-index:99999;backdrop-filter:blur(2px);';

  const popup = document.createElement('div');
  popup.style.cssText = 'background:var(--qpm-surface-window);border:1px solid var(--qpm-accent-focus);border-radius:var(--qpm-radius-lg);padding:var(--qpm-space-7);min-width:280px;max-width:360px;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:var(--qpm-font);';

  const title = document.createElement('div');
  title.style.cssText = 'font-size:var(--qpm-font-subtitle);font-weight:var(--qpm-weight-semibold);color:var(--qpm-text);margin-bottom:var(--qpm-space-6);';
  title.textContent = isSingle
    ? t('feature.bloblingCustomiser.buyCosmetic')
    : t('feature.bloblingCustomiser.buyMultiple', { count: String(items.length) });
  popup.appendChild(title);

  const list = document.createElement('div');
  list.style.cssText = 'display:flex;flex-direction:column;gap:var(--qpm-space-4);margin-bottom:var(--qpm-space-6);';

  const statusEls = new Map<string, HTMLElement>();

  for (const item of items) {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:10px;';

    const thumbWrap = document.createElement('div');
    const slotColor = SLOT_CONFIG.find(c => c.type === item.slot)?.arrowColor ?? '#8f82ff';
    const thumbGlow = `radial-gradient(circle at center, ${slotColor}33 0%, ${slotColor}14 55%, rgba(255,255,255,0.04) 100%)`;
    thumbWrap.style.cssText = `width:36px;height:36px;flex-shrink:0;border-radius:var(--qpm-radius-sm);background:${thumbGlow};display:flex;align-items:center;justify-content:center;overflow:hidden;`;
    const thumb = document.createElement('img');
    thumb.src = getCosmeticCdnUrl(item.entry.filename);
    const popupScale = item.slot === 'Expression' ? 1.45 : 1.18;
    thumb.style.cssText = `width:100%;height:100%;object-fit:contain;image-rendering:pixelated;transform:scale(${popupScale});`;
    thumb.onerror = () => { thumbWrap.style.display = 'none'; };
    thumbWrap.appendChild(thumb);
    row.appendChild(thumbWrap);

    const info = document.createElement('div');
    info.style.cssText = 'flex:1;min-width:0;';
    const nameEl = document.createElement('div');
    nameEl.style.cssText = 'font-size:var(--qpm-font-body);color:var(--qpm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
    nameEl.textContent = item.entry.displayName;
    info.appendChild(nameEl);
    const slotEl = document.createElement('div');
    slotEl.style.cssText = 'font-size:var(--qpm-font-xs);color:rgba(224,224,224,0.35);';
    slotEl.textContent = item.slot;
    info.appendChild(slotEl);
    row.appendChild(info);

    const priceStatus = document.createElement('div');
    priceStatus.style.cssText = 'font-size:var(--qpm-font-body);color:var(--qpm-gold);text-align:right;';
    priceStatus.textContent = `\u{1F35E} ${item.entry.price.toLocaleString()}`;
    row.appendChild(priceStatus);
    statusEls.set(item.entry.filename, priceStatus);

    list.appendChild(row);
  }
  popup.appendChild(list);

  if (!isSingle) {
    const totalRow = document.createElement('div');
    totalRow.style.cssText = 'display:flex;justify-content:space-between;padding:var(--qpm-space-4) 0;border-top:1px solid var(--qpm-accent-tint);margin-bottom:var(--qpm-space-6);font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-semibold);';
    const totalLabel = document.createElement('span');
    totalLabel.style.color = 'var(--qpm-text-muted)';
    totalLabel.textContent = t('feature.bloblingCustomiser.cartTotal');
    totalRow.appendChild(totalLabel);
    const totalValue = document.createElement('span');
    totalValue.style.color = 'var(--qpm-gold)';
    totalValue.textContent = `\u{1F35E} ${total.toLocaleString()}`;
    totalRow.appendChild(totalValue);
    popup.appendChild(totalRow);
  }

  const errorArea = document.createElement('div');
  errorArea.style.cssText = 'font-size:var(--qpm-font-caption);color:var(--qpm-danger);margin-bottom:var(--qpm-space-4);display:none;';
  popup.appendChild(errorArea);

  const buttonRow = document.createElement('div');
  buttonRow.style.cssText = 'display:flex;gap:var(--qpm-space-4);justify-content:flex-end;';

  const cancelBtn = createButton(t('feature.bloblingCustomiser.cancel'), {
    variant: 'ghost',
    onClick: close,
  });
  buttonRow.appendChild(cancelBtn);

  let buyMode: 'execute' | 'close' = 'execute';
  const buyLabel = isSingle
    ? `${t('feature.bloblingCustomiser.buy')} · \u{1F35E} ${total.toLocaleString()}`
    : `${t('feature.bloblingCustomiser.buyAndEquip')} · \u{1F35E} ${total.toLocaleString()}`;
  const buyBtn = createButton(buyLabel, {
    variant: 'tonal',
    onClick: () => {
      if (buyMode === 'close') close();
      else void executePurchase();
    },
  });
  buttonRow.appendChild(buyBtn);

  popup.appendChild(buttonRow);
  overlay.appendChild(popup);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  document.body.appendChild(overlay);

  function close(): void {
    overlay.remove();
  }

  async function executePurchase(): Promise<void> {
    buyBtn.disabled = true;
    cancelBtn.disabled = true;
    buyBtn.style.opacity = '0.5';
    errorArea.style.display = 'none';

    const succeeded: CartItem[] = [];
    const failed: Array<{ item: CartItem; error: string }> = [];

    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      if (!isSingle) {
        buyBtn.textContent = t('feature.bloblingCustomiser.buying', {
          current: String(i + 1),
          total: String(items.length),
        });
      }

      const result = await claimCosmetic(item.entry.filename);
      const statusEl = statusEls.get(item.entry.filename);

      if (result.ok) {
        markOwned(item.entry.filename);
        succeeded.push(item);
        if (statusEl) {
          statusEl.style.color = 'var(--qpm-positive)';
          statusEl.textContent = '✓';
        }
      } else {
        failed.push({ item, error: result.error ?? 'Unknown error' });
        if (statusEl) {
          statusEl.style.color = 'var(--qpm-danger)';
          statusEl.textContent = '✗';
        }
      }
    }

    if (failed.length > 0) {
      errorArea.style.display = 'block';
      errorArea.textContent = failed.map(f =>
        t('feature.bloblingCustomiser.purchaseFailed', { name: f.item.entry.displayName }),
      ).join('. ');
      buyBtn.textContent = 'Close';
      buyBtn.disabled = false;
      buyBtn.style.opacity = '1';
      buyMode = 'close';
    } else {
      if (succeeded.length > 0) {
        const session = getSession();
        if (session) {
          const { avatar: current } = readCurrentOutfit();
          const avatar = SLOT_TYPES.map((slot, i) => {
            return session.selectedSlots[slot] ?? (current[i] as string) ?? '';
          }) as [string, string, string, string];
          equipFullOutfit(avatar, session.selectedColor as CosmeticColor);
        }
        notify({
          feature: 'bloblingCustomiser',
          level: 'success',
          message: succeeded.length === 1
            ? t('feature.bloblingCustomiser.purchaseSuccess', { name: succeeded[0]!.entry.displayName })
            : `Purchased ${succeeded.length} cosmetics`,
        });
      }
      close();
    }

    onComplete();
  }
}
