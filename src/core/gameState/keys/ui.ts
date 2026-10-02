// Client-local atoms with no room-state path.
import { atomSource, customSource, defineKey } from '../define';
import { isRecord } from '../../../utils/typeGuards';
import { isQuinoaEngine } from '../../../utils/quinoaEngine';
import { findAtomsByLabel, getCachedStore, subscribeAtom } from '../../jotaiBridge';
import type { GridPosition, NpcChatBubble } from '../../../types/gameAtoms';

const KNOWN_MODALS = new Set([
  'seedShop', 'eggShop', 'toolShop', 'inventory', 'leaderboard', 'journal', 'decorShop', 'stats', 'petHutch',
  'decorShed', 'activityLog', 'destroyCelestialConfirmation', 'seedSilo', 'newspaper', 'billboard', 'feedingTrough',
]);
const pos = (v: unknown): GridPosition | null | undefined =>
  (isRecord(v) && typeof v.x === 'number' && typeof v.y === 'number' ? { x: v.x, y: v.y } : v === null ? null : undefined);
const slotIdOrNull = (v: unknown): number | null => (typeof v === 'number' ? v : null);

function readAtomExact(label: string): unknown {
  const store = getCachedStore();
  if (!store || store.__polyfill) return undefined;
  const atoms = findAtomsByLabel(new RegExp(`^${label}$`));
  if (atoms.length === 0) return undefined;
  try { return store.get(atoms[0]); } catch { return undefined; }
}

function subscribeAtomExact(label: string, cb: () => void): () => void {
  const atoms = findAtomsByLabel(new RegExp(`^${label}$`));
  if (atoms.length === 0) return () => {};
  let disposed = false;
  let detach: (() => void) | null = null;
  void subscribeAtom(atoms[0], () => { if (!disposed) cb(); })
    .then((off) => { if (disposed) { try { off(); } catch { /* ignore */ } } else { detach = off; } })
    .catch(() => { /* ignore */ });
  return () => {
    disposed = true;
    if (detach) { try { detach(); } catch { /* ignore */ } detach = null; }
  };
}

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
    policy: 'client', tier: 'client', defaultValue: null,
    doc: 'Selected inventory item id (tool id for tools). 1361+ (primary): mySelectedItemIdAtom, derived from heldItem.itemId (read-only). 1202-era (fallback): displayedInventoryItemIdsAtom[myValidatedSelectedItemIndexAtom].',
    sources: [
      atomSource(/^mySelectedItemIdAtom$/, 'client', { project: (v) => (typeof v === 'string' ? v : null) }),
      customSource<string | null>({
        id: 'selectedItemId:index+displayedIds',
        available: () => {
          const store = getCachedStore();
          return !!store && !store.__polyfill;
        },
        read: () => {
          const idxRaw = readAtomExact('myValidatedSelectedItemIndexAtom');
          const idsRaw = readAtomExact('displayedInventoryItemIdsAtom');
          if (idxRaw === undefined || idsRaw === undefined) return undefined;
          if (typeof idxRaw !== 'number') return null;
          if (!Array.isArray(idsRaw)) return null;
          const id = idsRaw[idxRaw];
          return typeof id === 'string' ? id : null;
        },
        subscribe: (push) => {
          const off1 = subscribeAtomExact('myValidatedSelectedItemIndexAtom', push);
          const off2 = subscribeAtomExact('displayedInventoryItemIdsAtom', push);
          return () => { try { off1(); } catch { /* ignore */ } try { off2(); } catch { /* ignore */ } };
        },
      }),
    ],
  }),
  selectedSlotId: defineKey<number | null>({
    policy: 'client', tier: 'client', defaultValue: null,
    doc: 'Selected grow slot id — game ≥1152 selectedCropSlotIdAtom (resolved slot on the plant under the player); older builds mySelectedSlotIdAtom',
    sources: [
      atomSource(/^selectedCropSlotIdAtom$/, 'client', { project: slotIdOrNull }),
      atomSource(/^mySelectedSlotIdAtom$/, 'client', { project: slotIdOrNull }),
    ],
  }),
  currentGrowSlotId: defineKey<number | null>({
    policy: 'client', tier: 'composite', defaultValue: null,
    doc: 'Grow slot id currently rendered for the plant under the player — game ≥1152 selectedCropSlotIdAtom; older builds myCurrentGrowSlotIdAtom',
    sources: [
      atomSource(/^selectedCropSlotIdAtom$/, 'client', { project: slotIdOrNull }),
      atomSource(/^myCurrentGrowSlotIdAtom$/, 'client', { project: slotIdOrNull }),
    ],
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
    policy: 'client', tier: 'dynamic', doc: 'Game engine handle (quinoaEngineAtom; quinoaDevEngineAtom since game 1152). Systems: boot.{seat,world}Scope (1152) or page.{playerViews,rendererScope}.systemRegistry (1202+).',
    sources: [atomSource(/^quinoa(?:Dev)?EngineAtom$/, 'client', { structure: isQuinoaEngine, prefer: (l) => l === 'quinoaEngineAtom' })],
  }),
  npcChatBubbles: defineKey<Record<string, NpcChatBubble>>({
    policy: 'client', tier: 'client', doc: 'NPC chat bubbles by NPC playerId. Client-only, never networked. Talk replaces the whole map; NPC Visits (1361+) write `NPC_<name>#<forUserId>` keys, often spreading existing entries back (keepOthers / single-entry delete); a modal clears it.',
    sources: [atomSource(/^npcChatBubblesAtom$/, 'client', { writable: true, structure: (v) => isRecord(v) })],
  }),
  adjacentNpcId: defineKey<string | null>({
    policy: 'client', tier: 'client', defaultValue: null, doc: 'NPC the player can Talk to right now (standing on or beside it), or null',
    sources: [atomSource(/^adjacentNpcIdAtom$/, 'client', { project: (v) => (typeof v === 'string' ? v : v === null ? null : undefined) })],
  }),
};
