import { createCard } from '../panelHelpers';
import { createToggle } from '../components/toggle';
import { createKeybindButton } from '../petsWindow/helpers';
import {
  getShopKeybind,
  setShopKeybind,
  clearShopKeybind,
  isShopKeybindsEnabled,
  setShopKeybindsEnabled,
  type ShopId,
} from '../../features/shopKeybinds';
import { t } from '../../i18n';

const SHOP_IDS: readonly ShopId[] = ['seedShop', 'eggShop', 'toolShop', 'decorShop'];

const SHOP_I18N_KEYS: Record<ShopId, string> = {
  seedShop: 'feature.shopKeybinds.seedShop',
  eggShop: 'feature.shopKeybinds.eggShop',
  toolShop: 'feature.shopKeybinds.toolShop',
  decorShop: 'feature.shopKeybinds.decorShop',
};

/** Inline styles matching .qpm-keybind-input so the button renders correctly
 *  even when the pets window stylesheet hasn't been injected. */
const KEYBIND_BTN_STYLE = [
  'width:110px',
  'text-align:center',
  'background:rgba(255,255,255,0.06)',
  'border:1px solid rgba(143,130,255,0.25)',
  'border-radius:4px',
  'color:var(--qpm-text, #eef0ff)',
  'font-family:inherit',
  'font-size:12px',
  'padding:4px 8px',
  'outline:none',
  'cursor:pointer',
  'white-space:nowrap',
  'overflow:hidden',
  'text-overflow:ellipsis',
].join(';');

export function createShopKeybindsSection(): HTMLElement {
  const { root, body } = createCard(t('hub.config.shopKeybinds.label'));
  root.dataset.qpmSection = 'shop-keybinds';

  // Toggle row
  const toggleRow = document.createElement('div');
  toggleRow.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'gap:8px',
    'padding:8px 12px',
    'border-radius:8px',
    'border:1px solid rgba(255,255,255,0.08)',
    'background:rgba(255,255,255,0.03)',
  ].join(';');

  const toggleTitle = document.createElement('div');
  toggleTitle.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-text,#fff);';
  toggleTitle.textContent = t('feature.shopKeybinds.enableToggle');

  const { root: toggleEl } = createToggle({
    checked: isShopKeybindsEnabled(),
    onChange: (checked) => {
      setShopKeybindsEnabled(checked);
      syncEnabled();
    },
  });

  toggleRow.append(toggleTitle, toggleEl);
  body.appendChild(toggleRow);

  // Keybind rows container
  const bindsWrap = document.createElement('div');
  bindsWrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  body.appendChild(bindsWrap);

  function syncEnabled(): void {
    const on = isShopKeybindsEnabled();
    bindsWrap.style.opacity = on ? '1' : '0.45';
    bindsWrap.style.pointerEvents = on ? '' : 'none';
  }

  for (const shopId of SHOP_IDS) {
    const row = document.createElement('div');
    row.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:8px',
      'padding:8px 12px',
      'border-radius:8px',
      'border:1px solid rgba(255,255,255,0.08)',
      'background:rgba(255,255,255,0.03)',
    ].join(';');

    const label = document.createElement('div');
    label.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-text,#fff);';
    label.textContent = t(SHOP_I18N_KEYS[shopId]);

    const kbBtn = createKeybindButton({
      onSet: (combo) => setShopKeybind(shopId, combo),
      onClear: () => clearShopKeybind(shopId),
      readCurrent: () => getShopKeybind(shopId),
    });
    kbBtn.style.cssText = KEYBIND_BTN_STYLE;

    row.append(label, kbBtn);
    bindsWrap.appendChild(row);
  }

  syncEnabled();
  return root;
}
