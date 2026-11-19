// Phone-push sync (ALR-8.2b): one GET of the account's push list, then serial POSTs that add
// pinned topics and remove only the topics QPM made. Click-driven only: no retries, no timer,
// stops at the first failure or VersionExpired (409). Game routes: beta client/src/notifications/subscriptions.ts.

import { pageWindow } from '../../core/pageContext';
import { getPlayerIdSync } from '../../core/playerContext';
import { getRoomApiBase } from '../../catalogs/catalogLoader/ownership';
import { loadPushRules } from '../../catalogs/logic/pushRulesCatalog';
import type { PushRules } from '../../catalogs/logic/pushRulesCatalog';
import { getItemEligibleShops, getShopFacingCatalogEntry } from '../../catalogs/shopEligibility';
import { buildAuthHeaders, buildTimeoutSignal } from '../../services/authFetch';
import { loadTrackedSet } from '../../store/restockTracked';
import { canonicalItemId } from '../../utils/restock/dataService';
import { storage } from '../../utils/storage';
import { createNamedLogger } from '../../diagnostics/logger';
import { mapNightStages, mapPinsToTopics, parseSubscriptionList, planPushSync, topicKey } from './phonePushPlan';
import type { PinLookup, PushSkipped, PushTopic } from './phonePushPlan';

export const PHONE_PUSH_MADE_KEY = 'qpm.restock.phonePush.made.v1';
const REQUEST_GAP_MS = 300;
const TIMEOUT_MS = 15_000;

export type PhonePushError =
  | 'busy' | 'rules-unavailable' | 'no-player' | 'no-room'
  | 'version-expired' | 'list-failed' | 'list-unreadable' | 'request-failed' | 'network';

export interface PhonePushOptions {
  pins?: readonly string[];        // default: every saved restock pin
  nightStages?: readonly string[]; // e.g. ['sunset']; ids from the game's rules
  dryRun?: boolean;                // GET only; nothing sent, nothing recorded
}

export interface PhonePushFailure { action: 'list' | 'subscribe' | 'unsubscribe'; topic: PushTopic | null; status: number | null }

export interface PhonePushResult {
  ok: boolean;
  error: PhonePushError | null;
  dryRun: boolean;
  added: PushTopic[];
  removed: PushTopic[];
  skipped: PushSkipped[];
  pending: { add: PushTopic[]; remove: PushTopic[] }; // planned, not sent (dry run or stopped)
  unchanged: number;
  failed: PhonePushFailure | null;
}

export interface PhonePushDeps {
  loadRules(): Promise<PushRules | null>;
  playerId(): string | null;
  apiBase(): Promise<string | null>;
  fetch(url: string, init: RequestInit): Promise<Response>;
  pins(): string[];
  lookup: PinLookup;
  readMade(playerId: string): string[];
  writeMade(playerId: string, keys: string[]): void;
  wait(ms: number): Promise<void>;
}

type Step = { action: 'subscribe' | 'unsubscribe'; topic: PushTopic };

const log = createNamedLogger('feature:phonePush');
let inFlight = false;

function readMadeMap(): Record<string, string[]> {
  const saved = storage.get<Record<string, string[]> | null>(PHONE_PUSH_MADE_KEY, null);
  return saved && typeof saved === 'object' ? saved : {};
}

const realDeps: PhonePushDeps = {
  loadRules: loadPushRules,
  playerId: getPlayerIdSync,
  apiBase: getRoomApiBase,
  fetch: (url, init) => pageWindow.fetch.bind(pageWindow)(url, init),
  pins: () => [...loadTrackedSet()],
  lookup: {
    canonical: canonicalItemId,
    kindOf: (itemId) => getShopFacingCatalogEntry(itemId)?.kind ?? null,
    eligibleShops: getItemEligibleShops,
  },
  readMade: (playerId) => {
    const keys = readMadeMap()[playerId];
    return Array.isArray(keys) ? keys.filter((k): k is string => typeof k === 'string') : [];
  },
  writeMade: (playerId, keys) => storage.set(PHONE_PUSH_MADE_KEY, { ...readMadeMap(), [playerId]: keys }),
  wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
};

function emptyResult(dryRun: boolean, error: PhonePushError | null, skipped: PushSkipped[] = []): PhonePushResult {
  return { ok: error === null, error, dryRun, added: [], removed: [], skipped, pending: { add: [], remove: [] }, unchanged: 0, failed: null };
}

function requestInit(method: 'GET' | 'POST', body?: PushTopic): RequestInit {
  const signal = buildTimeoutSignal(TIMEOUT_MS);
  const headers: Record<string, string> = { ...buildAuthHeaders() };
  if (body) headers['Content-Type'] = 'application/json';
  return {
    method,
    credentials: 'include',
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
    ...(signal ? { signal } : {}),
  };
}

async function readServerList(base: string, deps: PhonePushDeps): Promise<PushTopic[] | { error: PhonePushError; status: number | null }> {
  try {
    const res = await deps.fetch(`${base}/notifications/subscriptions`, requestInit('GET'));
    if (!res.ok) return { error: res.status === 409 ? 'version-expired' : 'list-failed', status: res.status };
    return parseSubscriptionList(await res.json()) ?? { error: 'list-unreadable', status: res.status };
  } catch (error) {
    log.debug('phone push: list read failed', { error: String(error) });
    return { error: 'network', status: null };
  }
}

async function sendSteps(steps: Step[], base: string, made: Set<string>, playerId: string, result: PhonePushResult, deps: PhonePushDeps): Promise<void> {
  for (const [index, step] of steps.entries()) {
    if (index > 0) await deps.wait(REQUEST_GAP_MS);
    let status: number | null = null;
    try {
      const res = await deps.fetch(`${base}/notifications/${step.action}`, requestInit('POST', step.topic));
      status = res.status;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch (error) {
      log.debug('phone push: request failed', { action: step.action, status, error: String(error) });
      result.ok = false;
      result.error = status === 409 ? 'version-expired' : status === null ? 'network' : 'request-failed';
      result.failed = { action: step.action, topic: step.topic, status };
      return;
    }
    const key = topicKey(step.topic);
    const subscribed = step.action === 'subscribe';
    if (subscribed) made.add(key); else made.delete(key);
    (subscribed ? result.added : result.removed).push(step.topic);
    if (subscribed) result.pending.add = result.pending.add.filter((t) => topicKey(t) !== key);
    else result.pending.remove = result.pending.remove.filter((t) => topicKey(t) !== key);
    deps.writeMade(playerId, [...made]);
  }
}

async function sync(opts: PhonePushOptions, deps: PhonePushDeps): Promise<PhonePushResult> {
  const dryRun = opts.dryRun === true;
  const rules = await deps.loadRules();
  if (!rules) return emptyResult(dryRun, 'rules-unavailable');
  const playerId = deps.playerId();
  if (!playerId) return emptyResult(dryRun, 'no-player');
  const base = await deps.apiBase();
  if (!base) return emptyResult(dryRun, 'no-room');

  const pinned = mapPinsToTopics(opts.pins ?? deps.pins(), rules, deps.lookup);
  const night = mapNightStages(opts.nightStages ?? [], rules);
  const skipped = [...pinned.skipped, ...night.skipped];

  const server = await readServerList(base, deps);
  if (!Array.isArray(server)) {
    return { ...emptyResult(dryRun, server.error, skipped), failed: { action: 'list', topic: null, status: server.status } };
  }

  // A QPM-made topic the player removed in the app is forgotten, so it is never QPM's to remove later.
  const serverKeys = new Set(server.map(topicKey));
  const made = new Set(deps.readMade(playerId).filter((k) => serverKeys.has(k)));
  const plan = planPushSync([...pinned.topics, ...night.topics], server, made);
  const result: PhonePushResult = {
    ...emptyResult(dryRun, null, skipped),
    unchanged: plan.unchanged,
    pending: { add: [...plan.add], remove: [...plan.remove] },
  };
  if (dryRun) return result;

  deps.writeMade(playerId, [...made]);
  const steps: Step[] = [
    ...plan.add.map((topic): Step => ({ action: 'subscribe', topic })),
    ...plan.remove.map((topic): Step => ({ action: 'unsubscribe', topic })),
  ];
  await sendSteps(steps, base, made, playerId, result, deps);
  return result;
}

/** One sync per click; a second call while one runs returns `busy`. */
export async function runPhonePushSync(opts: PhonePushOptions = {}, deps: PhonePushDeps = realDeps): Promise<PhonePushResult> {
  if (inFlight) return emptyResult(opts.dryRun === true, 'busy');
  inFlight = true;
  try {
    return await sync(opts, deps);
  } finally {
    inFlight = false;
  }
}
