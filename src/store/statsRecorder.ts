// Wires game events to stats.ts record*() functions. Primary: myDataAtom.activityLog (server-confirmed).
// Secondary: abilityLogs store for pet ability procs (not in activity log).

import { subscribeAtomValue } from '../core/atomRegistry';
import { ACTION_MAP } from '../features/activity/activityLogNativeEnhancer/constants';
import { onAbilityHistoryUpdate, type AbilityHistory } from './abilityLogs';
import {
  recordGardenPlant,
  recordGardenHarvest,
  recordGardenDestroy,
  recordWateringCan,
  recordShopPurchase,
  recordFeedEvent,
  recordAbilityProc,
  type ShopCategoryKey,
} from './stats';
import { recordXpProc } from './xpTracker';
import { getActivePetInfos } from './pets';
import { createStoreDiagnostics } from './_storeDiagnostics';

const diag = createStoreDiagnostics('storeStatsRecorder', 'statsRecorder');

const cleanups: Array<() => void> = [];
let started = false;
let lastSeenLogLength = 0;
let activityLogCounts = { garden: 0, shop: 0, feed: 0, ability: 0 };

// Track ability proc timestamps to avoid double-counting
let lastSeenAbilityTimestamps = new Map<string, number>();

// Activity log entry processing

interface LogEntry {
  action?: string;
  timestamp?: number;
  parameters?: Record<string, unknown>;
  message?: string;
  text?: string;
  [key: string]: unknown;
}

function normalizeTimestamp(value: unknown): number {
  if (typeof value !== 'number') return Date.now();
  // Game sometimes uses seconds instead of milliseconds
  if (value < 1_000_000_000_000) return Math.round(value * 1000);
  return Math.round(value);
}

function classifyAction(action: string): string | null {
  const direct = ACTION_MAP[action];
  if (direct) return direct;

  const lower = action.toLowerCase();
  for (const [key, value] of Object.entries(ACTION_MAP)) {
    if (key.toLowerCase() === lower) return value;
  }

  return null;
}

function mapPurchaseActionToCategory(action: string): ShopCategoryKey {
  const lower = action.toLowerCase();
  if (lower.includes('seed')) return 'seeds';
  if (lower.includes('egg')) return 'eggs';
  if (lower.includes('tool')) return 'tools';
  if (lower.includes('decor')) return 'decor';
  if (lower.includes('dawn')) return 'dawn';
  return 'seeds';
}

function processLogEntry(entry: LogEntry): void {
  const action = entry.action;
  if (typeof action !== 'string' || !action) return;

  const category = classifyAction(action);
  const ts = normalizeTimestamp(entry.timestamp);
  const params = (entry.parameters && typeof entry.parameters === 'object')
    ? entry.parameters as Record<string, unknown>
    : {};

  switch (category) {
    case 'plant': {
      recordGardenPlant(1, ts);
      activityLogCounts.garden++;
      break;
    }
    case 'harvest': {
      recordGardenHarvest(1, ts);
      activityLogCounts.garden++;
      break;
    }
    case 'remove': {
      recordGardenDestroy(1, ts);
      activityLogCounts.garden++;
      break;
    }
    case 'water': {
      recordWateringCan(ts);
      activityLogCounts.garden++;
      break;
    }
    case 'buy': {
      const shopCategory = mapPurchaseActionToCategory(action);
      const itemName = String(
        params.species ?? params.name ?? params.displayName
        ?? params.itemName ?? params.eggId ?? params.toolId ?? params.decorId
        ?? 'Unknown'
      );
      const coins = Number(params.price ?? params.coins ?? params.cost ?? 0) || 0;
      const credits = Number(params.credits ?? 0) || 0;
      const magicDust = Number(params.magicDust ?? 0) || 0;
      recordShopPurchase(shopCategory, itemName, 1, coins, credits, magicDust, ts);
      activityLogCounts.shop++;
      break;
    }
    case 'feed': {
      const pet = (params.pet && typeof params.pet === 'object')
        ? params.pet as Record<string, unknown>
        : null;
      const petName = String(
        params.petName ?? params.petSpecies ?? pet?.species ?? pet?.name ?? 'Unknown Pet'
      );
      recordFeedEvent(petName, ts);
      activityLogCounts.feed++;
      break;
    }
    // Ability procs handled separately via abilityLogs store
    // Hatch events handled by petHatchingTracker
    default:
      break;
  }
}

// myDataAtom activity log subscription

function processActivityLog(rawValue: unknown): void {
  if (!rawValue || typeof rawValue !== 'object') return;

  const data = rawValue as Record<string, unknown>;
  // Game uses both 'activityLog' and 'activityLogs' depending on version
  const activityLog = data.activityLogs ?? data.activityLog;
  if (!Array.isArray(activityLog)) return;

  // On first call, just record the current length to avoid replaying history
  if (lastSeenLogLength === 0) {
    lastSeenLogLength = activityLog.length;
    return;
  }

  if (activityLog.length <= lastSeenLogLength) {
    lastSeenLogLength = activityLog.length;
    return;
  }

  const newEntries = activityLog.slice(lastSeenLogLength);
  lastSeenLogLength = activityLog.length;

  for (const entry of newEntries) {
    if (!entry || typeof entry !== 'object') continue;
    processLogEntry(entry as LogEntry);
  }
}

async function subscribeToActivityLog(): Promise<void> {
  try {
    const unsub = await subscribeAtomValue('myData', (value) => {
      try {
        processActivityLog(value);
      } catch (error) {
        diag.warn('QPM-STORE-003', { phase: 'processActivityLog' }, error);
      }
    });
    if (!unsub) {
      diag.warn('QPM-STORE-002', { atom: 'myData' });
      return;
    }
    cleanups.push(unsub);
    diag.log.debug('Subscribed to myDataAtom activity log');
  } catch (error) {
    diag.warn('QPM-STORE-001', { phase: 'subscribeMyData' }, error);
  }
}

// Ability stats — from abilityLogs store (not in activity log)

function handleAbilityUpdate(snapshot: ReadonlyMap<string, AbilityHistory>): void {
  for (const [_key, history] of snapshot) {
    if (!history.events.length) continue;

    const lastSeen = lastSeenAbilityTimestamps.get(history.abilityId) ?? 0;

    for (const event of history.events) {
      if (event.performedAt > lastSeen) {
        recordAbilityProc(history.abilityId, 0, event.performedAt);
        activityLogCounts.ability++;

        if (history.petId) {
          const pet = getActivePetInfos().find(p => p.petId === history.petId);
          recordXpProc(
            history.petId,
            pet?.name ?? 'Unknown',
            pet?.species ?? 'Unknown',
            history.abilityId,
            0,
          );
        }
      }
    }

    const latestEvent = history.events[history.events.length - 1];
    if (latestEvent && latestEvent.performedAt > lastSeen) {
      lastSeenAbilityTimestamps.set(history.abilityId, latestEvent.performedAt);
    }
  }
}

// Lifecycle

export function startStatsRecorder(): () => void {
  if (started) return () => {};
  started = true;

  diag.register('Wiring activity log + ability subscribers');

  lastSeenLogLength = 0;
  lastSeenAbilityTimestamps = new Map();
  activityLogCounts = { garden: 0, shop: 0, feed: 0, ability: 0 };

  // Primary: subscribe to myDataAtom activity log (server-confirmed events)
  void subscribeToActivityLog();

  // Secondary: ability procs from abilityLogs store
  let isFirstAbilityCall = true;
  const unsubAbility = onAbilityHistoryUpdate((snapshot) => {
    if (isFirstAbilityCall) {
      isFirstAbilityCall = false;
      for (const [_key, history] of snapshot) {
        if (history.events.length) {
          const latest = history.events[history.events.length - 1];
          if (latest) {
            lastSeenAbilityTimestamps.set(history.abilityId, latest.performedAt);
          }
        }
      }
      return;
    }
    handleAbilityUpdate(snapshot);
  });
  cleanups.push(unsubAbility);

  diag.publishOk('Stats recorder started');

  return stopStatsRecorder;
}

export function stopStatsRecorder(): void {
  if (!started) return;
  started = false;
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch { /* teardown best-effort — silent per §4.5 precedent */ }
  }
  cleanups.length = 0;
  lastSeenAbilityTimestamps.clear();
  lastSeenLogLength = 0;
  diag.log.debug('Stats recorder stopped');
}

/** Debug: recorder state + event counts since start */
export function getStatsRecorderStatus(): {
  started: boolean;
  counts: { garden: number; shop: number; feed: number; ability: number };
} {
  return { started, counts: { ...activityLogCounts } };
}
