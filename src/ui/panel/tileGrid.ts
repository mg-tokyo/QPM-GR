// src/ui/panel/tileGrid.ts
import { addTile, getTileRows, isTileAdded, moveTile, removeTile } from './tileState';
import { getAllTileDefinitions, getTileDefinition, type TileDefinition } from './tileRegistry';
import { attachTileDrag } from './tileDrag';
import { startAllLiveStatuses } from './tileStatuses';
import { t } from '../../i18n';

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
  const liveStatusCleanups: Array<() => void> = [];
  let liveStatusVersion = 0;

  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:6px;';

  const grid = document.createElement('div');
  grid.className = 'qpm-tile-grid';
  grid.style.cssText = 'display:flex;flex-direction:column;gap:6px;touch-action:pan-y;';
  grid.dataset.qpmTileGrid = '';

  // "+" add button
  const addBtn = document.createElement('button');
  addBtn.type = 'button';
  addBtn.className = 'qpm-add-tile';
  addBtn.style.cssText = [
    'width:100%',
    'box-sizing:border-box',
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
  addBtn.title = t('tile.addTile');
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
      'padding:0',
      'max-height:320px',
      'display:flex',
      'flex-direction:column',
      'box-shadow:0 8px 32px rgba(0,0,0,0.5)',
    ].join(';');

    // ── Header ──
    const header = document.createElement('div');
    header.style.cssText = 'padding:10px 12px 6px;flex-shrink:0;';
    const title = document.createElement('div');
    title.style.cssText = 'font-size:11px;font-weight:700;color:#8f82ff;letter-spacing:0.03em;';
    title.textContent = t('tile.pickerTitle');
    header.appendChild(title);
    pickerEl.appendChild(header);

    // ── Scrollable tile list ──
    const listWrap = document.createElement('div');
    listWrap.style.cssText = 'flex:1;min-height:0;overflow-y:auto;padding:0 10px;display:flex;flex-direction:column;gap:4px;';

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
      actionSpan.textContent = added ? t('tile.added') : t('tile.add');

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

      listWrap.appendChild(row);
    }
    pickerEl.appendChild(listWrap);

    // ── Footer hints ──
    const footer = document.createElement('div');
    footer.style.cssText = [
      'padding:6px 12px',
      'flex-shrink:0',
      'border-top:1px solid rgba(143,130,255,0.12)',
      'display:flex',
      'gap:10px',
      'font-size:10px',
      'color:#8f82ff',
      'letter-spacing:0.01em',
      'text-shadow:0 0 6px rgba(143,130,255,0.4)',
    ].join(';');
    const hint1 = document.createElement('span');
    hint1.textContent = t('tile.hintDrag');
    const sep = document.createElement('span');
    sep.textContent = '·';
    sep.style.opacity = '0.5';
    const hint2 = document.createElement('span');
    hint2.textContent = t('tile.hintRemove');
    footer.append(hint1, sep, hint2);
    pickerEl.appendChild(footer);

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

  function buildTileEl(def: TileDefinition, rowIndex: number, slotIndex: number): HTMLElement {
    const tile = document.createElement('button');
    tile.type = 'button';
    tile.className = 'qpm-tile';
    tile.dataset.tileId = def.id;
    tile.dataset.rowIndex = String(rowIndex);
    tile.dataset.slotIndex = String(slotIndex);
    tile.title = t('tile.tooltip', { label: def.label });
    tile.setAttribute('aria-label', t('tile.ariaLabel', { label: def.label }));

    // Apply vibrant color
    applyTileColor(tile, def.color);
    const rgb = parseRgba(def.color);

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
    if (rgb) {
      statusEl.style.setProperty('--qpm-tile-status-rgb', `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`);
    }

    tile.append(labelEl, statusEl);

    // Hover: intensify glow
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

  function getStatusEl(tileId: string): HTMLElement | null {
    return grid.querySelector(`[data-tile-status="${tileId}"]`) as HTMLElement | null;
  }

  function addLiveCleanup(version: number, cleanup: () => void): void {
    if (version !== liveStatusVersion) {
      cleanup();
      return;
    }
    liveStatusCleanups.push(cleanup);
  }

  function stopLiveStatuses(): void {
    liveStatusVersion++;
    for (const cleanup of liveStatusCleanups.splice(0)) {
      try { cleanup(); } catch { /* ignore */ }
    }
  }

  function refresh(): void {
    grid.innerHTML = '';
    const rows = getTileRows();
    rows.forEach((rowIds, rowIndex) => {
      const rowEl = document.createElement('div');
      rowEl.className = `qpm-tile-row ${rowIds.length === 1 ? 'qpm-tile-row--single' : 'qpm-tile-row--pair'}`;
      rowEl.dataset.qpmTileRow = '';
      rowEl.dataset.rowIndex = String(rowIndex);

      rowIds.forEach((id, slotIndex) => {
        const def = getTileDefinition(id);
        if (def) {
          rowEl.appendChild(buildTileEl(def, rowIndex, slotIndex));
        }
      });

      if (rowEl.children.length > 0) {
        grid.appendChild(rowEl);
      }
    });
    grid.appendChild(addBtn);

    // Kick off live status updates after render
    stopLiveStatuses();
    const version = liveStatusVersion;
    startAllLiveStatuses(getStatusEl, addLiveCleanup, version);
  }

  function getTileElements(): HTMLElement[] {
    return Array.from(grid.querySelectorAll('[data-tile-id]')) as HTMLElement[];
  }

  refresh();

  const dragCleanup = attachTileDrag(grid, getTileElements, {
    onMove: (id, target) => {
      moveTile(id, target);
      refresh();
    },
    onDelete: (id) => {
      removeTile(id);
      refresh();
    },
  });
  cleanups.push(dragCleanup);

  container.appendChild(grid);

  return {
    element: container,
    cleanup: () => { stopLiveStatuses(); cleanups.forEach(fn => fn()); cleanups.length = 0; closePicker(); },
    refresh,
  };
}
