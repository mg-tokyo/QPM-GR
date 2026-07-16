/**
 * Action definitions, default bindings, and storage persistence.
 *
 * Rebindable actions map a gamepad button index to an Action string.
 * Hardcoded actions (Move, Start→Settings) are not stored here.
 */

import { t } from '../../../i18n';
import { storage } from '../../../utils/storage';
import { warnFeature } from './_diagnostics';

// ---------------------------------------------------------------------------
// Action type
// ---------------------------------------------------------------------------

export type Action =
  | 'primaryAction'      // Space (or cursor click when cursor visible)
  | 'back'               // Escape
  | 'inventory'          // E
  | 'rotateDecor'        // R
  | 'prevHotbarSlot'     // cycles hotbar 1-9 backwards
  | 'nextHotbarSlot'     // cycles hotbar 1-9 forwards
  | 'prevPetSlot'        // Jotai write
  | 'nextPetSlot'        // Jotai write
  | 'zoomIn'             // = key
  | 'zoomOut'            // - key
  | 'cursorClick'        // synthetic pointer click at cursor position
  | 'openSettings'       // open controller settings panel
  | 'deselectSlot'       // re-press active hotbar slot (LB+RB chord)
  | 'nextGrowSlot'       // C key — next grow slot on multi-harvest plants
  | 'prevGrowSlot';      // X key — prev grow slot on multi-harvest plants

// ---------------------------------------------------------------------------
// Human-readable names and descriptions
// ---------------------------------------------------------------------------

export const ALL_ACTIONS: readonly Action[] = [
  'primaryAction',
  'back',
  'inventory',
  'rotateDecor',
  'prevHotbarSlot',
  'nextHotbarSlot',
  'prevPetSlot',
  'nextPetSlot',
  'zoomIn',
  'zoomOut',
  'cursorClick',
  'openSettings',
  'deselectSlot',
  'nextGrowSlot',
  'prevGrowSlot',
] as const;

export function getActionLabel(action: Action): string {
  const labels: Record<Action, string> = {
    primaryAction: t('feature.controller.label.primaryAction'),
    back: t('feature.controller.label.back'),
    inventory: t('feature.controller.label.inventory'),
    rotateDecor: t('feature.controller.label.rotateDecor'),
    prevHotbarSlot: t('feature.controller.label.prevHotbarSlot'),
    nextHotbarSlot: t('feature.controller.label.nextHotbarSlot'),
    prevPetSlot: t('feature.controller.label.prevPetSlot'),
    nextPetSlot: t('feature.controller.label.nextPetSlot'),
    zoomIn: t('feature.controller.label.zoomIn'),
    zoomOut: t('feature.controller.label.zoomOut'),
    cursorClick: t('feature.controller.label.cursorClick'),
    openSettings: t('feature.controller.label.openSettings'),
    deselectSlot: t('feature.controller.label.deselectSlot'),
    nextGrowSlot: t('feature.controller.label.nextGrowSlot'),
    prevGrowSlot: t('feature.controller.label.prevGrowSlot'),
  };
  return labels[action];
}

// ---------------------------------------------------------------------------
// Default bindings: button index → Action
// ---------------------------------------------------------------------------

// NOTE: movement (D-Pad, Left Stick) and Settings (Start/9) are hardcoded.
export const DEFAULT_BINDINGS: Record<number, Action> = {
  0: 'primaryAction',    // A / ×
  1: 'back',             // B / ○
  2: 'rotateDecor',      // X / □
  3: 'inventory',        // Y / △
  4: 'prevHotbarSlot',   // LB
  5: 'nextHotbarSlot',   // RB
  6: 'prevPetSlot',      // LT
  7: 'nextPetSlot',      // RT
  9: 'openSettings',     // Start
  10: 'zoomOut',         // L3
  11: 'zoomIn',          // R3
};

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

const BINDINGS_KEY = 'qpm.controller.bindings.v1';

export function loadBindings(): Record<number, Action> {
  try {
    const parsed = storage.get<Record<string, string> | null>(BINDINGS_KEY, null);
    if (!parsed || typeof parsed !== 'object') return { ...DEFAULT_BINDINGS };
    const result: Record<number, Action> = { ...DEFAULT_BINDINGS };
    for (const [key, value] of Object.entries(parsed)) {
      const index = parseInt(key, 10);
      if (!isNaN(index) && isValidAction(value)) {
        result[index] = value;
      }
    }
    return result;
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveBindings(bindings: Record<number, Action>): void {
  try {
    storage.set(BINDINGS_KEY, bindings);
  } catch (err) {
    warnFeature('QPM-FEATURE-004', { what: 'bindings:save' }, err);
  }
}

const VALID_ACTIONS = new Set<string>(ALL_ACTIONS);

function isValidAction(value: string): value is Action {
  return VALID_ACTIONS.has(value);
}

// ---------------------------------------------------------------------------
// Cursor speed presets
// ---------------------------------------------------------------------------

export type CursorSpeed = 'slow' | 'medium' | 'fast';

const SPEED_KEY = 'qpm.controller.cursorSpeed.v1';

export const CURSOR_SPEED_VALUES: Record<CursorSpeed, number> = {
  slow: 400,
  medium: 700,
  fast: 1100,
};

export function loadCursorSpeed(): CursorSpeed {
  const raw = storage.get<string>(SPEED_KEY, 'medium');
  if (raw === 'slow' || raw === 'medium' || raw === 'fast') return raw;
  return 'medium';
}

export function saveCursorSpeed(speed: CursorSpeed): void {
  try {
    storage.set(SPEED_KEY, speed);
  } catch (err) {
    warnFeature('QPM-FEATURE-004', { what: 'cursorSpeed:save' }, err);
  }
}
