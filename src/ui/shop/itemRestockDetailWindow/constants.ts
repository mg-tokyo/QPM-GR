import type { Tier } from './types';

export const INITIAL_ROWS = 5;
export const DETAIL_WINDOW_REGISTRY_KEY = 'qpm.restock.detailWindows.v1';
export const DETAIL_WINDOW_REGISTRY_MAX = 160;
export const ARIEDAM_KEY = 'qpm.ariedam.gamedata';
export const DETAIL_WINDOW_SCALE_KEY = 'qpm.restock.detailScale.v1';
export const DETAIL_WINDOW_SCALE_MIN = 0.5;
export const DETAIL_WINDOW_SCALE_MAX = 2.2;
export const DETAIL_WINDOW_SCALE_DEFAULT = 1;

export const TIER_COLOR: Record<Tier, string> = {
  good: '#4ade80',
  warn: '#fbbf24',
  bad:  '#f87171',
  none: 'rgba(143,130,255,0.22)',
};

export const CARD_STYLE = [
  'flex-shrink:0',
  'margin:12px 12px 0',
  'border-radius:12px',
  'border:1px solid rgba(143,130,255,0.3)',
  'background:rgba(143,130,255,0.06)',
  'overflow:hidden',
].join(';');
