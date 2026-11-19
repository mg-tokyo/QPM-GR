// What the shared panel chrome (multiStorage/chrome.ts) needs to know about a shop panel: where the visible
// shop sits in its cell, how to make it lay out again, its z band, its bar colour and its title.
import type { ChromePanel, PanelKind, PanelMetrics } from '../multiStorage/chrome';
import { NEUTRAL_COLORS, type FrameColors, type HeaderJoin } from '../multiStorage/chromeArt';
import type { PanelFit } from '../multiStorage/layout';
import { snapShopWidth } from './inStockSnap';
import { panelBox, type ShopPanelView } from './panelView';
import { getSavedShopLayout, saveShopLayoutCells } from './settings';

export interface ShopChromePanel extends ChromePanel {
  readonly view: ShopPanelView;
}

// The prototype's shop limits: narrower than 260 a shop row no longer fits its price; the shop stands at the
// top of its cell (below the game's HUD clearance), so nothing of an unplaced cell may sit above the screen.
export const SHOP_FIT: PanelFit = {
  minWidthPx: 260, minHeightPx: 320, minHeightFraction: 0, unplacedAboveShare: 0, shortenAtBottom: true,
};

/** The modal name as words: `seedShop` → `Seed Shop`. The config's `title` is the timer label, not the name. */
export function shopTitle(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function shade(color: number, k: number): string {
  const channel = (shift: number): number => Math.round(Math.max(0, Math.min(255, ((color >> shift) & 255) * k)));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

/** The bar in the shop's own header colour, a shade darker so the shop's header still reads as its top. */
export function shopBarColors(headerColor: unknown): FrameColors {
  if (typeof headerColor !== 'number' || !Number.isFinite(headerColor)) return NEUTRAL_COLORS;
  return { light: shade(headerColor, 1.15), wood: shade(headerColor, 0.78), edge: shade(headerColor, 0.6), inner: shade(headerColor, 0.3) };
}

/**
 * The shop frame's own rounded top corners and its header band's colour, read off the live view (15 and the
 * config's `headerColor` on v2078). Null when unreadable: the bar keeps its square bottom.
 */
export function shopHeaderJoin(view: ShopPanelView): HeaderJoin | null {
  const options = view.frame?.options;
  const radius = options?.cornerRadius;
  const band = options?.headerBand?.color ?? view.shopConfig.headerColor;
  if (typeof radius !== 'number' || !(radius > 0) || !Number.isFinite(radius)) return null;
  if (typeof band !== 'number' || !Number.isFinite(band)) return null;
  return { radius, color: shade(band, 1) };
}

export function shopMetrics(view: ShopPanelView): PanelMetrics | null {
  const box = panelBox(view);
  return box ? { left: box.left, width: box.width, top: box.top, y: box.top, height: box.height } : null;
}

export const shopPanelKind: PanelKind<ShopChromePanel> = {
  fit: SHOP_FIT,
  labels: { header: 'MultiShopBar', grip: 'MultiShopGrip' },
  metrics: panel => shopMetrics(panel.view),
  requestReflow: (panel) => {
    try { panel.view.invalidateLayout(); } catch { /* closed */ }
  },
  rootZ: panel => panel.view.container.zIndex,
  title: panel => shopTitle(panel.id),
  colors: panel => shopBarColors(panel.view.shopConfig.headerColor),
  headerRadius: 8,
  headerJoin: panel => shopHeaderJoin(panel.view),
  layout: { get: getSavedShopLayout, save: saveShopLayoutCells },
  snapWidth: (panel, width, maxWidth) => snapShopWidth(panel.view, width, maxWidth),
};
