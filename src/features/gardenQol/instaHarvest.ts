// Capture-phase keydown interception bypasses the client-side hold-to-harvest
// delay for any hold-harvest kind the user has opted into. Kind list is
// discovered dynamically (bundle extractor + live observer), classification is
// deferred to the game's own `action` atom — QPM never hardcodes mutation or
// action names.

import { readAtomValueSync } from '../../core/atomRegistry';
import { healthBus } from '../../diagnostics/healthBus';
import { createNamedLogger } from '../../diagnostics/logger';
import { buildError } from '../../diagnostics/result';
import type { Subsystem } from '../../diagnostics/types';
import { pageWindow } from '../../core/pageContext';
import { sendRoomAction } from '../../websocket/api';
import { getGardenSnapshot } from '../garden/bridge';
import { isRecord } from '../../utils/typeGuards';
import { isHarvestAction } from './actionShape';
import { getEnabledActions } from './holdHarvestKinds';

interface GrowSlotLike { slotId: number }

const FEATURE_SUBSYSTEM: Subsystem = 'feature:gardenInstaHarvest';
const FEATURE_NAME = 'gardenInstaHarvest';
const log = createNamedLogger(FEATURE_SUBSYSTEM);

let degradedPublished = false;

function warnFeature(code: Parameters<typeof buildError>[0], ctx: Record<string, unknown>, cause?: unknown): void {
  const built = buildError(code, { feature: FEATURE_NAME, ...ctx }, cause);
  log.warn({ ...built, subsystem: FEATURE_SUBSYSTEM, severity: 'warn' });
}

function publishDegradedOnce(reason: string): void {
  if (degradedPublished) return;
  degradedPublished = true;
  healthBus.publish({
    subsystem: FEATURE_SUBSYSTEM,
    category: 'feature',
    status: 'degraded',
    message: `action atom unreadable while a kind is enabled (${reason})`,
  });
}

function isTextInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return true;
  if ((el as HTMLElement).isContentEditable) return true;
  return false;
}

function getDirtTileIndexSync(): number | null {
  return readAtomValueSync('dirtTileIndex');
}

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
    if (typeof raw.slotId !== 'number') continue;
    parsed.push({ slotId: raw.slotId });
  }
  return parsed.length > 0 ? parsed : null;
}

// Priority 1: the game's own myCurrentGrowSlotIdAtom — authoritative because
// getPlantAction reads its parent atom too, so it's what the action atom is
// derived from. Registered as `currentGrowSlotId` in atomRegistry.
function tryReadCurrentGrowSlotId(): number | null {
  try {
    const v = readAtomValueSync('currentGrowSlotId');
    return typeof v === 'number' ? v : null;
  } catch {
    return null;
  }
}

function resolveTargetSlotId(dirtTileIndex: number): number | null {
  const gameSlot = tryReadCurrentGrowSlotId();
  if (gameSlot != null) return gameSlot;

  const selected = readAtomValueSync('selectedSlotId');
  if (typeof selected === 'number') return selected;

  const slots = getGrowSlotsForTile(dirtTileIndex);
  return slots && slots.length === 1 ? slots[0]!.slotId : null;
}

function onKeyDownCapture(event: KeyboardEvent): void {
  if (event.code !== 'Space') return;
  if (event.repeat || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (isTextInputFocused()) return;

  const enabled = getEnabledActions();
  if (enabled.size === 0) return;

  const action = readAtomValueSync('action');
  if (typeof action !== 'string') {
    publishDegradedOnce(action === null ? 'null' : typeof action);
    return;
  }
  if (!isHarvestAction(action) || action === 'harvest') return;
  if (!enabled.has(action)) return;

  const dirtTileIndex = getDirtTileIndexSync();
  if (dirtTileIndex == null) return;

  const slotId = resolveTargetSlotId(dirtTileIndex);
  if (slotId == null) return;

  event.stopImmediatePropagation();
  event.preventDefault();

  const result = sendRoomAction(
    'HarvestCrop',
    { slot: dirtTileIndex, slotsIndex: slotId },
    { skipThrottle: true },
  );
  if (!result.ok) {
    warnFeature('QPM-FEATURE-001', {
      type: 'HarvestCrop',
      reason: result.reason ?? 'unknown',
      action,
      slot: dirtTileIndex,
      slotsIndex: slotId,
    });
  }
}

let listening = false;

export function startInstaHarvest(): void {
  if (listening) return;
  listening = true;
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

export function _snapshotForDebug(): unknown {
  return {
    action: readAtomValueSync('action'),
    dirtTileIndex: readAtomValueSync('dirtTileIndex'),
    selectedSlotId: readAtomValueSync('selectedSlotId'),
    currentGrowSlotId: tryReadCurrentGrowSlotId(),
    enabledActions: Array.from(getEnabledActions()),
    listening,
  };
}
