/**
 * Game context reads/writes via Jotai atoms.
 * Provides: modal detection, pet slot cycling, atom discovery via fiber scan.
 *
 * Discovery strategy
 * ------------------
 * Production builds strip debugLabels, so label-based lookup always fails.
 *
 * quinoaEngineAtom: matched by QuinoaEngine shape (worldTextureCache + itemSpriteCache).
 *   Used in 5+ React components → minOccurrences=3 safe, no false positives.
 *   Pet slot cycling traverses engine → systems Map → 'petSlots' → PetSlotsView.
 *
 * activeModalAtom:  matched when a modal is open (distinctive string value).
 *   No false positives because null-init atoms are excluded and the value set
 *   is small and game-specific.
 *
 * NO store.get calls are made during discovery — fiber-captured values are used
 * instead. Calling store.get on an unmounted derived atom has side effects
 * (Jotai mounts it and watches its deps), which can interfere with the game.
 *
 * Pet slot cycling uses PetSlotsView.handleItemSelect() which internally calls
 * set(selectedPetSlotIdAtom, ...) via module-level closure — no direct atom
 * access needed. TypeScript `private` does not affect runtime property access.
 */

import {
  ensureJotaiStore,
  getAtomByLabel,
  getCachedStore,
  type JotaiStore,
} from '../../../core/jotaiBridge';
import { pageWindow } from '../../../core/pageContext';
import { readAtomValueSync } from '../../../core/atomRegistry';
import { getGardenSnapshot } from '../../garden/bridge';
import { isRecord } from '../../../utils/typeGuards';

// ---------------------------------------------------------------------------
// Atom label constants (work on dev / QPM-enriched builds)
// ---------------------------------------------------------------------------

const LABEL_ACTIVE_MODAL = 'activeModalAtom';

// ---------------------------------------------------------------------------
// Cached atom objects — set once, never cleared
// ---------------------------------------------------------------------------

let activeModalAtom:  unknown = null;
let quinoaEngineAtom: unknown = null;

// ---------------------------------------------------------------------------
// Value-shape predicates
// ---------------------------------------------------------------------------

const VALID_MODAL_VALUES = new Set([
  'seedShop', 'eggShop', 'toolShop', 'inventory', 'leaderboard',
  'journal', 'decorShop', 'stats', 'petHutch', 'decorShed',
  'activityLog', 'destroyCelestialConfirmation', 'seedSilo',
  'newspaper', 'billboard', 'feedingTrough',
]);

/**
 * QuinoaEngine has public worldTextureCache and itemSpriteCache properties.
 * These two together are distinctive enough to avoid false positives.
 */
function looksLikeQuinoaEngine(v: unknown): boolean {
  return (
    !!v &&
    typeof v === 'object' &&
    'worldTextureCache' in (v as object) &&
    'itemSpriteCache' in (v as object)
  );
}

// ---------------------------------------------------------------------------
// Sync modal state (cached via atom subscription)
// ---------------------------------------------------------------------------

let cachedModalOpen = false;
let modalAtomSubscribed = false;

/**
 * Synchronous modal check used by GamepadPoller every frame.
 * Falls back to a quick DOM scan if activeModalAtom was never found.
 */
export function isModalOpenSync(): boolean {
  if (cachedModalOpen) return true;
  // DOM fallback: Chakra/McFlex modals have no role="dialog" but use a
  // semi-transparent dark backdrop with rgba(24, 24, 24, …).
  return (
    document.querySelector('[role="dialog"]') !== null ||
    document.querySelector('[style*="rgba(24, 24, 24"]') !== null
  );
}

function subscribeToModalAtom(store: JotaiStore): void {
  if (modalAtomSubscribed || !activeModalAtom) return;
  modalAtomSubscribed = true;
  cachedModalOpen = store.get(activeModalAtom) !== null;
  store.sub(activeModalAtom, () => {
    cachedModalOpen = store.get(activeModalAtom!) !== null;
  });
}

// ---------------------------------------------------------------------------
// Grow slot context detection
// ---------------------------------------------------------------------------

/**
 * Returns true when the player is standing on a multi-harvest plant tile.
 *
 * Previously detected via the ActionBrowseButton DOM element, but the game
 * moved the browse controls into the PIXI canvas (BrowseButtonSprite) so no
 * matching DOM element exists anymore. Read directly from the garden snapshot
 * — same pattern as instaHarvest.ts:61.
 */
export function isGrowSlotContextActive(): boolean {
  const dirtTileIndex = readAtomValueSync('dirtTileIndex');
  if (dirtTileIndex === null) return false;
  const garden = getGardenSnapshot();
  if (!garden) return false;
  const key = String(dirtTileIndex);
  const tile =
    (garden.tileObjects as Record<string, unknown> | undefined)?.[key]
    ?? (garden.boardwalkTileObjects as Record<string, unknown> | undefined)?.[key];
  if (!isRecord(tile) || !Array.isArray(tile.slots)) return false;
  return tile.slots.length > 1;
}

// ---------------------------------------------------------------------------
// Async modal check (one-off, used by callers who can await)
// ---------------------------------------------------------------------------

export async function isModalOpen(): Promise<boolean> {
  if (activeModalAtom) {
    try {
      const store = await ensureJotaiStore();
      return store.get(activeModalAtom) !== null;
    } catch {
      // fall through to DOM
    }
  }
  return (
    document.querySelector('[role="dialog"]') !== null ||
    document.querySelector('[style*="rgba(24, 24, 24"]') !== null
  );
}

// ---------------------------------------------------------------------------
// Label-based fast path (dev builds / QPM-enriched environments)
// ---------------------------------------------------------------------------

function tryLabelDiscovery(): void {
  if (!activeModalAtom) activeModalAtom = getAtomByLabel(LABEL_ACTIVE_MODAL);
}

// ---------------------------------------------------------------------------
// Fiber value-shape scan helpers
// NOTE: These must NOT call store.get — use only fiber-captured values.
// ---------------------------------------------------------------------------

interface FiberAtomMatch {
  atom: unknown;
  value: unknown;
}

function isStore(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v['get'] === 'function' &&
    typeof v['set'] === 'function' &&
    typeof v['sub'] === 'function'
  );
}

function accumulateHookMatches(
  memoizedState: unknown,
  predicate: (value: unknown, atom: unknown) => boolean,
  counts: Map<unknown, { count: number; value: unknown }>,
): void {
  let hook = memoizedState as Record<string, unknown> | null | undefined;
  while (hook) {
    const state = hook['memoizedState'];
    // jotai v2: useReducer memoizedState = [currentValue, store, atom]
    if (Array.isArray(state) && state.length === 3 && isStore(state[1])) {
      const [value, , atom] = state;
      if (predicate(value, atom)) {
        const existing = counts.get(atom);
        counts.set(atom, { count: (existing?.count ?? 0) + 1, value });
      }
    }
    hook = hook['next'] as Record<string, unknown> | null | undefined;
  }
}

function findAtomInFibersByValueShape(
  predicate: (value: unknown, atom: unknown) => boolean,
  minOccurrences = 1,
): FiberAtomMatch | null {
  const counts = new Map<unknown, { count: number; value: unknown }>();

  const hook = (pageWindow as unknown as Record<string, unknown>)['__REACT_DEVTOOLS_GLOBAL_HOOK__'];
  if (typeof hook !== 'object' || hook === null) return null;
  const h = hook as Record<string, unknown>;
  if (!(h['renderers'] instanceof Map)) return null;

  for (const [rid] of h['renderers'] as Map<unknown, unknown>) {
    const getFiberRoots = h['getFiberRoots'] as
      ((id: unknown) => Set<{ current: unknown }>) | undefined;
    if (typeof getFiberRoots !== 'function') continue;
    const roots = getFiberRoots(rid);
    if (!roots) continue;

    for (const root of roots) {
      const stack: unknown[] = [(root as { current?: unknown }).current ?? root];
      const visited = new Set<unknown>();

      while (stack.length > 0) {
        const fiber = stack.pop();
        if (!fiber || visited.has(fiber)) continue;
        visited.add(fiber);

        const f = fiber as Record<string, unknown>;
        accumulateHookMatches(f['memoizedState'], predicate, counts);

        if (f['child']) stack.push(f['child']);
        if (f['sibling']) stack.push(f['sibling']);
      }
    }
  }

  if (minOccurrences <= 1) {
    for (const [atom, { value }] of counts) return { atom, value };
    return null;
  }

  let best: FiberAtomMatch | null = null;
  let bestCount = 0;
  for (const [atom, { count, value }] of counts) {
    if (count >= minOccurrences && count > bestCount) {
      best = { atom, value };
      bestCount = count;
    }
  }
  return best;
}

function tryScanEngineAtom(): void {
  if (quinoaEngineAtom) return;
  const result = findAtomInFibersByValueShape(
    (v) => looksLikeQuinoaEngine(v),
    3, // 5+ React consumers — minOccurrences=3 is a safe threshold
  );
  if (result) quinoaEngineAtom = result.atom;
}

function tryScanModalAtom(): void {
  if (activeModalAtom) return;
  // Only match when a modal is actually open (distinctive string value).
  // Derived atoms (no .init) whose value is null are too common to match safely.
  const result = findAtomInFibersByValueShape(
    (v, atom) => {
      const a = atom as Record<string, unknown>;
      return !('init' in a) && typeof v === 'string' && VALID_MODAL_VALUES.has(v);
    },
  );
  if (result) activeModalAtom = result.atom;
}

// ---------------------------------------------------------------------------
// Boot — call once from controllerFeature.ts (fire-and-forget)
// ---------------------------------------------------------------------------

const DISCOVERY_TIMEOUT_MS = 60_000;
const DISCOVERY_POLL_MS    = 1_000;

/**
 * Discovers the QuinoaEngine atom (for pet slot cycling) and modal atom.
 * Label lookup first (fast path), then fiber value-shape scan (production).
 *
 * Pet slot cycling is available as soon as quinoaEngineAtom is found and the
 * engine is non-null — no manual user interaction is required.
 */
export async function initPetSlotAtoms(): Promise<void> {
  const store = await ensureJotaiStore();
  console.log('[QPM Controller] Jotai store connected.');

  // Fast path: labels present (dev / QPM-enriched builds)
  tryLabelDiscovery();
  if (activeModalAtom) subscribeToModalAtom(store);

  // Also try engine scan immediately
  tryScanEngineAtom();

  if (quinoaEngineAtom) {
    console.log('[QPM Controller] Pet slot atoms ready (immediate scan).');
    return;
  }

  return new Promise<void>((resolve) => {
    const deadline = Date.now() + DISCOVERY_TIMEOUT_MS;

    const attempt = (): void => {
      tryScanEngineAtom();
      tryScanModalAtom();

      if (activeModalAtom) subscribeToModalAtom(store);

      if (quinoaEngineAtom) {
        console.log('[QPM Controller] quinoaEngineAtom found.');
        resolve();
        return;
      }

      if (Date.now() >= deadline) {
        console.warn('[QPM Controller] Pet slot atom discovery timed out — RT/LT cycling disabled.');
        resolve();
        return;
      }

      setTimeout(attempt, DISCOVERY_POLL_MS);
    };

    attempt();
  });
}

// ---------------------------------------------------------------------------
// Pet slot cycling — via PetSlotsView.handleItemSelect()
// ---------------------------------------------------------------------------

/**
 * Searches up to `depth` levels of object properties for a PetSlotsView,
 * identified by having both `selectedPetSlotId` and `localPetSlots` fields.
 * Skips Maps, Arrays, and primitives to avoid traversing large structures.
 */
function findViewInObject(
  obj: Record<string, unknown>,
  depth: number,
): Record<string, unknown> | null {
  if ('selectedPetSlotId' in obj && 'localPetSlots' in obj) return obj;
  if (depth <= 0) return null;
  for (const key of Object.keys(obj)) {
    const val = obj[key];
    if (!val || typeof val !== 'object' || Array.isArray(val) || val instanceof Map) continue;
    const found = findViewInObject(val as Record<string, unknown>, depth - 1);
    if (found) return found;
  }
  return null;
}

/**
 * Traverses the QuinoaEngine to find the PetSlotsView instance.
 *
 * Path: engine → systems (Map<string, SystemEntry>) → 'petSlots' entry
 *       → PetSlotsSystem (nested) → PetSlotsView
 *
 * PetSlotsView is identified by having both selectedPetSlotId and localPetSlots.
 * TypeScript `private` is compile-time only — properties are accessible at runtime.
 */
function findPetSlotsView(engine: Record<string, unknown>): Record<string, unknown> | null {
  for (const engineKey of Object.keys(engine)) {
    const val = engine[engineKey];
    if (!(val instanceof Map)) continue;

    const petSlotsEntry = (val as Map<unknown, unknown>).get('petSlots');
    if (!petSlotsEntry || typeof petSlotsEntry !== 'object') continue;

    // Search up to 2 levels: SystemEntry → PetSlotsSystem → PetSlotsView
    const view = findViewInObject(petSlotsEntry as Record<string, unknown>, 2);
    if (view) return view;
  }
  return null;
}

/**
 * Cycles to the next or previous pet slot.
 * Cycle order: null → slot[0] → slot[1] → … → null (wraps).
 *
 * Uses PetSlotsView.handleItemSelect() to update both the Jotai atom and
 * Pixi visuals atomically. Works without any prerequisite user interaction.
 *
 * handleItemSelect toggle behavior:
 *   - Called with current ID → deselects (sets null)
 *   - Called with a different ID → selects that slot
 * So to deselect (targetId === null), we call it with the current selectedId.
 */
export async function cyclePetSlot(direction: 'next' | 'prev'): Promise<void> {
  // Re-attempt scan in case engine became available after boot
  tryScanEngineAtom();

  if (!quinoaEngineAtom) {
    console.warn('[QPM Controller] RT/LT: game engine atom not yet discovered.');
    return;
  }

  try {
    const store = await ensureJotaiStore();
    // quinoaEngineAtom is a primitive atom — store.get is safe (no side effects)
    const engine = store.get(quinoaEngineAtom);
    if (!engine || typeof engine !== 'object') {
      console.warn('[QPM Controller] RT/LT: QuinoaEngine not yet initialized.');
      return;
    }

    const view = findPetSlotsView(engine as Record<string, unknown>);
    if (!view) {
      console.warn('[QPM Controller] RT/LT: PetSlotsView not accessible — property names may be mangled.');
      return;
    }

    const localSlots = view['localPetSlots'];
    if (!Array.isArray(localSlots) || localSlots.length === 0) return;

    const slotIds = (localSlots as Array<Record<string, unknown>>)
      .filter((s) => typeof s?.['id'] === 'string')
      .map((s) => s['id'] as string);
    if (slotIds.length === 0) return;

    const selectedId = view['selectedPetSlotId'] as string | null | undefined;
    const cycle: Array<string | null> = [null, ...slotIds];

    const currentIdx = (selectedId == null) ? 0 : cycle.indexOf(selectedId);
    const safeIdx    = currentIdx === -1 ? 0 : currentIdx;

    const nextIdx = direction === 'next'
      ? (safeIdx + 1) % cycle.length
      : (safeIdx - 1 + cycle.length) % cycle.length;

    const targetId = cycle[nextIdx];

    if (typeof view['handleItemSelect'] !== 'function') {
      console.warn('[QPM Controller] RT/LT: handleItemSelect not accessible — property may be mangled.');
      return;
    }

    const handleItemSelect = view['handleItemSelect'] as (id: string) => void;

    if (targetId === null) {
      // Deselect: call with current ID so handleItemSelect toggles it off
      if (selectedId != null) {
        handleItemSelect.call(view, selectedId);
      }
    } else if (targetId !== undefined) {
      handleItemSelect.call(view, targetId);
    }
  } catch (err) {
    console.error('[QPM Controller] cyclePetSlot failed:', err);
  }
}

// ---------------------------------------------------------------------------
// Pixi interactive point collection (for D-pad snap)
// ---------------------------------------------------------------------------

/**
 * Returns viewport-coordinate centers of all interactive Pixi containers
 * that have `cursor = 'pointer'` (inventory items, world objects, pet slots, etc.).
 *
 * Called synchronously on every D-pad press — traverses the Pixi display tree
 * and collects eligible containers. Skips invisible branches for performance.
 *
 * Coordinate conversion: Pixi's getBounds() returns canvas-local CSS pixels.
 * Adding the canvas element's viewport offset gives us viewport coordinates.
 * For a full-screen game the canvas is at (0,0) so this is usually a no-op.
 */
export function getPixiInteractives(): Array<{ x: number; y: number }> {
  const cachedStore = getCachedStore();
  if (!quinoaEngineAtom || !cachedStore) return [];

  const engine = cachedStore.get(quinoaEngineAtom);
  if (!engine || typeof engine !== 'object') return [];

  const app = (engine as Record<string, unknown>)['app'];
  if (!app || typeof app !== 'object') return [];

  // Pixi v8 uses app.canvas; v7 used app.view (keep fallback)
  const canvas = ((app as Record<string, unknown>)['canvas'] ??
                  (app as Record<string, unknown>)['view']) as HTMLCanvasElement | null;
  const stage  = (app as Record<string, unknown>)['stage'];
  if (!stage || !canvas) return [];

  const canvasRect = canvas.getBoundingClientRect();
  const out: Array<{ x: number; y: number }> = [];
  collectPixiInteractives(stage as Record<string, unknown>, canvasRect, out);
  return out;
}

type PixiObj = Record<string, unknown>;

function collectPixiInteractives(
  obj: PixiObj,
  canvasRect: DOMRect,
  out: Array<{ x: number; y: number }>,
): void {
  // Skip invisible branches entirely (saves traversal time)
  if (obj['visible'] === false) return;
  if (typeof obj['alpha'] === 'number' && (obj['alpha'] as number) <= 0) return;

  // Collect leaf-level interactive objects that show a pointer cursor.
  // Using cursor='pointer' rather than eventMode alone avoids collecting
  // large background panels or scroll containers.
  if (obj['eventMode'] === 'static' && obj['cursor'] === 'pointer') {
    try {
      // getBounds() returns bounds in canvas-local CSS pixels (Pixi v7 + v8)
      const bounds = (obj as { getBounds(): { x: number; y: number; width: number; height: number } }).getBounds();
      if (bounds.width > 0 && bounds.height > 0) {
        const cx = bounds.x + bounds.width  / 2 + canvasRect.left;
        const cy = bounds.y + bounds.height / 2 + canvasRect.top;
        // Only include points within the visible viewport
        if (cx >= 0 && cx <= window.innerWidth && cy >= 0 && cy <= window.innerHeight) {
          out.push({ x: cx, y: cy });
        }
      }
    } catch {
      // getBounds() can throw for destroyed or unattached containers
    }
  }

  // Recurse into children
  const children = obj['children'];
  if (Array.isArray(children)) {
    for (const child of children) {
      if (child && typeof child === 'object') {
        collectPixiInteractives(child as PixiObj, canvasRect, out);
      }
    }
  }
}
