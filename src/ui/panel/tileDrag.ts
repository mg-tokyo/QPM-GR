// src/ui/panel/tileDrag.ts
// Long-press to drag-reorder + swipe-left to delete

export interface TileDragCallbacks {
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDelete: (index: number) => void;
}

interface DragState {
  active: boolean;
  startX: number;
  startY: number;
  currentEl: HTMLElement | null;
  index: number;
  longPressTimer: number | null;
  swipeStartX: number;
  swiping: boolean;
}

const LONG_PRESS_MS = 400;
const SWIPE_THRESHOLD = 60;
const DRAG_THRESHOLD = 8;

export function attachTileDrag(
  container: HTMLElement,
  getTiles: () => HTMLElement[],
  callbacks: TileDragCallbacks,
): () => void {
  const state: DragState = {
    active: false,
    startX: 0,
    startY: 0,
    currentEl: null,
    index: -1,
    longPressTimer: null,
    swipeStartX: 0,
    swiping: false,
  };

  let placeholder: HTMLElement | null = null;
  let dragClone: HTMLElement | null = null;

  function findTileIndex(el: HTMLElement): number {
    const tiles = getTiles();
    return tiles.indexOf(el);
  }

  function findTileFromEvent(e: PointerEvent): HTMLElement | null {
    const tiles = getTiles();
    const target = e.target as HTMLElement;
    for (const tile of tiles) {
      if (tile === target || tile.contains(target)) return tile;
    }
    return null;
  }

  function startDrag(el: HTMLElement, x: number, y: number): void {
    state.active = true;
    state.currentEl = el;
    state.index = findTileIndex(el);

    const rect = el.getBoundingClientRect();
    dragClone = el.cloneNode(true) as HTMLElement;
    dragClone.style.cssText = `
      position:fixed;
      left:${rect.left}px;
      top:${rect.top}px;
      width:${rect.width}px;
      height:${rect.height}px;
      z-index:999999;
      opacity:0.85;
      pointer-events:none;
      transform:scale(1.05);
      transition:transform 0.1s;
      box-shadow:0 8px 24px rgba(0,0,0,0.4);
    `;
    document.body.appendChild(dragClone);

    placeholder = document.createElement('div');
    placeholder.style.cssText = `
      width:${rect.width}px;
      height:${rect.height}px;
      border:2px dashed rgba(143,130,255,0.4);
      border-radius:6px;
      flex:1;
      min-width:45%;
    `;
    el.style.opacity = '0';
    el.parentElement!.insertBefore(placeholder, el.nextSibling);

    state.startX = x;
    state.startY = y;
  }

  function moveDrag(x: number, y: number): void {
    if (!dragClone || !state.currentEl) return;
    const dx = x - state.startX;
    const dy = y - state.startY;
    const rect = state.currentEl.getBoundingClientRect();
    dragClone.style.left = `${rect.left + dx}px`;
    dragClone.style.top = `${rect.top + dy}px`;

    // Find drop target
    const tiles = getTiles();
    for (let i = 0; i < tiles.length; i++) {
      if (tiles[i] === state.currentEl) continue;
      const tRect = tiles[i]!.getBoundingClientRect();
      const cx = tRect.left + tRect.width / 2;
      const cy = tRect.top + tRect.height / 2;
      if (Math.abs(x - cx) < tRect.width / 2 && Math.abs(y - cy) < tRect.height / 2) {
        if (i < state.index) {
          tiles[i]!.parentElement!.insertBefore(placeholder!, tiles[i]!);
        } else {
          tiles[i]!.parentElement!.insertBefore(placeholder!, tiles[i]!.nextSibling);
        }
        break;
      }
    }
  }

  function endDrag(): void {
    if (!state.active || !state.currentEl) return;
    const tiles = getTiles();
    let newIndex = -1;
    if (placeholder?.parentElement) {
      const allChildren = Array.from(placeholder.parentElement.children);
      const placeholderIdx = allChildren.indexOf(placeholder);
      newIndex = allChildren.slice(0, placeholderIdx).filter(c => tiles.includes(c as HTMLElement)).length;
    }

    state.currentEl.style.opacity = '';
    dragClone?.remove();
    dragClone = null;
    placeholder?.remove();
    placeholder = null;

    if (newIndex >= 0 && newIndex !== state.index) {
      callbacks.onReorder(state.index, newIndex);
    }

    state.active = false;
    state.currentEl = null;
    state.index = -1;
  }

  function startSwipe(el: HTMLElement, x: number): void {
    state.swiping = true;
    state.swipeStartX = x;
    state.currentEl = el;
    state.index = findTileIndex(el);
  }

  function moveSwipe(x: number): void {
    if (!state.swiping || !state.currentEl) return;
    const dx = x - state.swipeStartX;
    if (dx < 0) {
      const clamped = Math.max(dx, -SWIPE_THRESHOLD * 2);
      state.currentEl.style.transform = `translateX(${clamped}px)`;
      state.currentEl.style.opacity = `${1 + clamped / (SWIPE_THRESHOLD * 3)}`;
    }
  }

  function endSwipe(x: number): void {
    if (!state.swiping || !state.currentEl) return;
    const dx = x - state.swipeStartX;
    if (dx < -SWIPE_THRESHOLD) {
      const idx = state.index;
      state.currentEl.style.transform = 'translateX(-200px)';
      state.currentEl.style.opacity = '0';
      state.currentEl.style.transition = 'transform 0.2s, opacity 0.2s';
      setTimeout(() => callbacks.onDelete(idx), 200);
    } else {
      state.currentEl.style.transform = '';
      state.currentEl.style.opacity = '';
    }
    state.swiping = false;
    state.currentEl = null;
  }

  function onPointerDown(e: PointerEvent): void {
    const tile = findTileFromEvent(e);
    if (!tile) return;

    state.longPressTimer = window.setTimeout(() => {
      startDrag(tile, e.clientX, e.clientY);
      state.longPressTimer = null;
    }, LONG_PRESS_MS);

    state.startX = e.clientX;
    state.startY = e.clientY;
    state.currentEl = tile;
    state.index = findTileIndex(tile);
  }

  function onPointerMove(e: PointerEvent): void {
    if (state.active) {
      moveDrag(e.clientX, e.clientY);
      return;
    }

    if (state.longPressTimer !== null) {
      const dx = Math.abs(e.clientX - state.startX);
      const dy = Math.abs(e.clientY - state.startY);
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) {
        clearTimeout(state.longPressTimer);
        state.longPressTimer = null;
        if (dx > dy && state.currentEl) {
          startSwipe(state.currentEl, state.startX);
        }
      }
    }

    if (state.swiping) {
      moveSwipe(e.clientX);
    }
  }

  function onPointerUp(_e: PointerEvent): void {
    if (state.longPressTimer !== null) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }

    if (state.active) {
      endDrag();
      return;
    }

    if (state.swiping) {
      endSwipe(_e.clientX);
      return;
    }
  }

  container.addEventListener('pointerdown', onPointerDown);
  container.addEventListener('pointermove', onPointerMove);
  container.addEventListener('pointerup', onPointerUp);
  container.addEventListener('pointercancel', onPointerUp);

  return () => {
    container.removeEventListener('pointerdown', onPointerDown);
    container.removeEventListener('pointermove', onPointerMove);
    container.removeEventListener('pointerup', onPointerUp);
    container.removeEventListener('pointercancel', onPointerUp);
    if (state.longPressTimer !== null) clearTimeout(state.longPressTimer);
    dragClone?.remove();
    placeholder?.remove();
  };
}
