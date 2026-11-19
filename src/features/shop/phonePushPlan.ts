// Pure half of the phone-push sync (ALR-8.2b): QPM pins → the game's push topics, and the
// add/remove plan against the server list. Only topics QPM recorded as its own are ever removed.

import type { PushRules } from '../../catalogs/logic/pushRulesCatalog';
import type { ShopCatalogKind } from '../../catalogs/shopEligibility';

export interface PushTopic { subject: string; itemId: string }

export type PushSkipReason = 'not-offered' | 'rules-unreadable' | 'unknown-item';
export interface PushSkipped { pin: string; reason: PushSkipReason }

export interface PinLookup {
  canonical(shopType: string, itemId: string): string;
  kindOf(itemId: string): ShopCatalogKind | null;
  eligibleShops(itemId: string): string[];
}

export interface PushPlan { add: PushTopic[]; remove: PushTopic[]; unchanged: number }

// Topic subjects are wire identifiers (beta common/notifications/notification-topics.ts:44-60).
const WEATHER_SUBJECT = 'QuinoaWeatherActive';
const NIGHT_SUBJECT = 'QuinoaDayNightPhase';
// QPM catalog kind → the game's item-type member the shop topic names (8.2a `itemType`).
const ITEM_TYPE_BY_KIND: Record<ShopCatalogKind, string> = { plant: 'Seed', egg: 'Egg', item: 'Tool', decor: 'Decor' };

export const topicKey = (t: PushTopic): string => `${t.subject}|${t.itemId}`;

function mapListPin(pin: string, id: string, subject: string, rules: PushRules): PushTopic | PushSkipped {
  const ids = rules.listTopics.find((t) => t.subject === subject)?.ids ?? null;
  if (!ids) return { pin, reason: 'rules-unreadable' };
  const match = ids.find((x) => x.toLowerCase() === id.toLowerCase());
  return match ? { subject, itemId: match } : { pin, reason: 'not-offered' };
}

function mapShopPin(pin: string, shopType: string, rawId: string, rules: PushRules, lookup: PinLookup): PushTopic | PushSkipped {
  const itemId = lookup.canonical(shopType, rawId);
  const kind = lookup.kindOf(itemId);
  if (!kind) return { pin, reason: 'unknown-item' };
  const topic = rules.shopTopics.find((t) => t.itemType === ITEM_TYPE_BY_KIND[kind]);
  if (!topic) return { pin, reason: 'not-offered' };
  if (!topic.readable) return { pin, reason: 'rules-unreadable' };
  if (topic.onlyIds && !topic.onlyIds.includes(itemId)) return { pin, reason: 'not-offered' };
  if (topic.excludeIds.includes(itemId)) return { pin, reason: 'not-offered' };
  if (topic.usesSilentShops) {
    const silent = rules.silentShops ?? [];
    if (!lookup.eligibleShops(itemId).some((shop) => !silent.includes(shop))) return { pin, reason: 'not-offered' };
  }
  return { subject: topic.subject, itemId };
}

export function mapPinsToTopics(
  pins: Iterable<string>,
  rules: PushRules,
  lookup: PinLookup,
): { topics: PushTopic[]; skipped: PushSkipped[] } {
  const topics = new Map<string, PushTopic>();
  const skipped: PushSkipped[] = [];
  for (const pin of pins) {
    const sep = pin.indexOf(':');
    const shopType = sep > 0 ? pin.slice(0, sep) : '';
    const id = sep > 0 ? pin.slice(sep + 1) : '';
    if (!shopType || !id) { skipped.push({ pin, reason: 'unknown-item' }); continue; }
    const out = shopType === 'weather'
      ? mapListPin(pin, id, WEATHER_SUBJECT, rules)
      : mapShopPin(pin, shopType, id, rules, lookup);
    if ('reason' in out) skipped.push(out);
    else topics.set(topicKey(out), out);
  }
  return { topics: [...topics.values()], skipped };
}

export function mapNightStages(stages: readonly string[], rules: PushRules): { topics: PushTopic[]; skipped: PushSkipped[] } {
  const topics = new Map<string, PushTopic>();
  const skipped: PushSkipped[] = [];
  for (const stage of stages) {
    const out = mapListPin(`night:${stage}`, stage, NIGHT_SUBJECT, rules);
    if ('reason' in out) skipped.push(out);
    else topics.set(topicKey(out), out);
  }
  return { topics: [...topics.values()], skipped };
}

/** Add what is wanted and missing; remove only QPM-made topics that are no longer wanted. */
export function planPushSync(desired: readonly PushTopic[], server: readonly PushTopic[], made: ReadonlySet<string>): PushPlan {
  const serverKeys = new Set(server.map(topicKey));
  const desiredKeys = new Set(desired.map(topicKey));
  const add = desired.filter((t) => !serverKeys.has(topicKey(t)));
  const remove = server.filter((t) => made.has(topicKey(t)) && !desiredKeys.has(topicKey(t)));
  return { add, remove, unchanged: desired.length - add.length };
}

/** Beta `client/src/notifications/subscriptions.ts:10-12`: `{ subscriptions: [{subject,itemId}] }`. */
export function parseSubscriptionList(body: unknown): PushTopic[] | null {
  const list = body && typeof body === 'object' ? (body as { subscriptions?: unknown }).subscriptions : undefined;
  if (!Array.isArray(list)) return null;
  const out: PushTopic[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const { subject, itemId } = entry as Record<string, unknown>;
    if (typeof subject === 'string' && typeof itemId === 'string') out.push({ subject, itemId });
  }
  return out;
}
