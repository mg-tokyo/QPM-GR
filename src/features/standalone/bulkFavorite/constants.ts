import type { BulkFavoriteConfig } from './types';

export const STYLE_ID = 'qpm-bulk-favorite-styles';
export const SIDEBAR_ID = 'qpm-bulk-favorite-sidebar';
export const CONFIG_KEY = 'qpm.bulkFavorite.v1';
export const DEBOUNCE_MS = 180;
export const RESIZE_DEBOUNCE_MS = 140;
export const CLOSE_PROBE_MS = 150;
export const IMMEDIATE_SYNC_THROTTLE_MS = 100;

export const VIEWPORT_MARGIN = 8;
export const SIDEBAR_GAP = 8;
export const TOP_STRIP_HEIGHT = 78;
export const RIGHT_MIN_SPACE = 80;
export const MIN_INVENTORY_WIDTH = 220;
export const MIN_INVENTORY_HEIGHT = 160;
export const MIN_VISIBLE_AREA = 12000;
export const MIN_OPEN_ITEM_VIEW_COUNT = 12;
export const MAX_ANCHOR_MISSES = 3;
export const DEFAULT_CONFIG: BulkFavoriteConfig = { enabled: true };

export const CSS = `
  #${SIDEBAR_ID} {
    display: flex;
    gap: 6px;
    pointer-events: auto;
    padding: 8px;
    background: transparent;
    border-radius: 0;
    backdrop-filter: none;
  }

  #${SIDEBAR_ID}.qpm-bulk-fav--right {
    flex-direction: column;
    align-items: stretch;
  }

  #${SIDEBAR_ID}.qpm-bulk-fav--top {
    flex-direction: row;
    align-items: flex-start;
    white-space: nowrap;
  }

  #${SIDEBAR_ID}.qpm-bulk-fav--top .qpm-bulk-fav-btn {
    flex: 0 0 auto;
  }

  #${SIDEBAR_ID}::-webkit-scrollbar {
    width: 4px;
    height: 4px;
  }

  #${SIDEBAR_ID}::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
    border-radius: 2px;
  }

  #${SIDEBAR_ID}::-webkit-scrollbar-thumb {
    background: rgba(255, 255, 255, 0.3);
    border-radius: 2px;
  }

  .qpm-bulk-fav-btn {
    position: relative;
    width: 62px;
    height: 62px;
    background: rgba(0, 0, 0, 0.85);
    border-radius: 6px;
    border: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: box-shadow 0.15s ease, background 0.15s ease;
    padding: 4px;
    gap: 2px;
    overflow: visible;
    z-index: 1;
    transform-origin: center center;
  }

  .qpm-bulk-fav-btn:hover {
    transform: scale(1.05);
    background: rgba(0, 0, 0, 0.92);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.42);
    z-index: 2;
  }

  .qpm-bulk-fav-btn:active {
    transform: scale(0.98);
    background: rgba(0, 0, 0, 0.96);
  }

  .qpm-bulk-fav-sprite {
    width: 36px;
    height: 36px;
    object-fit: contain;
    image-rendering: pixelated;
  }

  .qpm-bulk-fav-status {
    position: absolute;
    top: -6px;
    right: -6px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    z-index: 3;
    pointer-events: none;
  }

  .qpm-bulk-fav-status-icon {
    width: 22px;
    height: 22px;
    object-fit: contain;
    image-rendering: pixelated;
    flex: 0 0 auto;
  }

  .qpm-bulk-fav-label {
    color: #ffffff;
    font-size: 9px;
    font-weight: 600;
    text-align: center;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.9);
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    line-height: 1.1;
  }
`;
