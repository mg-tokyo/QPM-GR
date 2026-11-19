// The game's phone-push rules (ALR-8 PD1/PD2), loaded on demand: the sync click or the debug call.
// Names the rules chunk imports (crystal list, building list, shop enum, weather enum) are followed
// into their exporter chunks. A piece that does not resolve makes only the topics that need it unreadable.

import { fetchBundleChunkText, fetchBundleHitContaining, markBundleConsumerDone, registerBundleConsumer } from './bundleParser';
import { findDefinition, findExportLocal, findImport, parsePushRulesChunk, PUSH_TOOL_RULE_MARKER } from './pushRulesParsing';
import type { ListRef, RawPushRules } from './pushRulesParsing';
import { createNamedLogger } from '../../diagnostics/logger';

export interface PushShopTopic {
  subject: string;
  itemType: string;           // the game's item-type member, e.g. "Seed", "Tool"
  onlyIds: string[] | null;   // null = no id allow-list
  excludeIds: string[];
  usesSilentShops: boolean;   // ids sold only in a silent shop get no push
  readable: boolean;          // false = a gate did not resolve; skip every pin of this topic
}

export interface PushListTopic {
  subject: string;
  ids: string[] | null;       // e.g. weather ids, night stages; null = unresolved
}

export interface PushRules {
  chunk: string;
  shopTopics: PushShopTopic[];
  silentShops: string[] | null;
  listTopics: PushListTopic[];
}

export interface PushRulesStatus {
  attempts: number;
  outcome: 'not-loaded' | 'loading' | 'marker-miss' | 'parse-failed' | 'partial' | 'resolved' | 'error';
  chunk: string | null;
}

type Chunk = { url: string; text: string };
type Resolved = { kind: 'list'; ids: string[] } | { kind: 'enum'; members: Record<string, string> };

const CONSUMER = 'push-rules';
const MAX_DEPTH = 4;
const log = createNamedLogger('catalogs');

let rules: PushRules | null = null;
let inFlight: Promise<PushRules | null> | null = null;
let attempts = 0;
let outcome: PushRulesStatus['outcome'] = 'not-loaded';
let lastChunk: string | null = null;

function createResolver(): {
  resolve: (chunk: Chunk, name: string, depth?: number) => Promise<Resolved | null>;
  resolveList: (chunk: Chunk, list: ListRef, depth?: number) => Promise<string[] | null>;
} {
  const texts = new Map<string, string | null>();
  const chunkText = async (url: string): Promise<string | null> => {
    if (!texts.has(url)) texts.set(url, await fetchBundleChunkText(url));
    return texts.get(url) ?? null;
  };

  const resolveList = async (chunk: Chunk, list: ListRef, depth = 0): Promise<string[] | null> => {
    const ids = [...list.literals];
    for (const spread of list.spreads) {
      const inner = await resolve(chunk, spread, depth + 1);
      if (inner?.kind !== 'list') return null;
      ids.push(...inner.ids);
    }
    return ids;
  };

  // An imported name is the module-scope binding, so the import wins over a nested `name=` lookalike.
  const resolve = async (chunk: Chunk, name: string, depth = 0): Promise<Resolved | null> => {
    if (depth > MAX_DEPTH) return null;
    const imp = findImport(chunk.text, name);
    if (imp) {
      let url: string;
      try { url = new URL(imp.from, chunk.url).href; } catch { return null; }
      const text = await chunkText(url);
      const local = text ? findExportLocal(text, imp.exported) : null;
      return text && local ? resolve({ url, text }, local, depth + 1) : null;
    }
    const def = findDefinition(chunk.text, name);
    if (!def) return null;
    if (def.kind === 'enum') return def;
    if (def.kind === 'call') return resolve(chunk, def.inner, depth + 1);
    const ids = await resolveList(chunk, def.list, depth);
    return ids ? { kind: 'list', ids } : null;
  };

  return { resolve, resolveList };
}

async function assemble(chunk: Chunk, raw: RawPushRules): Promise<PushRules> {
  const { resolve, resolveList } = createResolver();
  const toolIds = await resolveList(chunk, raw.toolList);

  let silentShops: string[] | null = [];
  for (const entry of raw.silentShops) {
    if (typeof entry === 'string') { silentShops.push(entry); continue; }
    const shopEnum = await resolve(chunk, entry.ref);
    const value = shopEnum?.kind === 'enum' ? shopEnum.members[entry.member] : undefined;
    if (!value) { silentShops = null; break; }
    silentShops.push(value);
  }

  const shopTopics: PushShopTopic[] = [];
  for (const t of raw.shopTopics) {
    const excluded = t.excludeRef ? await resolve(chunk, t.excludeRef) : null;
    const excludeOk = !t.excludeRef || excluded?.kind === 'list';
    shopTopics.push({
      subject: t.subject,
      itemType: t.itemType,
      onlyIds: t.usesToolList ? toolIds : null,
      excludeIds: excluded?.kind === 'list' ? excluded.ids : [],
      usesSilentShops: t.usesSilentShops,
      readable: !t.unknownGate && excludeOk && (!t.usesToolList || toolIds !== null) && (!t.usesSilentShops || silentShops !== null),
    });
  }

  const listTopics: PushListTopic[] = [];
  for (const t of raw.listTopics) {
    const r = await resolve(chunk, t.ref);
    const ids = r?.kind === 'list' ? r.ids : r?.kind === 'enum' ? Object.values(r.members) : null;
    listTopics.push({ subject: t.subject, ids });
  }

  return { chunk: chunk.url.split('/').pop() ?? chunk.url, shopTopics, silentShops, listTopics };
}

const isComplete = (r: PushRules): boolean =>
  r.silentShops !== null && r.shopTopics.every((t) => t.readable) && r.listTopics.every((t) => t.ids !== null);

/** Only a fully readable result is kept; a partial one is returned and the next call tries again. */
export function loadPushRules(): Promise<PushRules | null> {
  if (rules) return Promise.resolve(rules);
  if (inFlight) return inFlight;
  outcome = 'loading';
  inFlight = (async (): Promise<PushRules | null> => {
    registerBundleConsumer(CONSUMER);
    try {
      attempts += 1;
      const hit = await fetchBundleHitContaining(PUSH_TOOL_RULE_MARKER);
      if (!hit) { outcome = 'marker-miss'; return null; }
      lastChunk = hit.url.split('/').pop() ?? hit.url;
      const raw = parsePushRulesChunk(hit.text);
      if (!raw) { outcome = 'parse-failed'; return null; }
      const result = await assemble(hit, raw);
      if (isComplete(result)) { rules = result; outcome = 'resolved'; } else { outcome = 'partial'; }
      return result;
    } catch (error) {
      outcome = 'error';
      log.debug('push-rules: load failed', { error: String(error) });
      return null;
    } finally {
      markBundleConsumerDone(CONSUMER);
    }
  })().finally(() => { inFlight = null; });
  return inFlight;
}

export function getPushRulesStatus(): PushRulesStatus {
  return { attempts, outcome, chunk: lastChunk };
}
