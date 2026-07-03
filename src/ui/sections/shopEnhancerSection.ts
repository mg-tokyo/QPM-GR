// src/ui/sections/shopEnhancerSection.ts
// Three-state control for QPM's shop enhancer feature. When Aries Mod is
// detected, QPM's enhancer duplicates Aries's Buy All + reorder — the
// default 'auto' mode skips QPM's version to avoid double work.
// See src/integrations/ariesDetection.ts and src/features/shop/enhancer.

import {
  storage,
  SHOP_ENHANCER_MODE_KEY,
  SHOP_ENHANCER_MODES,
  type ShopEnhancerMode,
} from '../../utils/storage';
import { getAriesDetectionInfo } from '../../integrations/ariesDetection';
import { t } from '../../i18n';

export function createShopEnhancerSection(): HTMLElement {
  const root = document.createElement('div');
  root.dataset.qpmSection = 'shop-enhancer';
  root.style.cssText = 'display:flex;flex-direction:column;gap:10px;';

  // Detection status line — small, muted.
  const status = document.createElement('div');
  status.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.55);padding:0 2px;';
  root.appendChild(status);

  // Caption
  const caption = document.createElement('div');
  caption.style.cssText = 'font-size:12px;color:rgba(224,224,224,0.7);line-height:1.4;padding:0 2px;';
  caption.textContent = t('feature.shopEnhancer.settingCaption');
  root.appendChild(caption);

  const controlRow = document.createElement('div');
  controlRow.style.cssText = 'display:flex;gap:6px;';
  root.appendChild(controlRow);

  const labels: Record<ShopEnhancerMode, string> = {
    'auto':       t('feature.shopEnhancer.modeAuto'),
    'force-on':   t('feature.shopEnhancer.modeForceOn'),
    'force-off':  t('feature.shopEnhancer.modeForceOff'),
  };

  const current = (storage.get(SHOP_ENHANCER_MODE_KEY) as ShopEnhancerMode | null) ?? 'auto';
  const buttons: Partial<Record<ShopEnhancerMode, HTMLButtonElement>> = {};

  const paintSelection = (mode: ShopEnhancerMode): void => {
    for (const m of SHOP_ENHANCER_MODES) {
      const btn = buttons[m];
      if (!btn) continue;
      const active = m === mode;
      btn.style.background = active ? 'rgba(143,130,255,0.20)' : 'rgba(255,255,255,0.04)';
      btn.style.borderColor = active ? 'rgba(143,130,255,0.5)' : 'rgba(255,255,255,0.12)';
      btn.style.color = active ? '#e8e0ff' : 'rgba(224,224,224,0.75)';
    }
  };

  const paintStatus = (): void => {
    const info = getAriesDetectionInfo();
    status.textContent = info.detected
      ? t('feature.shopEnhancer.statusDetected', { via: info.detectedVia ?? '' })
      : t('feature.shopEnhancer.statusNotDetected');
  };

  for (const mode of SHOP_ENHANCER_MODES) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = labels[mode];
    btn.style.cssText = [
      'flex:1',
      'padding:6px 10px',
      'border-radius:8px',
      'border:1px solid rgba(255,255,255,0.12)',
      'background:rgba(255,255,255,0.04)',
      'color:rgba(224,224,224,0.75)',
      'font-family:inherit',
      'font-size:12px',
      'font-weight:600',
      'cursor:pointer',
      'transition:background 120ms ease,border-color 120ms ease,color 120ms ease',
    ].join(';');
    btn.addEventListener('click', () => {
      storage.set(SHOP_ENHANCER_MODE_KEY, mode);
      paintSelection(mode);
      // Note: mode change takes effect on next page reload.
    });
    buttons[mode] = btn;
    controlRow.appendChild(btn);
  }

  paintSelection(current);
  paintStatus();

  return root;
}
