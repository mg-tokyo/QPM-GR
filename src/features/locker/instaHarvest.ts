// src/features/locker/instaHarvest.ts
// Capture-phase keydown interception to bypass the client-side hold-to-harvest
// delay for Rainbow and Gold mutation plants. Sends HarvestCrop immediately
// through the native sendMessage (Locker guard rules still apply).

import { pageWindow } from '../../core/pageContext';
import { readAtomValueSync } from '../../core/atomRegistry';
import { getGardenSnapshot } from '../garden/bridge';
import { getLockerConfig } from './state';
import { isRecord } from '../../utils/typeGuards';

// ── Types ──────────────────────────────────────────────────────────────────

interface GrowSlotLike {
  slotId: number;
  endTime: number;
  mutations: string[];
  species: string;
}

interface RoomConnectionLike {
  sendMessage: (payload: unknown) => unknown;
}

interface PageWithRoomConnection extends Window {
  MagicCircle_RoomConnection?: RoomConnectionLike;
  __mga_lastScopePath?: string[];
}

// ── Harvest action guard ─────────────────────────────────────────────────

const HARVEST_ACTIONS: ReadonlySet<string> = new Set(['harvest', 'rainbowHarvest', 'goldHarvest']);

// ── Synchronous reads ──────────────────────────────────────────────────────

function getDirtTileIndexSync(): number | null {
  return readAtomValueSync('dirtTileIndex');
}

function getSelectedSlotIdSync(): number | null {
  return readAtomValueSync('selectedSlotId');
}

/**
 * Read the grow slots for a given dirt tile index from the garden snapshot.
 * Returns the parsed slots array, or null if unavailable.
 */
function getGrowSlotsForTile(dirtTileIndex: number): GrowSlotLike[] | null {
  const garden = getGardenSnapshot();
  if (!garden) return null;

  const key = String(dirtTileIndex);
  const tile =
    (garden.tileObjects as Record<string, unknown> | undefined)?.[key]
    ?? (garden.boardwalkTileObjects as Record<string, unknown> | undefined)?.[key];

  if (!isRecord(tile)) return null;
  if (!Array.isArray(tile.slots) || tile.slots.length === 0) return null;

  const parsed: GrowSlotLike[] = [];
  for (const raw of tile.slots) {
    if (!isRecord(raw)) continue;
    if (typeof raw.slotId !== 'number' || typeof raw.endTime !== 'number') continue;
    const mutations = Array.isArray(raw.mutations)
      ? raw.mutations.filter((m): m is string => typeof m === 'string')
      : [];
    const species = typeof raw.species === 'string' ? raw.species : '';
    parsed.push({ slotId: raw.slotId, endTime: raw.endTime, mutations, species });
  }
  return parsed.length > 0 ? parsed : null;
}

// ── Mutation check ─────────────────────────────────────────────────────────

function checkSlot(
  slot: GrowSlotLike,
  instaRainbow: boolean,
  instaGold: boolean,
): { slot: GrowSlotLike; kind: 'rainbow' | 'gold' } | null {
  if (slot.endTime > Date.now()) return null;
  if (instaRainbow && slot.mutations.includes('Rainbow')) return { slot, kind: 'rainbow' };
  if (instaGold && slot.mutations.includes('Gold')) return { slot, kind: 'gold' };
  return null;
}

/**
 * Find the user-selected mature slot that qualifies for insta-harvest.
 * On multi-harvest plants, only checks the slot the user has selected
 * (via mySelectedSlotIdAtom which stores the slotId). Falls back to
 * first qualifying slot if selection is unknown.
 */
function findInstaHarvestSlot(
  slots: GrowSlotLike[],
  instaRainbow: boolean,
  instaGold: boolean,
): { slot: GrowSlotLike; kind: 'rainbow' | 'gold' } | null {
  const selectedSlotId = getSelectedSlotIdSync();

  if (selectedSlotId != null) {
    const selected = slots.find(s => s.slotId === selectedSlotId);
    if (selected) return checkSlot(selected, instaRainbow, instaGold);
  }

  for (const slot of slots) {
    const result = checkSlot(slot, instaRainbow, instaGold);
    if (result) return result;
  }
  return null;
}

// ── WS send ────────────────────────────────────────────────────────────────

const DEFAULT_SCOPE_PATH = ['Room', 'Quinoa'];

function getScopePath(): string[] {
  const dynamic = (pageWindow as PageWithRoomConnection).__mga_lastScopePath;
  if (Array.isArray(dynamic) && dynamic.length > 0) return dynamic.slice();
  return [...DEFAULT_SCOPE_PATH];
}

function sendHarvestCrop(dirtTileIndex: number, slotId: number): boolean {
  const connection = (pageWindow as PageWithRoomConnection).MagicCircle_RoomConnection;
  if (!connection || typeof connection.sendMessage !== 'function') return false;
  try {
    connection.sendMessage({
      scopePath: getScopePath(),
      type: 'HarvestCrop',
      slot: dirtTileIndex,
      slotsIndex: slotId,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Keydown handler ────────────────────────────────────────────────────────

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function onKeyDownCapture(event: KeyboardEvent): void {
  if (event.code !== 'Space') return;
  if (event.repeat || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (isTextInputFocused()) return;

  const config = getLockerConfig();
  if (!config.instaHarvestRainbow && !config.instaHarvestGold) return;

  // Skip insta-harvest when a non-harvest action is active (tool equipped, shop open, etc.)
  const actionRaw = readAtomValueSync('action');
  const currentAction = typeof actionRaw === 'string' ? actionRaw : null;
  if (currentAction && !HARVEST_ACTIONS.has(currentAction)) return;

  const dirtTileIndex = getDirtTileIndexSync();
  if (dirtTileIndex == null) return;

  const slots = getGrowSlotsForTile(dirtTileIndex);
  if (!slots) return;

  const match = findInstaHarvestSlot(slots, config.instaHarvestRainbow, config.instaHarvestGold);
  if (!match) return;

  event.stopImmediatePropagation();
  event.preventDefault();
  sendHarvestCrop(dirtTileIndex, match.slot.slotId);
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

let listening = false;

export function startInstaHarvest(): void {
  if (listening) return;
  listening = true;
  (pageWindow as unknown as Window).addEventListener('keydown', onKeyDownCapture as EventListener, true);
}

export function stopInstaHarvest(): void {
  if (!listening) return;
  listening = false;
  (pageWindow as unknown as Window).removeEventListener('keydown', onKeyDownCapture as EventListener, true);
}
