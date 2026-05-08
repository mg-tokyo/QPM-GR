// src/ui/panel/homeView.ts
import { renderTileGrid, type TileGridResult } from './tileGrid';

export interface HomeViewResult {
  element: HTMLElement;
  cleanup: () => void;
}

export function renderHomeView(): HomeViewResult {
  const cleanups: Array<() => void> = [];

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:4px 0;';

  const tileGrid: TileGridResult = renderTileGrid();
  cleanups.push(tileGrid.cleanup);
  container.appendChild(tileGrid.element);

  return {
    element: container,
    cleanup: () => { cleanups.forEach(fn => fn()); cleanups.length = 0; },
  };
}
