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

  // Tile grid
  const tileGrid: TileGridResult = renderTileGrid();
  cleanups.push(tileGrid.cleanup);
  container.appendChild(tileGrid.element);

  // Collapsible section: Changelog
  const collapsibles = document.createElement('div');
  collapsibles.style.cssText = 'border-top:1px solid rgba(143,130,255,0.08);padding-top:6px;display:flex;flex-direction:column;gap:4px;';

  const changelogRow = buildCollapsible('Changelog', () => {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.5);padding:6px 0;';
    el.textContent = '⏳ Loading...';
    import('../sections/changelog').then(({ CHANGELOG }) => {
      el.innerHTML = '';
      const list = document.createElement('div');
      list.style.cssText = 'max-height:200px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;';
      for (const entry of CHANGELOG.slice(0, 5)) {
        const item = document.createElement('div');
        item.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.6);padding:2px 0;';
        item.innerHTML = `<strong style="color:#8f82ff;">v${entry.version}</strong> — ${entry.notes[0] ?? ''}`;
        list.appendChild(item);
      }
      el.appendChild(list);
    }).catch(() => { el.textContent = '❌ Failed to load'; });
    return el;
  });

  collapsibles.appendChild(changelogRow);
  container.appendChild(collapsibles);

  return {
    element: container,
    cleanup: () => { cleanups.forEach(fn => fn()); cleanups.length = 0; },
  };
}

function buildCollapsible(label: string, buildContent: () => HTMLElement): HTMLElement {
  const row = document.createElement('div');

  const header = document.createElement('div');
  header.style.cssText = 'font-size:10px;color:rgba(200,192,255,0.4);cursor:pointer;padding:2px 4px;user-select:none;';
  header.textContent = `▸ ${label}`;

  let content: HTMLElement | null = null;
  let expanded = false;

  header.addEventListener('click', () => {
    expanded = !expanded;
    header.textContent = `${expanded ? '▾' : '▸'} ${label}`;
    if (expanded && !content) {
      content = buildContent();
      row.appendChild(content);
    } else if (content) {
      content.style.display = expanded ? '' : 'none';
    }
  });

  row.appendChild(header);
  return row;
}
