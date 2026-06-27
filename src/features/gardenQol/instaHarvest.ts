// src/features/gardenQol/instaHarvest.ts
// Capture-phase keydown interception to bypass the client-side hold-to-harvest
// delay for Rainbow and Gold mutation plants. Sends HarvestCrop through the
// centralised sendRoomAction facade (Locker guard rules still apply).

import { readAtomValueSync } from '../../core/atomRegistry';
import { healthBus } from '../../diagnostics/healthBus';
import { createNamedLogger } from '../../diagnostics/logger';
import { buildError } from '../../diagnostics/result';
import type { Subsystem } from '../../diagnostics/types';
import { pageWindow } from '../../core/pageContext';
import { sendRoomAction, type WebSocketSendResult } from '../../websocket/api';
import { getGardenSnapshot } from '../garden/bridge';
import { getGardenQolConfig } from './state';
import { isRecord } from '../../utils/typeGuards';

// ── Types ──────────────────────────────────────────────────────────────────

interface GrowSlotLike {
  slotId: number;
  endTime: number;
  mutations: string[];
  species: string;
}

// ── Diagnostics ───────────────────────────────────────────────────────────

const FEATURE_SUBSYSTEM: Subsystem = 'feature:gardenInstaHarvest';
const FEATURE_NAME = 'gardenInstaHarvest';
const log = createNamedLogger(FEATURE_SUBSYSTEM);

/**
 * Re-attribute a FEATURE-* code emission to this feature's bus row. The
 * registered placeholder subsystem on FEATURE-001 is `'feature'`; without this
 * override the bus would degrade a generic `feature` entry instead of
 * `feature:gardenInstaHarvest`.
 */
function warnFeature(code: Parameters<typeof buildError>[0], ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  log.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
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

function sendHarvestCrop(dirtTileIndex: number, slotId: number): WebSocketSendResult {
  // Skip the per-key throttle: key-repeat is already filtered upstream in
  // onKeyDownCapture, and the game itself rejects duplicate sends against a
  // harvested slot. A throttle here would silently drop the legitimate
  // first-press in some edge cases (e.g. retry after Locker rejection).
  return sendRoomAction(
    'HarvestCrop',
    { slot: dirtTileIndex, slotsIndex: slotId },
    { skipThrottle: true },
  );
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

  const config = getGardenQolConfig();
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
  const result = sendHarvestCrop(dirtTileIndex, match.slot.slotId);
  if (!result.ok) {
    // Result-aware path — the WS layer already logs a WS-* code with the
    // underlying reason (no_connection / invalid_payload / send_failed /
    // locker_blocked). FEATURE-001 re-attributes that failure to this
    // feature's bus row so the user can see which feature degraded.
    warnFeature('QPM-FEATURE-001', {
      type: 'HarvestCrop',
      reason: result.reason ?? 'unknown',
      slot: dirtTileIndex,
      slotsIndex: match.slot.slotId,
    });
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

let listening = false;

export function startInstaHarvest(): void {
  if (listening) return;
  listening = true;
  // Register the feature's bus row on first start; idempotent (healthBus
  // .register preserves an existing entry's status if it's already there).
  healthBus.register(FEATURE_SUBSYSTEM, {
    category: 'feature',
    status: 'starting',
  });
  (pageWindow as unknown as Window).addEventListener('keydown', onKeyDownCapture as EventListener, true);
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'ok',
    message: 'Listening (capture-phase keydown)',
  });
}

export function stopInstaHarvest(): void {
  if (!listening) return;
  listening = false;
  (pageWindow as unknown as Window).removeEventListener('keydown', onKeyDownCapture as EventListener, true);
}
