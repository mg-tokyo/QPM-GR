// src/ui/panel/tileDrag.ts
// Drag-to-reorder tiles. Drag off panel to delete.

import type { TileDropTarget } from './tileState';

export interface TileDragCallbacks {
  onMove: (id: string, target: TileDropTarget) => void;
  onDelete: (id: string) => void;
}

const LONG_PRESS_MS = 180;
const DRAG_THRESHOLD = 5;
const DRAG_Z_INDEX = 2147483647;

export function attachTileDrag(
  container: HTMLElement,
  getTiles: () => HTMLElement[],
  callbacks: TileDragCallbacks,
): () => void {
  let pressTimer: number | null = null;
  let startX = 0;
  let startY = 0;
  let offsetX = 0;
  let offsetY = 0;
  let dragEl: HTMLElement | null = null;
  let dragClone: HTMLElement | null = null;
  let placeholder: HTMLElement | null = null;
  let placeholderRow: HTMLElement | null = null;
  let pressTile: HTMLElement | null = null;
  let sourceRow: HTMLElement | null = null;
  let currentDropTarget: TileDropTarget | null = null;
  let dragId: string | null = null;
  let isDragging = false;
  let pointerId: number | null = null;
  const touchedRows = new Set<HTMLElement>();

  function findTile(e: PointerEvent): HTMLElement | null {
    const tiles = getTiles();
    const target = e.target as HTMLElement;
    for (const tile of tiles) {
      if (tile === target || tile.contains(target)) return tile;
    }
    return null;
  }

  function getRows(): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>('[data-qpm-tile-row]'));
  }

  function getVisibleRowTiles(row: HTMLElement): HTMLElement[] {
    return Array.from(row.querySelectorAll<HTMLElement>('[data-tile-id]')).filter(tile => {
      if (tile === dragEl) return false;
      if (tile.style.display === 'none') return false;
      const rect = tile.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
  }

  function getAnchorId(row: HTMLElement): string | null {
    return getVisibleRowTiles(row)[0]?.dataset.tileId ?? null;
  }

  function updateRowClass(row: HTMLElement | null): void {
    if (!row || !row.isConnected) return;
    touchedRows.add(row);
    const visibleTiles = getVisibleRowTiles(row).length;
    const hasInlinePlaceholder = placeholder?.parentElement === row ? 1 : 0;
    const slots = visibleTiles + hasInlinePlaceholder;

    row.classList.remove('qpm-tile-row--single', 'qpm-tile-row--pair', 'qpm-tile-row--empty');
    if (slots <= 0) {
      row.classList.add('qpm-tile-row--empty');
      row.style.display = 'none';
      return;
    }

    row.style.display = '';
    row.classList.add(slots === 1 ? 'qpm-tile-row--single' : 'qpm-tile-row--pair');
  }

  function createPlaceholder(height: number): HTMLElement {
    const el = document.createElement('div');
    el.className = 'qpm-tile-placeholder';
    el.style.cssText = [
      `height:${height}px`,
      'flex:1 1 0',
      'min-width:0',
      'max-width:100%',
    ].join(';');
    return el;
  }

  function ensurePlaceholderRow(): HTMLElement | null {
    if (!placeholder) return null;
    if (!placeholderRow) {
      placeholderRow = document.createElement('div');
      placeholderRow.className = 'qpm-tile-row qpm-tile-row--single qpm-tile-row--placeholder';
    }
    if (placeholder.parentElement !== placeholderRow) {
      const previousRow = placeholder.parentElement as HTMLElement | null;
      placeholderRow.appendChild(placeholder);
      updateRowClass(previousRow);
    }
    return placeholderRow;
  }

  function getAddButton(): Element | null {
    return container.querySelector('.qpm-add-tile');
  }

  function placeInlinePlaceholder(row: HTMLElement, targetTile: HTMLElement, side: 'before' | 'after'): void {
    if (!placeholder) return;
    const previousRow = placeholder.parentElement as HTMLElement | null;
    const targetId = targetTile.dataset.tileId;
    if (!targetId) return;

    if (side === 'before') {
      row.insertBefore(placeholder, targetTile);
    } else {
      row.insertBefore(placeholder, targetTile.nextSibling);
    }
    placeholderRow?.remove();
    currentDropTarget = { kind: 'tile', targetId, side };
    updateRowClass(previousRow);
    updateRowClass(row);
    updateRowClass(sourceRow);
  }

  function placeRowPlaceholder(anchorRow: HTMLElement | null, side: 'before' | 'after'): void {
    const row = ensurePlaceholderRow();
    if (!row) return;

    const anchorId = anchorRow ? getAnchorId(anchorRow) : null;
    if (!anchorRow) {
      container.insertBefore(row, getAddButton());
    } else if (side === 'before') {
      container.insertBefore(row, anchorRow);
    } else {
      container.insertBefore(row, anchorRow.nextSibling);
    }

    currentDropTarget = { kind: 'row', anchorId, side };
    updateRowClass(sourceRow);
  }

  function clearDropMarker(): void {
    const previousRow = placeholder?.parentElement as HTMLElement | null;
    placeholder?.remove();
    placeholderRow?.remove();
    currentDropTarget = null;
    updateRowClass(previousRow);
    updateRowClass(sourceRow);
  }

  function beginDrag(el: HTMLElement, x: number, y: number): void {
    setPendingDrag(el, false);
    isDragging = true;
    dragEl = el;
    dragId = el.dataset.tileId ?? null;
    sourceRow = el.closest<HTMLElement>('[data-qpm-tile-row]');

    const rect = el.getBoundingClientRect();
    offsetX = x - rect.left;
    offsetY = y - rect.top;

    dragClone = el.cloneNode(true) as HTMLElement;
    dragClone.classList.add('qpm-tile--dragging');
    dragClone.style.cssText = [
      'position:fixed',
      `left:${rect.left}px`,
      `top:${rect.top}px`,
      `width:${rect.width}px`,
      `height:${rect.height}px`,
      'min-width:0',
      'max-width:none',
      'flex:0 0 auto',
      `z-index:${DRAG_Z_INDEX}`,
      'pointer-events:none',
      'border-radius:12px',
    ].join(';');
    document.body.appendChild(dragClone);

    placeholder = createPlaceholder(rect.height);

    el.style.display = 'none';
    updateRowClass(sourceRow);

    showDeleteZone();
    moveDrag(x, y);

    try { container.setPointerCapture(pointerId!); } catch {}
  }

  function moveDrag(x: number, y: number): void {
    if (!dragClone || !dragEl) return;

    dragClone.style.left = `${x - offsetX}px`;
    dragClone.style.top = `${y - offsetY}px`;

    const panelRect = getPanelRect();
    const outsidePanel = panelRect && (
      x < panelRect.left - 30 ||
      x > panelRect.right + 30 ||
      y < panelRect.top - 30 ||
      y > panelRect.bottom + 30
    );

    if (outsidePanel) {
      dragClone.classList.add('qpm-tile--delete-target');
      updateDeleteZone(true);
      clearDropMarker();
      return;
    }

    dragClone.classList.remove('qpm-tile--delete-target');
    updateDeleteZone(false);

    const cloneRect = dragClone.getBoundingClientRect();
    findDropTarget(
      cloneRect.left + cloneRect.width / 2,
      cloneRect.top + cloneRect.height / 2,
    );
  }

  function findDropTarget(x: number, y: number): void {
    const rows = getRows().filter(row => getVisibleRowTiles(row).length > 0);
    if (rows.length === 0) {
      placeRowPlaceholder(null, 'after');
      return;
    }

    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;

      if (y < rect.top) {
        placeRowPlaceholder(row, 'before');
        return;
      }

      if (y <= rect.bottom) {
        const tiles = getVisibleRowTiles(row);
        if (tiles.length === 1) {
          const topZone = rect.top + Math.min(14, rect.height * 0.28);
          const bottomZone = rect.bottom - Math.min(14, rect.height * 0.28);
          if (y < topZone) {
            placeRowPlaceholder(row, 'before');
            return;
          }
          if (y > bottomZone) {
            placeRowPlaceholder(row, 'after');
            return;
          }

          const tile = tiles[0]!;
          const tileRect = tile.getBoundingClientRect();
          placeInlinePlaceholder(row, tile, x < tileRect.left + tileRect.width / 2 ? 'before' : 'after');
          return;
        }

        placeRowPlaceholder(row, y < rect.top + rect.height / 2 ? 'before' : 'after');
        return;
      }
    }

    placeRowPlaceholder(rows[rows.length - 1]!, 'after');
  }

  function endDrag(x: number, y: number): void {
    if (!isDragging || !dragEl) return;

    const panelRect = getPanelRect();
    const outsidePanel = panelRect && (
      x < panelRect.left - 30 ||
      x > panelRect.right + 30 ||
      y < panelRect.top - 30 ||
      y > panelRect.bottom + 30
    );

    const id = dragId;
    const target = currentDropTarget;
    if (outsidePanel && id) {
      callbacks.onDelete(id);
    } else if (id && target) {
      callbacks.onMove(id, target);
    } else {
      dragEl.style.display = '';
    }

    cleanup();
  }

  function cancelDrag(): void {
    if (!isDragging || !dragEl) return;
    dragEl.style.display = '';
    cleanup();
  }

  function cleanup(): void {
    dragClone?.remove();
    dragClone = null;
    placeholder?.remove();
    placeholder = null;
    placeholderRow?.remove();
    placeholderRow = null;
    hideDeleteZone();
    for (const row of touchedRows) {
      row.style.display = '';
      row.classList.remove('qpm-tile-row--empty');
      updateRowClass(row);
    }
    touchedRows.clear();
    isDragging = false;
    dragEl = null;
    pressTile = null;
    sourceRow = null;
    currentDropTarget = null;
    dragId = null;
    if (pointerId !== null) {
      try { container.releasePointerCapture(pointerId); } catch {}
    }
  }

  let deleteZoneEl: HTMLElement | null = null;

  function showDeleteZone(): void {
    if (deleteZoneEl) return;
    deleteZoneEl = document.createElement('div');
    deleteZoneEl.className = 'qpm-tile-delete-zone';
    deleteZoneEl.textContent = 'Drag outside to remove';
    const panel = container.closest('.qpm-panel') || container.parentElement;
    if (panel && getComputedStyle(panel).position === 'static') {
      (panel as HTMLElement).style.position = 'relative';
    }
    panel?.appendChild(deleteZoneEl);
  }

  function updateDeleteZone(active: boolean): void {
    if (!deleteZoneEl) return;
    if (active) {
      deleteZoneEl.classList.add('qpm-tile-delete-zone--active');
      deleteZoneEl.textContent = 'Release to remove';
    } else {
      deleteZoneEl.classList.remove('qpm-tile-delete-zone--active');
      deleteZoneEl.textContent = 'Drag outside to remove';
    }
  }

  function hideDeleteZone(): void {
    deleteZoneEl?.remove();
    deleteZoneEl = null;
  }

  function getPanelRect(): DOMRect | null {
    const panel = container.closest('.qpm-panel');
    return panel ? panel.getBoundingClientRect() : null;
  }

  function setPendingDrag(tile: HTMLElement | null, active: boolean): void {
    if (!tile) return;
    if (active) {
      tile.dataset.qpmDragPending = '1';
      tile.classList.add('qpm-tile--pressing');
    } else if (tile.dataset.qpmDragPending === '1') {
      delete tile.dataset.qpmDragPending;
      tile.classList.remove('qpm-tile--pressing');
    }
  }

  function onPointerDown(e: PointerEvent): void {
    if (isDragging) return;
    const tile = findTile(e);
    if (!tile) return;
    if (!e.isPrimary) return;

    pointerId = e.pointerId;
    pressTile = tile;
    startX = e.clientX;
    startY = e.clientY;
    setPendingDrag(tile, true);

    pressTimer = window.setTimeout(() => {
      pressTimer = null;
      pressTile = null;
      beginDrag(tile, startX, startY);
    }, LONG_PRESS_MS);
  }

  function onPointerMove(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;

    if (isDragging) {
      e.preventDefault();
      moveDrag(e.clientX, e.clientY);
      return;
    }

    if (pressTimer !== null) {
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        clearTimeout(pressTimer);
        pressTimer = null;
        if (e.pointerType === 'mouse' && pressTile && (e.buttons & 1) === 1) {
          const tile = pressTile;
          pressTile = null;
          beginDrag(tile, e.clientX, e.clientY);
        } else {
          setPendingDrag(pressTile, false);
          pressTile = null;
        }
      }
    }
  }

  function onPointerUp(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;

    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    setPendingDrag(pressTile, false);
    pressTile = null;

    if (isDragging) {
      endDrag(e.clientX, e.clientY);
    }

    pointerId = null;
  }

  function onPointerCancel(e: PointerEvent): void {
    if (e.pointerId !== pointerId) return;
    if (pressTimer !== null) {
      clearTimeout(pressTimer);
      pressTimer = null;
    }
    setPendingDrag(pressTile, false);
    pressTile = null;
    if (isDragging) {
      cancelDrag();
    }
    pointerId = null;
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerCancel);

  const windowUp = (e: PointerEvent) => {
    if (e.pointerId === pointerId && isDragging) {
      endDrag(e.clientX, e.clientY);
      pointerId = null;
    }
  };
  window.addEventListener('pointerup', windowUp);

  return () => {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerCancel);
    window.removeEventListener('pointerup', windowUp);
    if (pressTimer !== null) clearTimeout(pressTimer);
    setPendingDrag(pressTile, false);
    cleanup();
  };
}
