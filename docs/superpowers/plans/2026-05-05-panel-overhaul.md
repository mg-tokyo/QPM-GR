# Panel Layout Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two-layer UI (panel tiles + Hub window) with a unified panel that has a horizontal nav bar, customizable Home tile grid, and inline Hub-style card views.

**Architecture:** The panel keeps its title bar / drag / resize / collapse behavior unchanged. Below the title bar, a new horizontal icon nav bar switches between views. The "Home" view contains a user-customizable tile grid (always-draggable, swipe-to-delete, persistent "+"). Other views render Hub group cards inline using the existing `renderHubGroup()`.

**Tech Stack:** TypeScript, DOM (no framework), existing QPM storage/timer/notification utils, existing Hub card system.

**Worktree:** `C:/Users/ryand/Feeder-Extension/QPM-GR-ui-redesign/`

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/ui/panel/tileRegistry.ts` | Static registry: all available tile features (id, icon, label, action fn) |
| `src/ui/panel/tileState.ts` | Persistence: read/write tile config from storage, default set, migration |
| `src/ui/panel/tileDrag.ts` | Interaction: long-press drag-to-reorder + swipe-left-to-delete |
| `src/ui/panel/tileGrid.ts` | Render: tile grid + "+" button + add picker dropdown |
| `src/ui/panel/panelNav.ts` | Render: horizontal icon nav bar (Home + Hub groups) |
| `src/ui/panel/homeView.ts` | Render: Home view (tile grid + Changelog/Settings collapsibles) |
| `src/ui/panel/viewSwitcher.ts` | Orchestrator: switches between Home view and Hub group views |
| `src/ui/originalPanel.ts` | Modified: stripped of old tile/section/tab code; delegates to viewSwitcher |
| `src/ui/hubWindow/index.ts` | Modified: `toggleHub()` becomes a no-op or redirects to panel nav |

---

### Task 1: Tile Registry

**Files:**
- Create: `src/ui/panel/tileRegistry.ts`

- [ ] **Step 1: Create the tile registry module**

```ts
// src/ui/panel/tileRegistry.ts
import { log } from '../../utils/logger';

export interface TileDefinition {
  readonly id: string;
  readonly icon: string;
  readonly label: string;
  readonly action: () => void;
}

const registry: TileDefinition[] = [];

export function registerTile(def: TileDefinition): void {
  if (registry.some(t => t.id === def.id)) return;
  registry.push(def);
}

export function getAllTileDefinitions(): readonly TileDefinition[] {
  return registry;
}

export function getTileDefinition(id: string): TileDefinition | undefined {
  return registry.find(t => t.id === id);
}

/**
 * Register all built-in tile features.
 * Called once during panel init — each tile's action lazily imports its window.
 */
export function registerBuiltinTiles(): void {
  registerTile({
    id: 'pet-teams',
    icon: '👥',
    label: 'Pet Teams',
    action: () => {
      import('../petsWindow').then(({ togglePetsWindow }) => togglePetsWindow())
        .catch(e => log('⚠️ Failed to open Pets window', e));
    },
  });

  registerTile({
    id: 'shop-restock',
    icon: '🏪',
    label: 'Shop Restock',
    action: () => {
      import('../shopRestockWindow').then(({ openShopRestockWindow }) => openShopRestockWindow())
        .catch(e => log('⚠️ Failed to open Shop Restock', e));
    },
  });

  registerTile({
    id: 'public-rooms',
    icon: '🌐',
    label: 'Public Rooms',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('public-rooms', '🌐 Public Rooms', (root) => {
          import('../publicRoomsWindow')
            .then(({ renderPublicRoomsWindow }) => renderPublicRoomsWindow(root))
            .catch(e => log('⚠️ Failed to load Public Rooms', e));
        }, '950px', '85vh');
      });
    },
  });

  registerTile({
    id: 'journal-checker',
    icon: '📔',
    label: 'Journal Checker',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('journal-checker-window', '📔 Journal Checker', (root) => {
          root.style.padding = '0';
          import('../journalCheckerSection').then(({ createJournalCheckerSection }) => {
            root.appendChild(createJournalCheckerSection());
          }).catch(e => log('⚠️ Failed to load Journal Checker', e));
        }, '900px', '90vh');
      });
    },
  });

  registerTile({
    id: 'ability-tracker',
    icon: '📊',
    label: 'Ability Tracker',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('trackers-v2-ability', '📊 Ability Tracker', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
          import('../trackerWindow').then(({ createAbilityTrackerWindow, setGlobalAbilityTrackerState }) => {
            const state = createAbilityTrackerWindow();
            setGlobalAbilityTrackerState(state);
            root.appendChild(state.root);
          }).catch(e => log('⚠️ Failed to load Ability Tracker', e));
        }, '1200px', '90vh');
      });
    },
  });

  registerTile({
    id: 'xp-tracker',
    icon: '✨',
    label: 'XP Tracker',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('trackers-v2-xp', '✨ XP Tracker', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
          import('../xpTrackerWindow').then(({ createXpTrackerWindow, setGlobalXpTrackerState }) => {
            const state = createXpTrackerWindow();
            setGlobalXpTrackerState(state);
            root.appendChild(state.root);
          }).catch(e => log('⚠️ Failed to load XP Tracker', e));
        }, '900px', '90vh');
      });
    },
  });

  registerTile({
    id: 'turtle-timer',
    icon: '🐢',
    label: 'Turtle Timer',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('trackers-v2-turtle', '🐢 Turtle Timer', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden;';
          import('../turtleTimerWindow').then(({ createTurtleTimerWindow }) => {
            const state = createTurtleTimerWindow();
            root.appendChild(state.root);
          }).catch(e => log('⚠️ Failed to load Turtle Timer', e));
        }, '700px', '90vh');
      });
    },
  });

  registerTile({
    id: 'crop-boosts',
    icon: '🌱',
    label: 'Crop Boosts',
    action: () => {
      import('../cropBoostTrackerWindow').then(({ openCropBoostTrackerWindow }) => openCropBoostTrackerWindow())
        .catch(e => log('⚠️ Failed to open Crop Boosts', e));
    },
  });

  registerTile({
    id: 'value-display',
    icon: '💰',
    label: 'Value Display',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('trackers-v2-storageValue', '💰 Value Display', (root) => {
          root.style.cssText = 'overflow-y:auto;';
          import('../storageValueWindow').then(({ renderStorageValueSettings }) => {
            renderStorageValueSettings(root);
          }).catch(e => log('⚠️ Failed to load Value Display', e));
        }, '420px', '78vh');
      });
    },
  });

  registerTile({
    id: 'activity-log',
    icon: '📜',
    label: 'Activity Log',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('utility-feature-activity-log', '📜 Activity Log', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../sections/activityLogSection').then(({ createActivityLogSection }) => {
            root.appendChild(createActivityLogSection());
          }).catch(e => log('⚠️ Failed to load Activity Log', e));
        }, '580px', '78vh');
      });
    },
  });

  registerTile({
    id: 'locker',
    icon: '🔒',
    label: 'Protection',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('utility-feature-protection', '🔒 Protection', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../sections/protectionSection').then(({ createProtectionSection }) => {
            root.appendChild(createProtectionSection().element);
          }).catch(e => log('⚠️ Failed to load Protection', e));
        }, '580px', '78vh');
      });
    },
  });

  registerTile({
    id: 'crop-calculator',
    icon: '🧮',
    label: 'Crop Calculator',
    action: () => {
      import('../cropCalculatorWindow').then(({ openCropCalculatorWindow }) => openCropCalculatorWindow())
        .catch(e => log('⚠️ Failed to open Crop Calculator', e));
    },
  });

  registerTile({
    id: 'texture-swapper',
    icon: '🖼️',
    label: 'Texture Swapper',
    action: () => {
      import('../textureSwapperWindow').then(({ openTextureSwapperWindow }) => openTextureSwapperWindow())
        .catch(e => log('⚠️ Failed to open Texture Swapper', e));
    },
  });

  registerTile({
    id: 'controller',
    icon: '🎮',
    label: 'Controller',
    action: () => {
      import('../modalWindow').then(({ toggleWindow }) => {
        toggleWindow('utility-feature-controller', '🎮 Controller Settings', (root) => {
          root.style.cssText = 'display:flex;flex-direction:column;flex:1;min-height:0;overflow-y:auto;padding:12px;';
          import('../sections/controllerSection').then(({ createControllerSection }) => {
            root.appendChild(createControllerSection(null, null));
          }).catch(e => log('⚠️ Failed to load Controller', e));
        }, '580px', '78vh');
      });
    },
  });
}
```

- [ ] **Step 2: Verify no type errors**

Run: `cd C:/Users/ryand/Feeder-Extension/QPM-GR-ui-redesign && npx tsc --noEmit --pretty 2>&1 | grep -i "panel/tileRegistry"`
Expected: No output (no errors in this file)

- [ ] **Step 3: Commit**

```bash
git add src/ui/panel/tileRegistry.ts
git commit -m "feat(panel): add tile registry with all built-in feature tiles"
```

---

### Task 2: Tile State (Persistence)

**Files:**
- Create: `src/ui/panel/tileState.ts`

- [ ] **Step 1: Create the tile state module**

```ts
// src/ui/panel/tileState.ts
import { storage } from '../../utils/storage';

const STORAGE_KEY = 'qpm.home-tiles.v1';

export interface TileConfig {
  tiles: Array<{ id: string; order: number }>;
}

const DEFAULT_TILE_IDS = ['pet-teams', 'shop-restock', 'public-rooms', 'journal-checker'];

function defaultConfig(): TileConfig {
  return { tiles: DEFAULT_TILE_IDS.map((id, i) => ({ id, order: i })) };
}

let cached: TileConfig | null = null;

function load(): TileConfig {
  if (cached) return cached;
  const raw = storage.get<TileConfig | null>(STORAGE_KEY, null);
  if (raw && Array.isArray(raw.tiles) && raw.tiles.length > 0) {
    cached = raw;
  } else {
    cached = defaultConfig();
    save();
  }
  return cached;
}

function save(): void {
  if (!cached) return;
  storage.set(STORAGE_KEY, cached);
}

export function getTileIds(): string[] {
  const config = load();
  return config.tiles
    .slice()
    .sort((a, b) => a.order - b.order)
    .map(t => t.id);
}

export function addTile(id: string): void {
  const config = load();
  if (config.tiles.some(t => t.id === id)) return;
  const maxOrder = config.tiles.reduce((max, t) => Math.max(max, t.order), -1);
  config.tiles.push({ id, order: maxOrder + 1 });
  save();
}

export function removeTile(id: string): void {
  const config = load();
  config.tiles = config.tiles.filter(t => t.id !== id);
  save();
}

export function reorderTiles(orderedIds: string[]): void {
  const config = load();
  config.tiles = orderedIds.map((id, i) => ({ id, order: i }));
  save();
}

export function isTileAdded(id: string): boolean {
  return load().tiles.some(t => t.id === id);
}

export function resetTilesToDefault(): void {
  cached = defaultConfig();
  save();
}
```

- [ ] **Step 2: Verify no type errors**

Run: `cd C:/Users/ryand/Feeder-Extension/QPM-GR-ui-redesign && npx tsc --noEmit --pretty 2>&1 | grep -i "panel/tileState"`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add src/ui/panel/tileState.ts
git commit -m "feat(panel): add tile state persistence (storage + CRUD)"
```

---

### Task 3: Tile Drag Interaction

**Files:**
- Create: `src/ui/panel/tileDrag.ts`

- [ ] **Step 1: Create drag interaction module**

```ts
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
        // Move placeholder
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
    // Determine new index from placeholder position
    const tiles = getTiles();
    let newIndex = -1;
    if (placeholder?.parentElement) {
      const children = Array.from(placeholder.parentElement.children).filter(
        c => c !== placeholder && tiles.includes(c as HTMLElement),
      ) as HTMLElement[];
      // placeholder position indicates where the tile should go
      const allChildren = Array.from(placeholder.parentElement.children);
      const placeholderIdx = allChildren.indexOf(placeholder);
      // Count real tiles before placeholder
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
      // Delete
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

    // Start long-press timer for drag
    state.longPressTimer = window.setTimeout(() => {
      startDrag(tile, e.clientX, e.clientY);
      state.longPressTimer = null;
    }, LONG_PRESS_MS);

    // Track for swipe
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
        // Cancel long-press, start swipe if horizontal
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

  function onPointerUp(e: PointerEvent): void {
    if (state.longPressTimer !== null) {
      clearTimeout(state.longPressTimer);
      state.longPressTimer = null;
    }

    if (state.active) {
      endDrag();
      return;
    }

    if (state.swiping) {
      endSwipe(e.clientX);
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
```

- [ ] **Step 2: Verify no type errors**

Run: `cd C:/Users/ryand/Feeder-Extension/QPM-GR-ui-redesign && npx tsc --noEmit --pretty 2>&1 | grep -i "panel/tileDrag"`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add src/ui/panel/tileDrag.ts
git commit -m "feat(panel): add tile drag-to-reorder and swipe-to-delete interaction"
```

---

### Task 4: Tile Grid + Add Picker

**Files:**
- Create: `src/ui/panel/tileGrid.ts`

- [ ] **Step 1: Create tile grid renderer**

```ts
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
    ].join(';');

    const label = document.createElement('div');
    label.style.cssText = 'font-size:10px;font-weight:500;color:#e0e0e0;';
    label.textContent = `${def.icon} ${def.label}`;

    tile.appendChild(label);

    // Click to open (only if not a drag or swipe)
    let preventClick = false;
    tile.addEventListener('pointerup', () => {
      setTimeout(() => { preventClick = false; }, 50);
    });
    tile.addEventListener('click', () => {
      if (preventClick) return;
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
```

- [ ] **Step 2: Verify no type errors**

Run: `cd C:/Users/ryand/Feeder-Extension/QPM-GR-ui-redesign && npx tsc --noEmit --pretty 2>&1 | grep -i "panel/tileGrid"`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add src/ui/panel/tileGrid.ts
git commit -m "feat(panel): add tile grid renderer with add picker"
```

---

### Task 5: Panel Nav Bar

**Files:**
- Create: `src/ui/panel/panelNav.ts`

- [ ] **Step 1: Create nav bar renderer**

```ts
// src/ui/panel/panelNav.ts
import type { HubGroupDef, HubGroupId } from '../hubWindow/cards/types';
import { buildSidebarIcon } from '../hubWindow/cards/iconRenderer';

export type NavId = 'home' | HubGroupId;

export interface PanelNavResult {
  element: HTMLElement;
  setActive: (id: NavId) => void;
  cleanup: () => void;
}

interface NavButton {
  id: NavId;
  label: string;
  icon: HubGroupDef['icon'];
}

const HOME_BUTTON: NavButton = {
  id: 'home',
  label: 'Home',
  icon: { kind: 'emoji', value: '🏠' },
};

export function renderPanelNav(
  groups: ReadonlyArray<HubGroupDef>,
  activeId: NavId,
  onSelect: (id: NavId) => void,
): PanelNavResult {
  const bar = document.createElement('div');
  bar.style.cssText = [
    'display:flex',
    'gap:4px',
    'padding:5px 8px',
    'background:rgba(143,130,255,0.04)',
    'border:1px solid rgba(143,130,255,0.1)',
    'border-radius:8px',
    'align-items:center',
    'flex-shrink:0',
  ].join(';');

  const buttons = new Map<NavId, HTMLButtonElement>();

  function createBtn(nav: NavButton, pushRight: boolean): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.title = nav.label;
    btn.style.cssText = [
      'width:32px',
      'height:32px',
      'border-radius:6px',
      'border:1px solid transparent',
      'background:transparent',
      'cursor:pointer',
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'font-size:14px',
      'transition:background 0.15s,border-color 0.15s,opacity 0.15s',
      'opacity:0.45',
      'outline:none',
      'flex-shrink:0',
      pushRight ? 'margin-left:auto' : '',
    ].join(';');
    btn.appendChild(buildSidebarIcon(nav.icon));
    btn.addEventListener('click', () => onSelect(nav.id));
    buttons.set(nav.id, btn);
    return btn;
  }

  // Home button first
  bar.appendChild(createBtn(HOME_BUTTON, false));

  // Group buttons (tools last, pushed right)
  const mainGroups = groups.filter(g => g.id !== 'tools');
  const toolsGroup = groups.find(g => g.id === 'tools');

  for (const group of mainGroups) {
    bar.appendChild(createBtn({ id: group.id, label: group.label, icon: group.icon }, false));
  }
  if (toolsGroup) {
    bar.appendChild(createBtn({ id: toolsGroup.id, label: toolsGroup.label, icon: toolsGroup.icon }, true));
  }

  function setActive(id: NavId): void {
    for (const [navId, btn] of buttons) {
      const isActive = navId === id;
      btn.style.background = isActive ? 'rgba(143,130,255,0.15)' : 'transparent';
      btn.style.borderColor = isActive ? 'rgba(143,130,255,0.3)' : 'transparent';
      btn.style.opacity = isActive ? '1' : '0.45';
    }
  }

  setActive(activeId);

  return {
    element: bar,
    setActive,
    cleanup: () => { buttons.clear(); },
  };
}
```

- [ ] **Step 2: Verify no type errors**

Run: `cd C:/Users/ryand/Feeder-Extension/QPM-GR-ui-redesign && npx tsc --noEmit --pretty 2>&1 | grep -i "panel/panelNav"`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add src/ui/panel/panelNav.ts
git commit -m "feat(panel): add horizontal icon nav bar"
```

---

### Task 5b: Home View

**Files:**
- Create: `src/ui/panel/homeView.ts`

- [ ] **Step 1: Create home view renderer**

```ts
// src/ui/panel/homeView.ts
import { renderTileGrid, type TileGridResult } from './tileGrid';
import { storage } from '../../utils/storage';

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

  // Collapsible sections: Changelog + Settings
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

  const settingsRow = buildCollapsible('Settings', () => {
    const el = document.createElement('div');
    el.style.cssText = 'font-size:11px;color:rgba(224,224,224,0.5);padding:6px 0;';
    el.textContent = '⏳ Loading...';
    import('../sections/settingsSection').then(({ createSettingsSection }) => {
      el.innerHTML = '';
      el.appendChild(createSettingsSection());
    }).catch(() => { el.textContent = '❌ Failed to load'; });
    return el;
  });

  collapsibles.append(changelogRow, settingsRow);
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
```

- [ ] **Step 2: Verify no type errors**

Run: `cd C:/Users/ryand/Feeder-Extension/QPM-GR-ui-redesign && npx tsc --noEmit --pretty 2>&1 | grep -i "panel/homeView"`
Expected: No output (may need to check if `settingsSection` and `changelog` exports exist — adjust paths if needed)

- [ ] **Step 3: Commit**

```bash
git add src/ui/panel/homeView.ts
git commit -m "feat(panel): add Home view with tile grid and collapsibles"
```

---

### Task 6: View Switcher

**Files:**
- Create: `src/ui/panel/viewSwitcher.ts`

- [ ] **Step 1: Create view switcher orchestrator**

```ts
// src/ui/panel/viewSwitcher.ts
import type { HubGroupDef, HubGroupId } from '../hubWindow/cards/types';
import { renderPanelNav, type NavId, type PanelNavResult } from './panelNav';
import { renderHomeView, type HomeViewResult } from './homeView';
import { renderHubGroup, type HubGroupResult } from '../hubWindow/hubGroup';
import { getActiveGroup, setActiveGroup } from '../hubWindow/state';
import { registerBuiltinTiles } from './tileRegistry';

export interface ViewSwitcherResult {
  navElement: HTMLElement;
  viewElement: HTMLElement;
  cleanup: () => void;
}

export function createViewSwitcher(groups: ReadonlyArray<HubGroupDef>): ViewSwitcherResult {
  const cleanups: Array<() => void> = [];

  // Register tiles on first call
  registerBuiltinTiles();

  let currentHomeView: HomeViewResult | null = null;
  let currentGroupView: HubGroupResult | null = null;

  const viewContainer = document.createElement('div');
  viewContainer.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;min-height:0;padding:8px 12px;';

  // Determine initial view — default to 'home'
  const savedGroup = getActiveGroup();
  const initialNav: NavId = 'home'; // Always start on Home

  function showView(id: NavId): void {
    // Cleanup current
    if (currentHomeView) { currentHomeView.cleanup(); currentHomeView = null; }
    if (currentGroupView) { currentGroupView.cleanup(); currentGroupView = null; }
    viewContainer.innerHTML = '';

    if (id === 'home') {
      currentHomeView = renderHomeView();
      viewContainer.appendChild(currentHomeView.element);
    } else {
      const groupDef = groups.find(g => g.id === id);
      if (groupDef) {
        currentGroupView = renderHubGroup(groupDef);
        viewContainer.appendChild(currentGroupView.element);
        setActiveGroup(id);
      }
    }

    navResult.setActive(id);
  }

  const navResult: PanelNavResult = renderPanelNav(groups, initialNav, showView);
  cleanups.push(navResult.cleanup);

  // Show initial view
  showView(initialNav);

  return {
    navElement: navResult.element,
    viewElement: viewContainer,
    cleanup: () => {
      if (currentHomeView) { currentHomeView.cleanup(); currentHomeView = null; }
      if (currentGroupView) { currentGroupView.cleanup(); currentGroupView = null; }
      cleanups.forEach(fn => fn());
      cleanups.length = 0;
    },
  };
}
```

- [ ] **Step 2: Verify no type errors**

Run: `cd C:/Users/ryand/Feeder-Extension/QPM-GR-ui-redesign && npx tsc --noEmit --pretty 2>&1 | grep -i "panel/viewSwitcher"`
Expected: No output

- [ ] **Step 3: Commit**

```bash
git add src/ui/panel/viewSwitcher.ts
git commit -m "feat(panel): add view switcher orchestrating nav + home + hub groups"
```

---

### Task 7: Integrate into originalPanel.ts

**Files:**
- Modify: `src/ui/originalPanel.ts`

This is the largest change. The panel keeps: title bar, drag, resize, collapse. It removes: all tile sections, section divider, tab panels, Dashboard content. It adds: the view switcher (nav bar + view area).

- [ ] **Step 1: Rewrite the content section of `createOriginalUI`**

Replace the content area from `navSections` through `registerTabPanel` and all tile/tab logic with:

```ts
// After titleBar creation and before resize handle:
const content = document.createElement('div');
content.className = 'qpm-content';
content.style.cssText = 'display:flex;flex-direction:column;overflow:hidden;flex:1;min-height:0;';

// Lazy-load view switcher with hub groups
let viewSwitcherResult: import('./panel/viewSwitcher').ViewSwitcherResult | null = null;

(async () => {
  const { createViewSwitcher } = await import('./panel/viewSwitcher');
  const { getTrackersGroup } = await import('./hubWindow/groups/trackersGroup');
  const { getItemsGroup } = await import('./hubWindow/groups/itemsGroup');
  const { getGardenGroup } = await import('./hubWindow/groups/gardenGroup');
  const { getConfigGroup } = await import('./hubWindow/groups/configGroup');
  const { getToolsGroup } = await import('./hubWindow/groups/toolsGroup');

  const groups = [getTrackersGroup(), getItemsGroup(), getGardenGroup(), getConfigGroup(), getToolsGroup()];
  viewSwitcherResult = createViewSwitcher(groups);
  content.appendChild(viewSwitcherResult.navElement);
  content.appendChild(viewSwitcherResult.viewElement);
})();

panel.append(titleBar, content, resizeHandle);
```

Remove:
- `navSections`, `tabsContainer`, `sectionDivider` and all their child logic
- All `buildSection`, `buildTile`, `registerTabPanel` calls
- All tile status subscriptions (Pet Teams hunger, Shop Restock sprites, Journal tips, Public Rooms count)
- `activateTab`, `tabs`, `tabButtons` maps
- `tabColors` object
- Dashboard statsHeader reference
- All `import` statements only used by removed code (`createStatsHeader`, `createMutationSection`, `getRestockDataSync`, etc.)

Keep:
- Title bar (drag, collapse, version bubble)
- Panel position/resize logic
- `setCfg` and `renderRemindersContent` exports (used by gardenGroup)

- [ ] **Step 2: Remove unused imports at top of file**

Remove imports for: `createStatsHeader`, `createMutationSection`, `getRestockDataSync`, `getCropSpriteCanvas`, `getPetSpriteCanvas`, `canvasToDataUrl`, `calculateMaxStrength`, `listRooms`, `getMutationValueSnapshot`, etc. — anything only used by the deleted code.

Keep: `log`, `storage`, `ensurePanelStyles`, `yieldToBrowser`, `visibleInterval` (if still used), version checker imports.

- [ ] **Step 3: Update the Hub window to be a no-op**

In `src/ui/hubWindow/index.ts`, change `toggleHub` to navigate the panel instead:

```ts
export function toggleHub(): void {
  // Hub is now integrated into the panel nav — this is a no-op.
  // Kept for backwards compatibility with any code that calls it.
}
```

- [ ] **Step 4: Remove the hub tile registration in main.ts**

The `registerHubGroups()` call in `main.ts` can remain (it's harmless), but the `toggleHub` import usage should be verified as unused now.

- [ ] **Step 5: Verify typecheck passes**

Run: `cd C:/Users/ryand/Feeder-Extension/QPM-GR-ui-redesign && npm run typecheck`
Expected: Only pre-existing errors, no new errors from panel/* files

- [ ] **Step 6: Verify build passes**

Run: `cd C:/Users/ryand/Feeder-Extension/QPM-GR-ui-redesign && npm run build`
Expected: Build succeeds

- [ ] **Step 7: Commit**

```bash
git add src/ui/originalPanel.ts src/ui/hubWindow/index.ts src/main.ts
git commit -m "feat(panel): integrate view switcher, remove old tile sections and hub window"
```

---

### Task 8: Cleanup and Polish

**Files:**
- Modify: `src/ui/panelStyles.ts` — remove `.qpm-nav-section*` CSS rules (unused now)
- Verify: tile grid styling works with existing `.qpm-tile` class or override inline

- [ ] **Step 1: Remove dead CSS for old nav sections**

In `src/ui/panelStyles.ts`, remove these CSS blocks:
- `.qpm-nav-sections { ... }`
- `.qpm-nav-section { ... }`
- `.qpm-nav-section__header { ... }` and `::after`
- `.qpm-nav-section__row { ... }`
- `.qpm-tabs { ... }`
- `.qpm-tab { ... }` and `.qpm-tab--active { ... }`

Keep `.qpm-tile*` classes — they may still be used by the grid tiles.

- [ ] **Step 2: Verify build still works**

Run: `cd C:/Users/ryand/Feeder-Extension/QPM-GR-ui-redesign && npm run build`
Expected: Success

- [ ] **Step 3: Commit**

```bash
git add src/ui/panelStyles.ts
git commit -m "chore(panel): remove dead CSS for old nav sections and tabs"
```

---

## Notes for the Implementer

- **The `originalPanel.ts` rewrite (Task 7) is the riskiest step.** The file is large (~800+ lines). The strategy is to gut the middle (lines ~145–635 approx) and replace with the async view switcher import. Keep title bar, position/drag/resize, and collapse logic intact.
- **`renderRemindersContent`** is exported from `originalPanel.ts` and used by `gardenGroup.ts`. Do NOT remove it. If needed, move it to its own file.
- **The `registerHubGroups()` call in `main.ts`** currently feeds the Hub window. After this change, the same groups are imported directly by `viewSwitcher.ts`. The `main.ts` call can remain as dead code initially, or be removed if nothing else references `registeredGroups`.
- **Tile actions** all use lazy `import()` so the panel loads fast and features are code-split.
- **`settingsSection.ts` and `changelog.ts`** — verify these export the expected symbols. If `changelog.ts` exports `CHANGELOG` as an array of `{ version, notes }`, use it. If the export name differs, adjust `homeView.ts`.
