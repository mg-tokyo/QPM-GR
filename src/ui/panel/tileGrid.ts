// src/ui/panel/tileGrid.ts
import { getTileIds, addTile, removeTile, reorderTiles, isTileAdded } from './tileState';
import { getAllTileDefinitions, getTileDefinition, type TileDefinition } from './tileRegistry';
import { attachTileDrag } from './tileDrag';

export interface TileGridResult {
  element: HTMLElement;
  cleanup: () => void;
  refresh: () => void;
}

/**
 * Extract RGB components from an rgba() color string.
 * Returns [r, g, b] or null if parsing fails.
 */
function parseRgba(color: string): [number, number, number] | null {
  const m = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/**
 * Apply the vibrant color styling to a tile button.
 * Matches the old panel tile look: tinted background, colored border, glow.
 */
function applyTileColor(tile: HTMLElement, color: string): void {
  const rgb = parseRgba(color);
  if (!rgb) return;
  const [r, g, b] = rgb;
  const bg = `rgba(${r}, ${g}, ${b}, 0.12)`;
  const border = `rgba(${r}, ${g}, ${b}, 0.35)`;
  const glow = `rgba(${r}, ${g}, ${b}, 0.18)`;
  tile.style.background = bg;
  tile.style.borderColor = border;
  tile.style.boxShadow = `0 2px 10px ${glow}`;
  tile.dataset.tileColor = color;
}

export function renderTileGrid(): TileGridResult {
  const cleanups: Array<() => void> = [];

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
  grid.dataset.qpmTileGrid = '';

  // "+" add button
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.style.cssText = [
    'flex:1',
    'min-width:45%',
    'border:1px dashed rgba(143,130,255,0.3)',
    'border-radius:10px',
    'padding:12px 11px',
    'text-align:center',
    'color:rgba(143,130,255,0.5)',
    'font-size:20px',
    'cursor:pointer',
    'background:rgba(143,130,255,0.04)',
    'transition:border-color 0.2s,color 0.2s,background 0.2s,transform 0.2s',
  ].join(';');
  addBtn.textContent = '＋';
  addBtn.title = 'Add tile';
  addBtn.addEventListener('mouseenter', () => {
    addBtn.style.borderColor = 'rgba(143,130,255,0.6)';
    addBtn.style.color = 'rgba(143,130,255,0.9)';
    addBtn.style.background = 'rgba(143,130,255,0.08)';
    addBtn.style.transform = 'translateY(-1px)';
  });
  addBtn.addEventListener('mouseleave', () => {
    addBtn.style.borderColor = 'rgba(143,130,255,0.3)';
    addBtn.style.color = 'rgba(143,130,255,0.5)';
    addBtn.style.background = 'rgba(143,130,255,0.04)';
    addBtn.style.transform = '';
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
      'background:rgba(26,28,40,0.98)',
      'border:1px solid rgba(143,130,255,0.35)',
      'border-radius:10px',
      'padding:10px',
      'max-height:240px',
      'overflow-y:auto',
      'display:flex',
      'flex-direction:column',
      'gap:4px',
      'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
    ].join(';');

    const title = document.createElement('div');
    title.style.cssText = 'font-size:11px;font-weight:700;color:#8f82ff;padding:4px 6px;letter-spacing:0.03em;';
    title.textContent = 'Add a tile';
    pickerEl.appendChild(title);

    const allDefs = getAllTileDefinitions();
    for (const def of allDefs) {
      const added = isTileAdded(def.id);
      const rgb = parseRgba(def.color);
      const rowBorder = rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.2)` : 'rgba(143,130,255,0.15)';
      const rowBg = rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.06)` : 'rgba(255,255,255,0.03)';

      const row = document.createElement('div');
      row.style.cssText = [
        'display:flex',
        'align-items:center',
        'gap:8px',
        'padding:6px 10px',
        `background:${rowBg}`,
        `border:1px solid ${rowBorder}`,
        'border-radius:8px',
        added ? 'opacity:0.4' : 'cursor:pointer',
        'transition:background 0.15s,transform 0.15s',
      ].join(';');

      const iconSpan = document.createElement('span');
      iconSpan.style.cssText = 'font-size:14px;';
      iconSpan.textContent = def.icon;
      const labelSpan = document.createElement('span');
      labelSpan.style.cssText = 'flex:1;font-size:11px;font-weight:500;color:#e0e0e0;';
      labelSpan.textContent = def.label;
      const actionSpan = document.createElement('span');
      actionSpan.style.cssText = `font-size:10px;font-weight:600;color:${added ? 'rgba(143,130,255,0.4)' : '#66bb6a'};`;
      actionSpan.textContent = added ? 'added' : '+ add';

      row.append(iconSpan, labelSpan, actionSpan);

      if (!added) {
        row.addEventListener('click', () => {
          addTile(def.id);
          closePicker();
          refresh();
        });
        row.addEventListener('mouseenter', () => {
          row.style.background = rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.12)` : 'rgba(143,130,255,0.08)';
          row.style.transform = 'translateX(2px)';
        });
        row.addEventListener('mouseleave', () => {
          row.style.background = rowBg;
          row.style.transform = '';
        });
      }

      pickerEl.appendChild(row);
    }

    container.appendChild(pickerEl);

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

  function buildTileEl(def: TileDefinition): HTMLElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'qpm-tile';
    tile.dataset.tileId = def.id;

    // Apply vibrant color
    applyTileColor(tile, def.color);

    // Override touch-action for drag support
    tile.style.touchAction = 'none';

    // Label row: icon + text
    const labelEl = document.createElement('div');
    labelEl.className = 'qpm-tile__label';
    const iconSpan = document.createElement('span');
    iconSpan.textContent = def.icon;
    iconSpan.setAttribute('aria-hidden', 'true');
    const textSpan = document.createElement('span');
    textSpan.textContent = def.label;
    labelEl.append(iconSpan, textSpan);

    // Status row (live data placeholder)
    const statusEl = document.createElement('div');
    statusEl.className = 'qpm-tile__status';
    statusEl.dataset.tileStatus = def.id;

    tile.append(labelEl, statusEl);

    // Hover: intensify glow
    const rgb = parseRgba(def.color);
    tile.addEventListener('mouseenter', () => {
      if (rgb) {
        const [r, g, b] = rgb;
        tile.style.boxShadow = `0 4px 16px rgba(${r}, ${g}, ${b}, 0.35), inset 0 1px 0 rgba(255,255,255,0.08)`;
        tile.style.borderColor = `rgba(${r}, ${g}, ${b}, 0.55)`;
        tile.style.background = `rgba(${r}, ${g}, ${b}, 0.18)`;
      }
    });
    tile.addEventListener('mouseleave', () => {
      applyTileColor(tile, def.color);
    });

    // Click action
    tile.addEventListener('click', () => {
      def.action();
    });

    return tile;
  }

  function refresh(): void {
    grid.innerHTML = '';
    const ids = getTileIds();
    for (const id of ids) {
      const def = getTileDefinition(id);
      if (def) grid.appendChild(buildTileEl(def));
    }
    grid.appendChild(addBtn);

    // Kick off live status updates after render
    startLiveStatuses();
  }

  function getTileElements(): HTMLElement[] {
    return Array.from(grid.querySelectorAll('[data-tile-id]')) as HTMLElement[];
  }

  // ── Live status updates ──
  function startLiveStatuses(): void {
    // Pet Teams — hunger & strength info
    const petStatus = grid.querySelector('[data-tile-status="pet-teams"]') as HTMLElement | null;
    if (petStatus) {
      import('../../store/pets').then(({ onActivePetInfos }) => {
        const unsub = onActivePetInfos((pets) => {
          if (!petStatus.isConnected) return;
          if (!pets.length) { petStatus.textContent = 'No active pets'; return; }
          const hungry = pets.filter(p => p.hungerPct !== null && p.hungerPct < 30);
          if (hungry.length > 0) {
            const lowest = Math.min(...hungry.map(p => p.hungerPct as number));
            petStatus.textContent = `${hungry.length} hungry (${Math.round(lowest)}%)`;
            petStatus.className = 'qpm-tile__status qpm-tile__status--alert';
          } else {
            petStatus.textContent = `All fed ✓`;
            petStatus.className = 'qpm-tile__status qpm-tile__status--positive';
          }
        });
        cleanups.push(unsub);
      }).catch(() => {});
    }

    // Public Rooms — room count
    const roomsStatus = grid.querySelector('[data-tile-status="public-rooms"]') as HTMLElement | null;
    if (roomsStatus) {
      import('../../services/ariesRooms').then(({ listRooms }) => {
        listRooms(300).then(response => {
          if (!roomsStatus.isConnected) return;
          const rooms = response.data;
          if (!Array.isArray(rooms) || rooms.length === 0) return;
          roomsStatus.textContent = `${rooms.length} active rooms`;
        }).catch(() => {});
      }).catch(() => {});
    }

    // Shop Restock — tracked item count
    const shopStatus = grid.querySelector('[data-tile-status="shop-restock"]') as HTMLElement | null;
    if (shopStatus) {
      import('../../utils/storage').then(({ storage: s }) => {
        const tracked = s.get<string[] | null>('qpm.restock.tracked', null);
        if (tracked?.length) {
          shopStatus.textContent = `${tracked.length} tracked items`;
        }
      }).catch(() => {});
    }

    // Journal — static tip
    const journalStatus = grid.querySelector('[data-tile-status="journal-checker"]') as HTMLElement | null;
    if (journalStatus) {
      journalStatus.textContent = 'Produce · Pets · Smart Tips';
    }
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
