import { log } from '../../utils/logger';
import { getActivePetInfos, type ActivePetInfo } from '../../store/pets';
import { readInventoryDirect } from '../../store/inventory';
import { getFeedPolicy } from '../../store/petTeams';
import {
  buildFoodInventorySnapshot,
  evaluateFoodAvailabilityForPet,
  getPetFoodRules,
  type FoodSelection,
  type SpeciesOverride,
  type EligibleFoodEntry,
} from './foodRules';
import { hasRoomConnection, sendRoomAction } from '../../websocket/api';
import { isHungerPotionSelection, sendUseHungerPotion } from './hungerPotion';

export interface InstantFeedResult {
  success: boolean;
  petName: string | null;
  petSpecies: string | null;
  foodSpecies: string | null;
  error?: string;
}

export interface FeedQueueEvent {
  type: 'fed' | 'error' | 'drained';
  /** Slot index of the pet that was fed (or attempted). -1 for drained. */
  slotIndex: number;
  /** Number of items remaining in the queue after this event. */
  remaining: number;
  /** Feed result for 'fed'/'error' events. */
  result?: InstantFeedResult;
}

interface QueuedFeed {
  /** Resolve key: slotIndex, slotId, or petId. */
  resolveBy: 'slotIndex' | 'slotId' | 'petId';
  value: string | number;
  timestamp: number;
}

export interface InstantFeedPlan {
  ok: boolean;
  petIndex: number;
  petName: string | null;
  petSpecies: string | null;
  petId: string | null;
  slotId: string | null;
  avoidFavorited: boolean;
  availableCount: number;
  foodSelection: FoodSelection | null;
  eligibleFoods: EligibleFoodEntry[];
  error?: string;
}

function resolvePetForFeed(
  pets: ActivePetInfo[],
  petSlotOrIndex: number,
): ActivePetInfo | null {
  if (!Number.isFinite(petSlotOrIndex)) return null;
  const normalized = Math.max(0, Math.round(petSlotOrIndex));

  // Primary path: callers should pass the active slot index (0-2).
  const bySlot = pets.find((pet) => pet.slotIndex === normalized);
  if (bySlot) return bySlot;

  // Backward compatibility: older callers may still pass array index.
  return pets[normalized] ?? null;
}

function resolvePetForFeedById(
  pets: ActivePetInfo[],
  petId: string,
): ActivePetInfo | null {
  const normalizedPetId = String(petId ?? '').trim();
  if (!normalizedPetId) return null;
  return pets.find((pet) => pet.petId === normalizedPetId) ?? null;
}

function resolvePetForFeedBySlotId(
  pets: ActivePetInfo[],
  slotId: string,
): ActivePetInfo | null {
  const normalizedSlotId = String(slotId ?? '').trim();
  if (!normalizedSlotId) return null;
  return pets.find((pet) => pet.slotId === normalizedSlotId) ?? null;
}

function sendFeedPetMessage(petItemId: string, cropItemId: string): boolean {
  const sent = sendRoomAction('FeedPet', { petItemId, cropItemId }, { throttleMs: 120 });
  if (!sent.ok && sent.reason !== 'throttled') {
    log(`Failed to send FeedPet message (${sent.reason ?? 'unknown'})`);
    return false;
  }

  // Dispatch event so petTeamsLogs can record feed events without direct coupling.
  try {
    window.dispatchEvent(new CustomEvent('qpm:feedPet', { detail: { petItemId, cropItemId } }));
  } catch {}

  return sent.ok;
}

function toItemOverride(pet: ActivePetInfo): SpeciesOverride | undefined {
  if (!pet.slotId) return undefined;
  const feedPolicy = getFeedPolicy();
  const raw = feedPolicy.petItemOverrides[pet.slotId];
  if (!raw) return undefined;

  const normalized: SpeciesOverride = {};
  if (Array.isArray(raw.allowed)) normalized.allowed = [...raw.allowed];
  if (Array.isArray(raw.forbidden)) normalized.forbidden = [...raw.forbidden];
  if (typeof raw.preferred === 'string' && raw.preferred.length > 0) normalized.preferred = raw.preferred;

  const hasAllowed = Array.isArray(normalized.allowed);
  const hasForbidden = Array.isArray(normalized.forbidden);
  const hasPreferred = typeof normalized.preferred === 'string' && normalized.preferred.length > 0;
  if (!hasAllowed && !hasForbidden && !hasPreferred) return undefined;
  return normalized;
}

function makeMissingPetPlan(petIndex: number, error: string): InstantFeedPlan {
  return {
    ok: false,
    petIndex,
    petName: null,
    petSpecies: null,
    petId: null,
    slotId: null,
    avoidFavorited: true,
    availableCount: 0,
    foodSelection: null,
    eligibleFoods: [],
    error,
  };
}

async function buildPlanForPet(
  pet: ActivePetInfo,
  petSlotOrIndex: number,
): Promise<InstantFeedPlan> {
  const rules = getPetFoodRules();
  const override = toItemOverride(pet);

  const inventoryData = await readInventoryDirect();
  const snapshot = buildFoodInventorySnapshot(inventoryData);
  if (!snapshot || snapshot.items.length === 0) {
    return {
      ok: false,
      petIndex: petSlotOrIndex,
      petName: pet.name,
      petSpecies: pet.species,
      petId: pet.petId,
      slotId: pet.slotId,
      avoidFavorited: rules.avoidFavorited,
      availableCount: 0,
      foodSelection: null,
      eligibleFoods: [],
      error: 'No feedable produce found in inventory',
    };
  }

  const availability = evaluateFoodAvailabilityForPet(
    pet.species,
    snapshot,
    {
      avoidFavorited: rules.avoidFavorited,
      ...(override ? { itemOverride: override } : {}),
    },
  );

  return {
    ok: !!availability.selected,
    petIndex: petSlotOrIndex,
    petName: pet.name,
    petSpecies: pet.species,
    petId: pet.petId,
    slotId: pet.slotId,
    avoidFavorited: rules.avoidFavorited,
    availableCount: availability.availableCount,
    foodSelection: availability.selected,
    eligibleFoods: availability.eligibleFoods,
    ...(availability.selected ? {} : { error: 'No suitable food found in inventory' }),
  };
}

function resultFromPlanFailure(plan: InstantFeedPlan): InstantFeedResult {
  return {
    success: false,
    petName: plan.petName,
    petSpecies: plan.petSpecies,
    foodSpecies: null,
    error: plan.error ?? 'No suitable food found in inventory',
  };
}

async function executeFeedPlan(plan: InstantFeedPlan): Promise<InstantFeedResult> {
  if (!plan.ok || !plan.foodSelection) {
    return resultFromPlanFailure(plan);
  }

  if (!plan.petId) {
    return {
      success: false,
      petName: plan.petName,
      petSpecies: plan.petSpecies,
      foodSpecies: null,
      error: 'Pet has no petId (UUID)',
    };
  }

  // Hunger potion branch: ghost-step + ReplenishPotion instead of FeedPet
  if (isHungerPotionSelection(plan.foodSelection) && plan.slotId) {
    log(
      `Attempting to use Replenish Potion on ${plan.petName || plan.petSpecies || 'pet'}`,
    );

    const result = await sendUseHungerPotion(plan.slotId);
    if (!result.ok) {
      return {
        success: false,
        petName: plan.petName,
        petSpecies: plan.petSpecies,
        foodSpecies: 'Replenish Potion',
        error: `Failed to send ReplenishPotion (${result.reason ?? 'unknown'})`,
      };
    }

    log(`Used Replenish Potion on ${plan.petName || plan.petSpecies || 'pet'}`);
    return {
      success: true,
      petName: plan.petName,
      petSpecies: plan.petSpecies,
      foodSpecies: 'Replenish Potion',
    };
  }

  const crop = plan.foodSelection.item;
  if (!crop.id) {
    return {
      success: false,
      petName: plan.petName,
      petSpecies: plan.petSpecies,
      foodSpecies: crop.species ?? crop.name,
      error: 'Crop has no ID',
    };
  }

  log(
    `Attempting to feed ${plan.petName || plan.petSpecies || 'pet'} ` +
    `with ${crop.species || crop.name || 'food'} ` +
    `(available: ${plan.availableCount})`,
  );

  const sent = sendFeedPetMessage(plan.petId, crop.id);
  if (!sent) {
    return {
      success: false,
      petName: plan.petName,
      petSpecies: plan.petSpecies,
      foodSpecies: crop.species ?? crop.name,
      error: 'Failed to send WebSocket message',
    };
  }

  log(`Fed ${plan.petName || plan.petSpecies || 'pet'} with ${crop.species || crop.name || 'food'}`);
  return {
    success: true,
    petName: plan.petName,
    petSpecies: plan.petSpecies,
    foodSpecies: crop.species ?? crop.name,
  };
}

export async function getInstantFeedPlan(
  petSlotOrIndex: number,
): Promise<InstantFeedPlan> {
  const pets = getActivePetInfos();
  if (pets.length === 0) {
    return makeMissingPetPlan(petSlotOrIndex, 'No active pets found');
  }

  const pet = resolvePetForFeed(pets, petSlotOrIndex);
  if (!pet) {
    return makeMissingPetPlan(
      petSlotOrIndex,
      `Pet for slot/index ${petSlotOrIndex} not found`,
    );
  }

  return buildPlanForPet(pet, petSlotOrIndex);
}

export async function getInstantFeedPlanByPetId(
  petId: string,
): Promise<InstantFeedPlan> {
  const pets = getActivePetInfos();
  if (pets.length === 0) {
    return makeMissingPetPlan(-1, 'No active pets found');
  }

  const pet = resolvePetForFeedById(pets, petId);
  if (!pet) {
    return makeMissingPetPlan(-1, `Pet with id ${petId} not found`);
  }

  return buildPlanForPet(pet, pet.slotIndex);
}

export async function getInstantFeedPlanBySlotId(
  slotId: string,
): Promise<InstantFeedPlan> {
  const pets = getActivePetInfos();
  if (pets.length === 0) {
    return makeMissingPetPlan(-1, 'No active pets found');
  }

  const pet = resolvePetForFeedBySlotId(pets, slotId);
  if (!pet) {
    return makeMissingPetPlan(-1, `Pet with slotId ${slotId} not found`);
  }

  return buildPlanForPet(pet, pet.slotIndex);
}

/**
 * Feed a pet instantly via WebSocket (bypasses DOM clicks).
 * @param petSlotOrIndex Active slot index (preferred); falls back to array index for legacy callers.
 */
export async function feedPetInstantly(
  petSlotOrIndex: number,
): Promise<InstantFeedResult> {
  try {
    const plan = await getInstantFeedPlan(petSlotOrIndex);
    return await executeFeedPlan(plan);
  } catch (error) {
    log('Instant feed error', error);
    return {
      success: false,
      petName: null,
      petSpecies: null,
      foodSpecies: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function feedPetInstantlyByPetId(
  petId: string,
): Promise<InstantFeedResult> {
  try {
    const plan = await getInstantFeedPlanByPetId(petId);
    return await executeFeedPlan(plan);
  } catch (error) {
    log('Instant feed error', error);
    return {
      success: false,
      petName: null,
      petSpecies: null,
      foodSpecies: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function feedPetInstantlyBySlotId(
  slotId: string,
): Promise<InstantFeedResult> {
  try {
    const plan = await getInstantFeedPlanBySlotId(slotId);
    return await executeFeedPlan(plan);
  } catch (error) {
    log('Instant feed error', error);
    return {
      success: false,
      petName: null,
      petSpecies: null,
      foodSpecies: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function feedPetByIds(
  petId: string,
  cropId: string,
): Promise<InstantFeedResult> {
  try {
    const pets = getActivePetInfos();
    const pet = pets.find((p) => p.petId === petId);

    const sent = sendFeedPetMessage(petId, cropId);
    if (!sent) {
      return {
        success: false,
        petName: pet?.name ?? null,
        petSpecies: pet?.species ?? null,
        foodSpecies: null,
        error: 'Failed to send WebSocket message',
      };
    }

    log(`Fed pet ${petId} with crop ${cropId}`);
    return {
      success: true,
      petName: pet?.name ?? null,
      petSpecies: pet?.species ?? null,
      foodSpecies: null,
    };
  } catch (error) {
    log('Feed by IDs error', error);
    return {
      success: false,
      petName: null,
      petSpecies: null,
      foodSpecies: null,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

export async function feedAllPetsInstantly(
  hungerThreshold: number = 40,
): Promise<InstantFeedResult[]> {
  const pets = getActivePetInfos();
  const results: InstantFeedResult[] = [];

  for (let i = 0; i < pets.length; i++) {
    const pet = pets[i];
    if (!pet) continue;

    const hungerPct = pet.hungerPct ?? 100;
    if (hungerPct >= hungerThreshold) {
      log(`Skipping ${pet.name || pet.species} - hunger ${hungerPct}% >= ${hungerThreshold}%`);
      continue;
    }

    log(`Feeding ${pet.name || pet.species} - hunger ${hungerPct}%`);
    const result = await feedPetInstantly(pet.slotIndex);
    results.push(result);

    // Small delay between feeds to avoid overwhelming the server.
    if (i < pets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

// Feed queue: rapid enqueue without awaiting each feed.

const QUEUE_DRAIN_SPACING_MS = 100;

const feedQueue: QueuedFeed[] = [];
const claimedCropIds = new Set<string>();
let draining = false;
const queueListeners = new Set<(event: FeedQueueEvent) => void>();

function emitQueueEvent(event: FeedQueueEvent): void {
  for (const listener of queueListeners) {
    try {
      listener(event);
    } catch {
      // listener should not throw, but protect the drain loop
    }
  }
}

function resolveQueuedPet(entry: QueuedFeed): ActivePetInfo | null {
  const pets = getActivePetInfos();
  if (pets.length === 0) return null;

  switch (entry.resolveBy) {
    case 'slotIndex':
      return resolvePetForFeed(pets, entry.value as number);
    case 'slotId':
      return resolvePetForFeedBySlotId(pets, entry.value as string);
    case 'petId':
      return resolvePetForFeedById(pets, entry.value as string);
    default:
      return null;
  }
}

async function buildPlanExcluding(
  pet: ActivePetInfo,
  excludeIds: Set<string>,
): Promise<InstantFeedPlan> {
  const rules = getPetFoodRules();
  const override = toItemOverride(pet);

  const inventoryData = await readInventoryDirect();
  const snapshot = buildFoodInventorySnapshot(inventoryData, excludeIds);
  if (!snapshot || snapshot.items.length === 0) {
    return {
      ok: false,
      petIndex: pet.slotIndex,
      petName: pet.name,
      petSpecies: pet.species,
      petId: pet.petId,
      slotId: pet.slotId,
      avoidFavorited: rules.avoidFavorited,
      availableCount: 0,
      foodSelection: null,
      eligibleFoods: [],
      error: 'No feedable produce found in inventory',
    };
  }

  const availability = evaluateFoodAvailabilityForPet(
    pet.species,
    snapshot,
    {
      avoidFavorited: rules.avoidFavorited,
      ...(override ? { itemOverride: override } : {}),
    },
  );

  return {
    ok: !!availability.selected,
    petIndex: pet.slotIndex,
    petName: pet.name,
    petSpecies: pet.species,
    petId: pet.petId,
    slotId: pet.slotId,
    avoidFavorited: rules.avoidFavorited,
    availableCount: availability.availableCount,
    foodSelection: availability.selected,
    eligibleFoods: availability.eligibleFoods,
    ...(availability.selected ? {} : { error: 'No suitable food found in inventory' }),
  };
}

async function drainQueue(): Promise<void> {
  if (draining) return;
  draining = true;

  try {
    while (feedQueue.length > 0) {
      const entry = feedQueue.shift()!;
      const remaining = feedQueue.length;

      const pet = resolveQueuedPet(entry);
      if (!pet) {
        emitQueueEvent({
          type: 'error',
          slotIndex: typeof entry.value === 'number' ? entry.value : -1,
          remaining,
          result: {
            success: false,
            petName: null,
            petSpecies: null,
            foodSpecies: null,
            error: 'Pet not found',
          },
        });
        continue;
      }

      const plan = await buildPlanExcluding(pet, claimedCropIds);
      const result = await executeFeedPlan(plan);

      if (result.success && plan.foodSelection?.item.id) {
        claimedCropIds.add(plan.foodSelection.item.id);
      }

      emitQueueEvent({
        type: result.success ? 'fed' : 'error',
        slotIndex: pet.slotIndex,
        remaining,
        result,
      });

      // Space out WS sends to avoid overwhelming the server
      if (feedQueue.length > 0) {
        await new Promise((resolve) => setTimeout(resolve, QUEUE_DRAIN_SPACING_MS));
      }
    }
  } finally {
    draining = false;
    claimedCropIds.clear();
    emitQueueEvent({ type: 'drained', slotIndex: -1, remaining: 0 });
  }
}

function enqueueInternal(entry: QueuedFeed): void {
  feedQueue.push(entry);
  void drainQueue();
}

/**
 * Enqueue a feed for the pet at the given active slot index.
 * Returns immediately — the queue drains asynchronously.
 */
export function enqueueFeed(slotIndex: number): void {
  enqueueInternal({ resolveBy: 'slotIndex', value: slotIndex, timestamp: Date.now() });
}

/**
 * Enqueue a feed by slotId (item UUID of the active slot).
 */
export function enqueueFeedBySlotId(slotId: string): void {
  enqueueInternal({ resolveBy: 'slotId', value: slotId, timestamp: Date.now() });
}

/**
 * Enqueue a feed by petId (entity UUID).
 */
export function enqueueFeedByPetId(petId: string): void {
  enqueueInternal({ resolveBy: 'petId', value: petId, timestamp: Date.now() });
}

/**
 * Get the number of pending items in the feed queue.
 * If slotIndex is provided, counts only items targeting that slot.
 */
export function getFeedQueueLength(slotIndex?: number): number {
  if (slotIndex == null) return feedQueue.length;
  const pets = getActivePetInfos();
  return feedQueue.filter((entry) => {
    const pet = resolveQueuedPet(entry);
    return pet != null && pet.slotIndex === slotIndex;
  }).length;
}

/**
 * Clear pending feed queue items.
 * If slotIndex is provided, only clears items targeting that slot.
 */
export function clearFeedQueue(slotIndex?: number): void {
  if (slotIndex == null) {
    feedQueue.length = 0;
    return;
  }
  for (let i = feedQueue.length - 1; i >= 0; i--) {
    const entry = feedQueue[i];
    if (!entry) continue;
    const pet = resolveQueuedPet(entry);
    if (pet != null && pet.slotIndex === slotIndex) {
      feedQueue.splice(i, 1);
    }
  }
}

/**
 * Subscribe to feed queue events (fed, error, drained).
 * Returns an unsubscribe function.
 */
export function onFeedQueueEvent(cb: (event: FeedQueueEvent) => void): () => void {
  queueListeners.add(cb);
  return () => { queueListeners.delete(cb); };
}

export function isInstantFeedAvailable(): boolean {
  return hasRoomConnection();
}
