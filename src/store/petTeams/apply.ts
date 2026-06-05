// src/store/petTeams/apply.ts
// Apply engine — team swap orchestration (fast path + repair pass).

import { log } from '../../utils/logger';
import { delay } from '../../utils/scheduling/scheduling';
import { getActivePetInfos } from '../pets';
import { logTeamEvent } from '../petTeamsLogs';
import { sendRoomAction } from '../../websocket/api';
import { findEmptyGardenTile, PLACE_PET_DEFAULTS, resolveMyUserSlotIdx } from '../../features/pets/teamActions';
import { getHutchCapacity, INVENTORY_MAX } from '../hutch';
import { store, saveConfig } from './state';
import type { ApplyErrorReason, ApplyTeamResult } from './types';
import { mapSendReason, incrementReasonCount, buildErrorSummary } from './types';
import {
  PET_HUTCH_STORAGE_ID,
  HUTCH_RETRIEVE_TIMEOUT_MS,
  STORE_TIMEOUT_MS,
  PLACE_TIMEOUT_MS,
  APPLY_STEP_DELAY_MS,
  FAST_PATH_SETTLE_TIMEOUT_MS,
  FAST_SETTLE_POLL_INTERVAL_MS,
  REPAIR_SETTLE_TIMEOUT_MS,
  FAST_PATH_PHASE_GAP_MS,
  getActiveSlotIds,
  readInventorySnapshot,
  readHutchSnapshot,
  waitForInventoryContains,
  waitForHutchContains,
  waitForPetInActiveList,
  waitForPetNotActive,
  waitForActiveTeamMatch,
  locatePet,
} from './applyHelpers';

// ---------------------------------------------------------------------------
// Serialization queue
// ---------------------------------------------------------------------------

let applyQueue: Promise<void> = Promise.resolve();

function enqueueApply<T>(task: () => Promise<T>): Promise<T> {
  const run = applyQueue.then(task, task);
  applyQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

// ---------------------------------------------------------------------------
// Apply engine
// ---------------------------------------------------------------------------

async function applyTeamInternal(teamId: string): Promise<ApplyTeamResult> {
  store.applyInProgress = true;
  try {
    return await applyTeamBody(teamId);
  } finally {
    store.applyInProgress = false;
  }
}

async function applyTeamBody(teamId: string): Promise<ApplyTeamResult> {
  const team = store.config.teams.find(t => t.id === teamId);
  if (!team) return { applied: 0, errors: ['Team not found'] };

  const targetIds: string[] = [];
  for (const slot of team.slots.slice(0, 3)) {
    if (slot && !targetIds.includes(slot)) {
      targetIds.push(slot);
    }
  }
  if (targetIds.length === 0) return { applied: 0, errors: ['Team has no pets configured'] };

  const currentSet = new Set(getActiveSlotIds());
  const targetSet = new Set(targetIds);
  log(`[PetTeams:Apply] "${team.name}" targets=${targetIds.length} currentActive=${currentSet.size}`);
  log(`[PetTeams:Apply]   targetIds: [${targetIds.join(', ')}]`);
  log(`[PetTeams:Apply]   activeIds: [${[...currentSet].join(', ')}]`);
  if (targetIds.every((id) => currentSet.has(id)) && currentSet.size <= targetIds.length) {
    log('[PetTeams:Apply] Already matched — no-op');
    return { applied: 0, errors: [] };
  }

  const errors: string[] = [];
  const reasonCounts: Partial<Record<ApplyErrorReason, number>> = {};
  let applied = 0;

  const pushError = (reason: ApplyErrorReason, message: string): void => {
    errors.push(message);
    incrementReasonCount(reasonCounts, reason);
  };

  // Resolve player's garden slot index once — used by all PlacePet calls.
  const resolvedSlotIdx = await resolveMyUserSlotIdx();

  // Read hutch capacity synchronously from the reactive hutch store.
  const resolvedHutchCap = getHutchCapacity();

  // Pre-validate: check that all target pets are locatable somewhere.
  const validTargetIds: string[] = [];
  for (const targetId of targetIds) {
    if (currentSet.has(targetId)) {
      validTargetIds.push(targetId);
      continue;
    }
    const location = await locatePet(targetId);
    if (location) {
      validTargetIds.push(targetId);
    } else {
      pushError('not_found', `Pet ${targetId} could not be located — skipping`);
      log(`[PetTeams] Could not locate pet ${targetId} in "${team.name}" — skipping (not removing)`);
    }
  }

  log(`[PetTeams:Apply] Pre-validation: ${validTargetIds.length}/${targetIds.length} valid, ${errors.length} error(s)`);
  for (const err of errors) log(`[PetTeams:Apply]   pre-err: ${err}`);

  if (validTargetIds.length === 0) {
    const errorSummary = buildErrorSummary(reasonCounts);
    return {
      applied: 0,
      errors,
      ...(Object.keys(reasonCounts).length > 0 ? { reasonCounts } : {}),
      ...(errorSummary ? { errorSummary } : {}),
    };
  }

  const validTargetSet = new Set(validTargetIds);

  // ---------------------------------------------------------------------------
  // WS send helpers (scoped to this apply call)
  // ---------------------------------------------------------------------------

  const sendRetrieveFromHutch = (itemId: string, toInventoryIndex: number | null, skipThrottle = false) => {
    const payload: Record<string, unknown> = {
      itemId,
      storageId: PET_HUTCH_STORAGE_ID,
    };
    if (typeof toInventoryIndex === 'number' && Number.isFinite(toInventoryIndex) && toInventoryIndex >= 0) {
      payload.toInventoryIndex = toInventoryIndex;
    }
    return sendRoomAction(
      'RetrieveItemFromStorage',
      payload,
      skipThrottle ? { skipThrottle: true } : { throttleMs: 100 },
    );
  };

  const sendSwapPet = (petSlotId: string, petInventoryId: string, skipThrottle = false) =>
    sendRoomAction(
      'SwapPet',
      { petSlotId, petInventoryId },
      skipThrottle ? { skipThrottle: true } : { throttleMs: 100 },
    );

  // Track positions claimed during this apply to avoid placing two pets on the
  // same tile when the fast path fires multiple PlacePet messages at once.
  const claimedPositions = new Set<string>();

  const sendPlaceFromInventory = (itemId: string, skipThrottle = false) => {
    const tile = findEmptyGardenTile(claimedPositions, resolvedSlotIdx);
    const position = tile?.position ?? PLACE_PET_DEFAULTS.position;
    const tileType = tile?.tileType ?? PLACE_PET_DEFAULTS.tileType;
    const localTileIndex = tile?.localTileIndex ?? PLACE_PET_DEFAULTS.localTileIndex;

    if (tile) {
      claimedPositions.add(`${position.x},${position.y}`);
    }

    return sendRoomAction(
      'PlacePet',
      { itemId, position, tileType, localTileIndex },
      skipThrottle ? { skipThrottle: true } : { throttleMs: 100 },
    );
  };

  const sendPickupPet = (petId: string, skipThrottle = false) =>
    sendRoomAction(
      'PickupPet',
      { petId },
      skipThrottle ? { skipThrottle: true } : { throttleMs: 100 },
    );

  const sendStorePetDirect = (itemId: string, skipThrottle = false) =>
    sendRoomAction(
      'StorePet',
      { itemId },
      skipThrottle ? { skipThrottle: true } : { throttleMs: 100 },
    );

  const sendPutItemInStorage = (itemId: string, toStorageIndex: number | null, skipThrottle = false) => {
    const payload: Record<string, unknown> = {
      itemId,
      storageId: PET_HUTCH_STORAGE_ID,
    };
    if (typeof toStorageIndex === 'number' && Number.isFinite(toStorageIndex) && toStorageIndex >= 0) {
      payload.toStorageIndex = toStorageIndex;
    }
    return sendRoomAction(
      'PutItemInStorage',
      payload,
      skipThrottle ? { skipThrottle: true } : { throttleMs: 100 },
    );
  };

  const finishApply = (): ApplyTeamResult => {
    const errorSummary = buildErrorSummary(reasonCounts);
    const hasReasonCounts = Object.keys(reasonCounts).length > 0;
    store.config.activeTeamId = teamId;
    store.config.lastAppliedAt = Date.now();
    saveConfig();
    logTeamEvent(teamId, team.name, applied, errors);
    return {
      applied,
      errors,
      ...(hasReasonCounts ? { reasonCounts } : {}),
      ...(errorSummary ? { errorSummary } : {}),
    };
  };

  // ---------------------------------------------------------------------------
  // Confirmed action helpers
  // ---------------------------------------------------------------------------

  const placeFromInventoryWithConfirm = async (petId: string): Promise<boolean> => {
    const place = sendPlaceFromInventory(petId, false);
    if (!place.ok) {
      pushError(
        mapSendReason(place.reason, 'place_failed_or_timeout'),
        'PlacePet failed: ' + petId + ' (' + String(place.reason ?? 'unknown') + ')',
      );
      return false;
    }

    const placed = await waitForPetInActiveList(petId, PLACE_TIMEOUT_MS);
    if (!placed) {
      pushError('place_failed_or_timeout', 'PlacePet timed out: ' + petId);
      return false;
    }
    return true;
  };

  const putInventoryPetInHutchWithConfirm = async (
    petId: string,
    reportErrors: boolean,
  ): Promise<boolean> => {
    const hutch = await readHutchSnapshot(resolvedHutchCap);
    if (hutch.count >= hutch.hutchMax && hutch.freeIndex == null) {
      if (reportErrors) {
        pushError('hutch_store_failed_or_full', 'Pet Hutch is full while storing ' + petId);
      }
      return false;
    }

    const storeResult = sendPutItemInStorage(petId, hutch.freeIndex, false);
    if (!storeResult.ok) {
      if (reportErrors) {
        pushError(
          mapSendReason(storeResult.reason, 'hutch_store_failed_or_full'),
          'PutItemInStorage failed: ' + petId + ' (' + String(storeResult.reason ?? 'unknown') + ')',
        );
      }
      return false;
    }

    const stored = await waitForHutchContains(petId, STORE_TIMEOUT_MS);
    if (!stored) {
      if (reportErrors) {
        pushError('store_failed_or_timeout', 'PutItemInStorage timed out: ' + petId);
      }
      return false;
    }
    return true;
  };

  const freeInventorySlot = async (): Promise<boolean> => {
    const activeSet = new Set(getActiveSlotIds());
    const inventory = await readInventorySnapshot();
    const candidate = inventory.petIds.find(
      (id) => !activeSet.has(id) && !validTargetSet.has(id),
    );
    if (!candidate) return false;
    return putInventoryPetInHutchWithConfirm(candidate, false);
  };

  const ensureInventoryCapacity = async (): Promise<boolean> => {
    const inventory = await readInventorySnapshot();
    if (inventory.totalCount < INVENTORY_MAX) return true;
    const freed = await freeInventorySlot();
    if (!freed) return false;
    await delay(APPLY_STEP_DELAY_MS);
    return true;
  };

  const retrieveFromHutchWithConfirm = async (petId: string): Promise<boolean> => {
    // Attempt 1: ensure capacity, then retrieve
    if (!(await ensureInventoryCapacity())) {
      pushError('retrieve_failed_or_inventory_full', 'Cannot free inventory space for: ' + petId);
      return false;
    }

    const inv1 = await readInventorySnapshot();
    const r1 = sendRetrieveFromHutch(petId, inv1.freeIndex, false);
    if (r1.ok) {
      const ok = await waitForInventoryContains(petId, HUTCH_RETRIEVE_TIMEOUT_MS);
      if (ok) return true;
    }

    // Attempt 2: free one more slot (covers race where capacity filled between check and retrieve)
    const freed = await freeInventorySlot();
    if (freed) {
      await delay(APPLY_STEP_DELAY_MS);
    }

    const inv2 = await readInventorySnapshot();
    const r2 = sendRetrieveFromHutch(petId, inv2.freeIndex, false);
    if (r2.ok) {
      const ok = await waitForInventoryContains(petId, HUTCH_RETRIEVE_TIMEOUT_MS);
      if (ok) return true;
    }

    pushError(
      mapSendReason(r2.reason ?? r1.reason, 'retrieve_failed_or_inventory_full'),
      'RetrieveItemFromStorage failed: ' + petId + ' (inventory may be full)',
    );
    return false;
  };

  const swapIntoActiveWithConfirm = async (
    targetId: string,
    outgoingActiveId: string,
  ): Promise<boolean> => {
    const swap = sendSwapPet(outgoingActiveId, targetId, false);
    if (!swap.ok) {
      pushError(
        mapSendReason(swap.reason, 'swap_failed_or_timeout'),
        'SwapPet failed: ' + outgoingActiveId + ' -> ' + targetId + ' (' + String(swap.reason ?? 'unknown') + ')',
      );
      return false;
    }
    const swapped = await waitForPetInActiveList(targetId, PLACE_TIMEOUT_MS);
    if (!swapped) {
      pushError('swap_failed_or_timeout', 'SwapPet timed out: ' + outgoingActiveId + ' -> ' + targetId);
      return false;
    }
    return true;
  };

  // ---------------------------------------------------------------------------
  // Fast path
  // ---------------------------------------------------------------------------

  const applyTeamFastHutchPath = async (): Promise<boolean> => {
    const modeledActive = getActiveSlotIds();
    const modeledActiveSet = new Set(modeledActive);
    const pendingTargets = validTargetIds.filter((id) => !modeledActiveSet.has(id));
    if (pendingTargets.length === 0) {
      return modeledActive.every((id) => validTargetSet.has(id));
    }

    const inventory = await readInventorySnapshot();
    const hutch = await readHutchSnapshot(resolvedHutchCap);

    const modeledHutchIds = new Set(hutch.ids);
    const unavailableTargets = new Set<string>();
    let modeledInventoryCount = inventory.totalCount;
    let modeledInventoryIndex = inventory.freeIndex;
    let modeledHutchCount = hutch.count;
    let modeledHutchIndex = hutch.freeIndex;
    let fastOpsSent = 0;
    let fastApplied = 0;

    const retrieveTargets = pendingTargets.filter((targetId) => modeledHutchIds.has(targetId));

    for (const targetId of retrieveTargets) {
      if (modeledInventoryCount >= INVENTORY_MAX) {
        unavailableTargets.add(targetId);
        continue;
      }

      const retrieve = sendRetrieveFromHutch(targetId, modeledInventoryIndex, true);
      if (!retrieve.ok) {
        unavailableTargets.add(targetId);
        continue;
      }
      fastOpsSent++;
      modeledHutchIds.delete(targetId);
      modeledHutchCount = Math.max(0, modeledHutchCount - 1);
      modeledInventoryCount++;
      if (modeledHutchCount < hutch.hutchMax && modeledHutchIndex == null) {
        modeledHutchIndex = modeledHutchCount;
      }
      if (typeof modeledInventoryIndex === 'number') {
        modeledInventoryIndex += 1;
      }
    }

    // Let the game settle hutch-retrieve state updates before issuing swaps.
    if (retrieveTargets.length > 0) {
      await delay(FAST_PATH_PHASE_GAP_MS);
    }

    const displacedPets: string[] = [];
    for (const targetId of pendingTargets) {
      if (modeledActiveSet.has(targetId) || unavailableTargets.has(targetId)) {
        continue;
      }

      const outgoingIndex = modeledActive.findIndex((id) => !validTargetSet.has(id));
      if (outgoingIndex >= 0) {
        const outgoing = modeledActive[outgoingIndex];
        if (!outgoing) {
          continue;
        }
        const swap = sendSwapPet(outgoing, targetId, true);
        if (!swap.ok) {
          continue;
        }
        fastOpsSent++;
        modeledActive[outgoingIndex] = targetId;
        modeledActiveSet.delete(outgoing);
        modeledActiveSet.add(targetId);
        displacedPets.push(outgoing);
        fastApplied++;
      } else {
        const place = sendPlaceFromInventory(targetId, true);
        if (!place.ok) {
          continue;
        }
        fastOpsSent++;
        modeledActive.push(targetId);
        modeledActiveSet.add(targetId);
        fastApplied++;
      }
    }

    // Let the game settle swap state updates before storing displaced pets.
    if (displacedPets.length > 0) {
      await delay(FAST_PATH_PHASE_GAP_MS);
    }

    for (const displacedId of displacedPets) {
      if (modeledHutchCount >= hutch.hutchMax && modeledHutchIndex == null) {
        continue;
      }
      const storeResult = sendPutItemInStorage(displacedId, modeledHutchIndex, true);
      if (!storeResult.ok) {
        continue;
      }
      fastOpsSent++;
      modeledHutchCount = Math.min(hutch.hutchMax, modeledHutchCount + 1);
      if (typeof modeledHutchIndex === 'number') {
        const next = modeledHutchIndex + 1;
        modeledHutchIndex = next < hutch.hutchMax ? next : null;
      } else if (modeledHutchCount < hutch.hutchMax) {
        modeledHutchIndex = modeledHutchCount;
      }
    }

    log(`[PetTeams:Fast] sent=${fastOpsSent} (retrieves=${retrieveTargets.length}, swaps=${fastApplied}, stores=${displacedPets.length})`);
    if (fastOpsSent === 0) {
      log('[PetTeams:Fast] Nothing sent — falling through to repair');
      return false;
    }

    const settled = await waitForActiveTeamMatch(validTargetIds, FAST_PATH_SETTLE_TIMEOUT_MS, FAST_SETTLE_POLL_INTERVAL_MS);
    log(`[PetTeams:Fast] settled=${settled} activeNow=[${getActiveSlotIds().join(', ')}]`);
    if (settled) {
      applied += fastApplied;
    }
    return settled;
  };

  // ---------------------------------------------------------------------------
  // Repair pass
  // ---------------------------------------------------------------------------

  const applyTeamRepairPass = async (): Promise<void> => {
    // Reset claimed positions — fast path tiles are stale after failure.
    claimedPositions.clear();

    let activeNow = getActiveSlotIds();
    const pendingTargets = validTargetIds.filter((id) => !activeNow.includes(id));
    log(`[PetTeams:Repair] pendingTargets=${pendingTargets.length} activeNow=[${activeNow.join(', ')}]`);

    for (const targetId of pendingTargets) {
      activeNow = getActiveSlotIds();
      if (activeNow.includes(targetId)) {
        continue;
      }

      const location = await locatePet(targetId);
      if (!location) {
        pushError('missing_source_pet', 'Pet not found during repair: ' + targetId);
        await delay(APPLY_STEP_DELAY_MS);
        continue;
      }

      if (location === 'active') {
        continue;
      }

      if (location === 'hutch') {
        const retrieved = await retrieveFromHutchWithConfirm(targetId);
        if (!retrieved) {
          await delay(APPLY_STEP_DELAY_MS);
          continue;
        }
      } else if (location !== 'inventory') {
        continue;
      }

      const outgoing = getActiveSlotIds().find((id) => !validTargetSet.has(id)) ?? null;
      if (outgoing) {
        const swapped = await swapIntoActiveWithConfirm(targetId, outgoing);
        if (swapped) {
          applied++;
          await putInventoryPetInHutchWithConfirm(outgoing, false);
        } else {
          const placed = await placeFromInventoryWithConfirm(targetId);
          if (placed) {
            applied++;
          }
        }
      } else {
        const placed = await placeFromInventoryWithConfirm(targetId);
        if (placed) {
          applied++;
        }
      }
      await delay(APPLY_STEP_DELAY_MS);
    }

    const activePetsNow = getActivePetInfos();
    const leftovers = activePetsNow.filter((p) => p.slotId && !validTargetSet.has(p.slotId));
    for (const extra of leftovers) {
      const extraSlotId = extra.slotId!;
      // Primary: StorePet sends active → hutch directly (no inventory impact)
      const storeResult = sendStorePetDirect(extraSlotId, false);
      if (storeResult.ok) {
        const removed = await waitForPetNotActive(extraSlotId, STORE_TIMEOUT_MS);
        if (!removed) {
          pushError('store_failed_or_timeout', 'StorePet timed out: ' + extraSlotId);
          continue;
        }
      } else {
        // Fallback: if StorePet fails (hutch full?), try PickupPet if inventory has room
        const inv = await readInventorySnapshot();
        if (inv.totalCount < INVENTORY_MAX && extra.petId) {
          const pickup = sendPickupPet(extra.petId, false);
          if (!pickup.ok) {
            pushError(
              mapSendReason(pickup.reason, 'hutch_store_failed_or_full'),
              'PickupPet failed: ' + extraSlotId + ' (' + String(pickup.reason ?? 'unknown') + ')',
            );
            continue;
          }
          const picked = await waitForPetNotActive(extraSlotId, STORE_TIMEOUT_MS);
          if (!picked) {
            pushError('store_failed_or_timeout', 'PickupPet timed out: ' + extraSlotId);
            continue;
          }
          await putInventoryPetInHutchWithConfirm(extraSlotId, true);
        } else {
          pushError('hutch_store_failed_or_full', 'StorePet failed and inventory full: ' + extraSlotId);
          continue;
        }
      }
      applied++;
      await delay(APPLY_STEP_DELAY_MS);
    }
    await waitForActiveTeamMatch(validTargetIds, REPAIR_SETTLE_TIMEOUT_MS, FAST_SETTLE_POLL_INTERVAL_MS);
  };

  // ---------------------------------------------------------------------------
  // Execute
  // ---------------------------------------------------------------------------

  const fastSettled = await applyTeamFastHutchPath();
  if (!fastSettled) {
    log('[PetTeams:Apply] Fast path did not settle — running repair pass');
    await applyTeamRepairPass();
  } else {
    log('[PetTeams:Apply] Fast path settled successfully');
  }

  // Final cleanup: store any previously-active pets that ended up in inventory
  // back into the hutch when space is available.
  for (const prevId of currentSet) {
    if (validTargetSet.has(prevId)) continue;
    const loc = await locatePet(prevId);
    if (loc !== 'inventory') continue;
    const stored = await putInventoryPetInHutchWithConfirm(prevId, false);
    if (!stored) break; // hutch full — stop trying
    await delay(APPLY_STEP_DELAY_MS);
  }

  log(`[PetTeams:Apply] Done — applied=${applied} errors=${errors.length} finalActive=[${getActiveSlotIds().join(', ')}]`);
  for (const err of errors) log(`[PetTeams:Apply]   error: ${err}`);
  return finishApply();
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function applyTeam(teamId: string): Promise<ApplyTeamResult> {
  return enqueueApply(() => applyTeamInternal(teamId));
}
