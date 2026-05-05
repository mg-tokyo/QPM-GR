// src/ui/panel/tileGrid.ts
import { getTileIds, addTile, removeTile, reorderTiles, isTileAdded } from './tileState';
import { getAllTileDefinitions, getTileDefinition } from './tileRegistry';
import { attachTileDrag } from './tileDrag';

export interface TileGridResult {
  element: HTMLElement;
  cleanup: () => void;
  refresh: () => void;
}

export function renderTileGrid(): TileGridResult {
  const cleanups: Array<() => void> = [];

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;';
  grid.dataset.qpmTileGrid = '';

  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.style.cssText = [
    'flex:1',
    'min-width:45%',
    'border:1px dashed rgba(143,130,255,0.25)',
    'border-radius:6px',
    'padding:10px',
    'text-align:center',
    'color:rgba(143,130,255,0.5)',
    'font-size:18px',
    'cursor:pointer',
    'background:transparent',
    'transition:border-color 0.15s,color 0.15s',
  ].join(';');
  addBtn.textContent = '＋';
  addBtn.title = 'Add tile';
  addBtn.addEventListener('mouseenter', () => {
    addBtn.style.borderColor = 'rgba(143,130,255,0.5)';
    addBtn.style.color = 'rgba(143,130,255,0.8)';
  });
  addBtn.addEventListener('mouseleave', () => {
    addBtn.style.borderColor = 'rgba(143,130,255,0.25)';
    addBtn.style.color = 'rgba(143,130,255,0.5)';
  });

  let pickerOpen = false;
  let pickerEl: HTMLElement | null = null;

  function closePicker(): void {
    pickerEl?.remove();
    pickerEl = null;
    pickerOpen = false;
  }

  function openPicker(): void {
    if (pickerOpen) { closePicker(); return; }
    pickerOpen = true;

    pickerEl = document.createElement('div');
    pickerEl.style.cssText = [
      'background:rgba(30,32,48,0.98)',
      'border:1px solid rgba(143,130,255,0.3)',
      'border-radius:8px',
      'padding:8px',
      'max-height:220px',
      'overflow-y:auto',
      'display:flex',
      'flex-direction:column',
      'gap:3px',
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'font-size:11px;font-weight:bold;color:#8f82ff;padding:4px 6px;';
    title.textContent = 'Add a tile';
    pickerEl.appendChild(title);

    const allDefs = getAllTileDefinitions();
    for (const def of allDefs) {
      const added = isTileAdded(def.id);
      const row = document.createElement('div');
      row.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:6px',
        'padding:5px 8px',
        'background:rgba(255,255,255,0.03)',
        'border:1px solid rgba(143,130,255,0.15)',
        'border-radius:6px',
        added ? 'opacity:0.4' : 'cursor:pointer',
      ].join(';');

      const iconSpan = document.createElement('span');
      iconSpan.textContent = def.icon;
      const labelSpan = document.createElement('span');
      labelSpan.style.cssText = 'flex:1;font-size:11px;color:#e0e0e0;';
      labelSpan.textContent = def.label;
      const actionSpan = document.createElement('span');
      actionSpan.style.cssText = `font-size:9px;color:${added ? 'rgba(143,130,255,0.4)' : '#66bb6a'};`;
      actionSpan.textContent = added ? 'added' : '+ add';

      row.append(iconSpan, labelSpan, actionSpan);

      if (!added) {
        row.addEventListener('click', () => {
          addTile(def.id);
          closePicker();
          refresh();
        });
        row.addEventListener('mouseenter', () => { row.style.background = 'rgba(143,130,255,0.08)'; });
        row.addEventListener('mouseleave', () => { row.style.background = 'rgba(255,255,255,0.03)'; });
      }

      pickerEl.appendChild(row);
    }

    container.appendChild(pickerEl);

    // Close on outside click
    const onOutsideClick = (e: MouseEvent) => {
      if (pickerEl && !pickerEl.contains(e.target as Node) && e.target !== addBtn) {
        closePicker();
        document.removeEventListener('click', onOutsideClick, true);
      }
    };
    setTimeout(() => document.addEventListener('click', onOutsideClick, true), 0);
    cleanups.push(() => document.removeEventListener('click', onOutsideClick, true));
  }

  addBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    openPicker();
  });

  function buildTileEl(id: string): HTMLElement | null {
    const def = getTileDefinition(id);
    if (!def) return null;

    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'qpm-tile';
    tile.dataset.tileId = id;
    tile.style.cssText = [
      'flex:1',
      'min-width:45%',
      'background:rgba(255,255,255,0.04)',
      'border:1px solid rgba(143,130,255,0.2)',
      'border-radius:6px',
      'padding:8px',
      'text-align:center',
      'cursor:pointer',
      'transition:transform 0.15s,opacity 0.15s',
      'touch-action:none',
      'color:#e0e0e0',
    ].join(';');

    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;font-weight:500;color:#e0e0e0;';
    label.textContent = `${def.icon} ${def.label}`;

    tile.appendChild(label);

    // Click to open (only fires if not a drag/swipe)
    tile.addEventListener('click', () => {
      def.action();
    });

    return tile;
  }

  function refresh(): void {
    grid.innerHTML = '';
    const ids = getTileIds();
    for (const id of ids) {
      const el = buildTileEl(id);
      if (el) grid.appendChild(el);
    }
    grid.appendChild(addBtn);
  }

  function getTileElements(): HTMLElement[] {
    return Array.from(grid.querySelectorAll('[data-tile-id]')) as HTMLElement[];
  }

  refresh();

  const dragCleanup = attachTileDrag(grid, getTileElements, {
    onReorder: (from, to) => {
      const ids = getTileIds();
      const [moved] = ids.splice(from, 1);
      if (moved) {
        ids.splice(to, 0, moved);
        reorderTiles(ids);
        refresh();
      }
    },
    onDelete: (index) => {
      const ids = getTileIds();
      const id = ids[index];
      if (id) {
        removeTile(id);
        refresh();
      }
    },
  });
  cleanups.push(dragCleanup);

  container.appendChild(grid);

  return {
    element: container,
    cleanup: () => { cleanups.forEach(fn => fn()); cleanups.length = 0; closePicker(); },
    refresh,
  };
}
