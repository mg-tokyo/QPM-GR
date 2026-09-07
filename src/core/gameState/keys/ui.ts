// Client-local atoms with no room-state path.
import { atomSource, defineKey } from '../define';
import { isRecord } from '../../../utils/typeGuards';
import type { GridPosition } from '../../../types/gameAtoms';

const KNOWN_MODALS = new Set([
  'seedShop', 'eggShop', 'toolShop', 'inventory', 'leaderboard', 'journal', 'decorShop', 'stats', 'petHutch',
  'decorShed', 'activityLog', 'destroyCelestialConfirmation', 'seedSilo', 'newspaper', 'billboard', 'feedingTrough',
]);
const pos = (v: unknown): GridPosition | null | undefined =>
  (isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number' ? { x: v.x, y: v.y } : v === null ? null : undefined);

export const UI_KEYS = {
  activeModal: defineKey<string | null>({
    policy: 'client', tier: 'client', defaultValue: null, doc: 'Open modal id or null',
    sources: [atomSource(/^active(?:Modal|Dialog)(?:Name)?(?:Data)?Atom$/, 'client', {
      writable: true,
      structure: (v) => v === null || (typeof v === 'string' && KNOWN_MODALS.has(v)) || typeof v === 'string',
      prefer: (l) => l === 'activeModalAtom',
    })],
  }),
  selectedItemId: defineKey<string | null>({
    policy: 'client', tier: 'client', defaultValue: null, doc: 'Selected inventory item id (tool id for tools)',
    sources: [atomSource(/^mySelectedItemIdAtom$/, 'client', { writable: true, project: (v) => (typeof v === 'string' ? v : null) })],
  }),
  selectedSlotId: defineKey<number | null>({
    policy: 'client', tier: 'client', defaultValue: null, doc: 'Selected grow slot id',
    sources: [atomSource(/^mySelectedSlotIdAtom$/, 'client', { project: (v) => (typeof v === 'number' ? v : null) })],
  }),
  currentGrowSlotId: defineKey<number | null>({
    policy: 'client', tier: 'composite', defaultValue: null, doc: 'Grow slot id currently being harvested (myCurrentGrowSlotIdAtom)',
    sources: [atomSource(/^myCurrentGrowSlotIdAtom$/, 'client', { project: (v) => (typeof v === 'number' ? v : null) })],
  }),
  action: defineKey<unknown>({
    policy: 'client', tier: 'composite', doc: 'Current action type (state + input dependent)',
    sources: [atomSource(/^actionAtom$/, 'client')],
  }),
  position: defineKey<GridPosition | null>({
    policy: 'client', tier: 'client', defaultValue: null, doc: 'Player grid position',
    sources: [atomSource(/^positionAtom$/, 'client', { writable: true, project: pos })],
  }),
  localPosition: defineKey<GridPosition | null>({
    policy: 'client', tier: 'client', defaultValue: null, doc: 'Player position, null when spectating',
    sources: [atomSource(/^localPlayerPositionAtom$/, 'client', { project: pos })],
  }),
  quinoaEngine: defineKey<unknown>({
    policy: 'client', tier: 'dynamic', doc: 'PIXI engine handle (quinoaEngineAtom)',
    sources: [atomSource(/^quinoaEngineAtom$/, 'client', { structure: (v) => isRecord(v) && typeof v.getSystem === 'function' })],
  }),
};
