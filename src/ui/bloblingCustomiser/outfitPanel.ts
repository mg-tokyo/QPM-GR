import { t } from '../../i18n';
import {
  getSession, getCart, getCartTotal, getCurrentEntry,
  equipOwnedSlots, resetToEquipped, SLOT_CONFIG,
} from '../../features/bloblingCustomiser';
import { startInWorldPreview } from '../../features/bloblingCustomiser/avatarPreview';
import { getCosmeticCdnUrl } from '../../features/bloblingCustomiser/cosmeticApi';
import { showPurchasePopup } from './purchasePopup';
import { createButton, type ButtonOptions } from '../components/button';

export interface OutfitPanelHandle {
  refresh(): void;
  destroy(): void;
}

function makeFullWidthButton(
  label: string,
  variant: NonNullable<ButtonOptions['variant']>,
  onClick: () => void,
  options: { disabled?: boolean; size?: NonNullable<ButtonOptions['size']> } = {},
): HTMLButtonElement {
  const opts: ButtonOptions = { variant, onClick };
  if (options.size !== undefined) opts.size = options.size;
  if (options.disabled !== undefined) opts.disabled = options.disabled;
  const btn = createButton(label, opts);
  btn.style.width = '100%';
  return btn;
}

export function renderOutfitPanel(container: HTMLElement): OutfitPanelHandle {
  let cancelPreview: (() => void) | null = null;
  // Ref to the LIVE preview button. refresh() rewires this on every rebuild,
  // so the onTick closure below always writes to the button currently in the
  // DOM — not the orphan that was detached by actionsContainer.innerHTML = ''.
  const previewBtnRef: { current: HTMLButtonElement | null } = { current: null };

  const outfitSection = document.createElement('div');
  outfitSection.style.cssText = 'background:rgba(32,36,52,0.55);border:1px solid var(--qpm-border);border-radius:var(--qpm-radius-md);padding:var(--qpm-space-5);box-shadow:inset 0 0 0 1px rgba(255,255,255,0.03);';
  container.appendChild(outfitSection);

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  container.appendChild(spacer);

  const actionsContainer = document.createElement('div');
  actionsContainer.style.cssText = 'display:flex;flex-direction:column;gap:var(--qpm-space-3);';
  container.appendChild(actionsContainer);

  function refresh(): void {
    const session = getSession();
    if (!session) return;

    outfitSection.innerHTML = '';
    const header = document.createElement('div');
    header.style.cssText = 'font-size:var(--qpm-font-xs);font-weight:var(--qpm-weight-bold);color:var(--qpm-text-muted);letter-spacing:1px;margin-bottom:var(--qpm-space-4);';
    header.textContent = t('feature.bloblingCustomiser.outfit').toUpperCase();
    outfitSection.appendChild(header);

    for (const cfg of SLOT_CONFIG) {
      const entry = getCurrentEntry(cfg.type);
      const isLast = cfg === SLOT_CONFIG[SLOT_CONFIG.length - 1];

      const row = document.createElement('div');
      row.style.cssText = `display:flex;align-items:center;gap:var(--qpm-space-4);padding:var(--qpm-space-2) 0;${isLast ? '' : 'border-bottom:1px solid var(--qpm-divider);'}`;

      const thumb = document.createElement('div');
      const thumbGlow = `radial-gradient(circle at center, ${cfg.arrowColor}33 0%, ${cfg.arrowColor}14 55%, rgba(255,255,255,0.04) 100%)`;
      thumb.style.cssText = `width:28px;height:28px;flex-shrink:0;border-radius:var(--qpm-radius-sm);background:${thumbGlow};border:1px solid var(--qpm-border);display:flex;align-items:center;justify-content:center;overflow:hidden;`;
      if (entry?.filename) {
        const img = document.createElement('img');
        img.src = getCosmeticCdnUrl(entry.filename);
        const thumbScale = cfg.type === 'Expression' ? 1.45 : 1.18;
        img.style.cssText = `width:100%;height:100%;object-fit:contain;image-rendering:pixelated;transform:scale(${thumbScale});`;
        img.alt = '';
        img.loading = 'lazy';
        img.addEventListener('error', () => { img.style.display = 'none'; });
        thumb.appendChild(img);
      }
      row.appendChild(thumb);

      const name = document.createElement('div');
      name.style.cssText = 'flex:1;min-width:0;font-size:var(--qpm-font-body);color:var(--qpm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      name.textContent = entry?.displayName ?? t('feature.bloblingCustomiser.slotNone');
      row.appendChild(name);

      const status = document.createElement('div');
      status.style.cssText = 'font-size:var(--qpm-font-caption);flex-shrink:0;';
      if (entry) {
        const owned = session.ownershipSet.has(entry.filename);
        if (owned) {
          status.style.color = 'var(--qpm-positive)';
          status.textContent = '✓';
        } else if (entry.price > 0) {
          status.style.color = 'var(--qpm-gold)';
          status.textContent = `\u{1F35E} ${entry.price.toLocaleString()}`;
        }
      }
      row.appendChild(status);
      outfitSection.appendChild(row);
    }

    const cart = getCart();
    if (cart.length > 0) {
      const totalRow = document.createElement('div');
      totalRow.style.cssText = 'display:flex;justify-content:space-between;align-items:center;border-top:1px solid var(--qpm-accent-subtle);padding-top:var(--qpm-space-4);margin-top:var(--qpm-space-3);font-size:var(--qpm-font-body);font-weight:var(--qpm-weight-semibold);';
      const totalLabel = document.createElement('span');
      totalLabel.style.color = 'var(--qpm-text-muted)';
      totalLabel.textContent = t('feature.bloblingCustomiser.cartTotal');
      totalRow.appendChild(totalLabel);
      const totalValue = document.createElement('span');
      totalValue.style.color = 'var(--qpm-gold)';
      totalValue.textContent = `\u{1F35E} ${getCartTotal().toLocaleString()}`;
      totalRow.appendChild(totalValue);
      outfitSection.appendChild(totalRow);
    }

    actionsContainer.innerHTML = '';

    const resetBtn = makeFullWidthButton(
      `\u{21A9} ${t('feature.bloblingCustomiser.reset')}`,
      'ghost',
      () => { resetToEquipped(); },
      { size: 'sm' },
    );
    actionsContainer.appendChild(resetBtn);

    const previewLabel = session.previewActive
      ? t('feature.bloblingCustomiser.previewing', { seconds: String(Math.max(0, Math.ceil((session.previewEndTime - Date.now()) / 1000))) })
      : `\u{1F441} ${t('feature.bloblingCustomiser.preview')}`;
    const previewBtn = makeFullWidthButton(
      previewLabel,
      'tonal',
      () => {
        if (!session || session.previewActive) return;
        session.previewActive = true;
        session.previewEndTime = Date.now() + 60_000;

        cancelPreview = startInWorldPreview(
          session.selectedSlots,
          session.selectedColor,
          (remaining) => {
            // Read the LIVE button from the ref — refresh() rebuilds the
            // button on every session change, so capturing the local
            // previewBtn would write to a detached element.
            const btn = previewBtnRef.current;
            if (btn) btn.textContent = t('feature.bloblingCustomiser.previewing', { seconds: String(remaining) });
          },
          () => {
            if (!session) return;
            session.previewActive = false;
            session.previewEndTime = 0;
            cancelPreview = null;
            refresh();
          },
        );
        refresh();
      },
      { disabled: session.previewActive },
    );
    previewBtnRef.current = previewBtn;
    actionsContainer.appendChild(previewBtn);

    const equipBtn = makeFullWidthButton(
      `✓ ${t('feature.bloblingCustomiser.equipOwned')}`,
      'confirm',
      () => {
        const result = equipOwnedSlots();
        if (result.ok && cancelPreview) {
          cancelPreview();
          cancelPreview = null;
        }
        refresh();
      },
    );
    actionsContainer.appendChild(equipBtn);

    if (cart.length > 0) {
      const buyAllBtn = makeFullWidthButton(
        `\u{1F6D2} ${t('feature.bloblingCustomiser.buyAndEquip')} · \u{1F35E} ${getCartTotal().toLocaleString()}`,
        'primary',
        () => {
          showPurchasePopup(cart, () => refresh());
        },
      );
      actionsContainer.appendChild(buyAllBtn);
    }
  }

  refresh();

  return {
    refresh,
    destroy(): void {
      if (cancelPreview) {
        cancelPreview();
        cancelPreview = null;
      }
    },
  };
}
