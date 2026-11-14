// Mutation combination rules as a catalog part (ALR-5 Task 1). No persistence: null until parsed.
// Exclusivity always comes from the mutation catalog `group`; when the parse is absent, consumers
// fall back to that group-only rule (ALR-5 PD1) and the drift says so.

import { fetchBundleHitContaining, getMarkerMissCount, markBundleConsumerDone, onNewBundleChunk, registerBundleConsumer } from './bundleParser';
import { MUTATION_RULES_MARKER, parseMutationRules } from './mutationRulesParsing';
import type { MutationRule, ParsedMutationRules } from './mutationRulesParsing';
import { createNamedLogger } from '../../diagnostics/logger';

export type { MutationRule } from './mutationRulesParsing';

export interface MutationRulesStatus {
  started: boolean;
  resolved: boolean;
  chunk: string | null;
  attempts: number;
  parseFailures: number;
  markerMisses: number;
  chunkRetryActive: boolean;
}

export interface MutationRulesDrift extends MutationRulesStatus {
  parsedIds: string[];
  unparsedCases: string[];
  catalogIdsWithoutCase: string[];
  caseIdsNotInCatalog: string[];
  catalogIdsWithoutGroup: string[];
  groups: Record<string, string>;
  fallback: 'group-only' | null;
}

const CONSUMER = 'mutation-rules';
const log = createNamedLogger('catalogs');

let parsed: ParsedMutationRules | null = null;
let chunk: string | null = null;
let attempts = 0;
let parseFailures = 0;
let started = false;
let inFlight: Promise<void> | null = null;
let rerun = false;
let chunkRetry: (() => void) | null = null;
const listeners = new Set<() => void>();

function releaseChunkRetry(): void {
  if (chunkRetry) { chunkRetry(); chunkRetry = null; }
}

function emitChange(): void {
  for (const cb of Array.from(listeners)) {
    try { cb(); } catch (error) { log.debug('mutationRules: listener threw', { error: String(error) }); }
  }
}

// A call during an in-flight load reruns once after it, so a chunk that landed mid-scan is still tried.
function loadMissing(): Promise<void> {
  if (inFlight) { rerun = true; return inFlight; }
  inFlight = (async () => {
    if (parsed) return;
    registerBundleConsumer(CONSUMER);
    try {
      attempts += 1;
      const hit = await fetchBundleHitContaining(MUTATION_RULES_MARKER);
      if (!hit) return;
      const value = parseMutationRules(hit.text);
      if (!value) { parseFailures += 1; return; }
      parsed = value;
      chunk = hit.url.split('/').pop() ?? hit.url;
      releaseChunkRetry();
      emitChange();
    } catch (error) {
      log.debug('mutationRules: load failed', { error: String(error) });
    } finally {
      markBundleConsumerDone(CONSUMER);
    }
  })().finally(() => {
    inFlight = null;
    const again = rerun && started && !parsed;
    rerun = false;
    if (again) void loadMissing();
  });
  return inFlight;
}

export function startMutationRulesSource(): void {
  if (started) return;
  started = true;
  if (!parsed) chunkRetry = onNewBundleChunk(() => { void loadMissing(); });
  void loadMissing();
}

export function stopMutationRulesSource(): void {
  started = false;
  rerun = false;
  releaseChunkRetry();
}

/** The game's rule for this mutation, or null when the parse is absent or has no case for it. */
export function getMutationRule(id: string): MutationRule | null {
  return parsed?.rules[id] ?? null;
}

export function hasMutationRules(): boolean {
  return parsed !== null;
}

/** Fires once when the rules resolve. */
export function onMutationRulesChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getMutationRulesStatus(): MutationRulesStatus {
  return {
    started,
    resolved: parsed !== null,
    chunk,
    attempts,
    parseFailures,
    markerMisses: getMarkerMissCount(MUTATION_RULES_MARKER),
    chunkRetryActive: chunkRetry !== null,
  };
}

/** Parsed cases against the mutation catalog (passed in: catalogs/logic does not read gameCatalogs). */
export function getMutationRulesDrift(catalog: Readonly<Record<string, Readonly<Record<string, unknown>>>> | null): MutationRulesDrift {
  const parsedIds = parsed ? Object.keys(parsed.rules) : [];
  const caseIds = new Set([...parsedIds, ...(parsed?.unparsed ?? [])]);
  const catalogIds = catalog ? Object.keys(catalog) : [];
  const groups: Record<string, string> = {};
  for (const id of catalogIds) {
    const group = catalog?.[id]?.group;
    if (typeof group === 'string') groups[id] = group;
  }
  return {
    ...getMutationRulesStatus(),
    parsedIds,
    unparsedCases: parsed ? [...parsed.unparsed] : [],
    catalogIdsWithoutCase: parsed ? catalogIds.filter((id) => !caseIds.has(id)) : [],
    caseIdsNotInCatalog: catalog ? [...caseIds].filter((id) => !catalogIds.includes(id)) : [],
    catalogIdsWithoutGroup: catalogIds.filter((id) => groups[id] === undefined),
    groups,
    fallback: parsed ? null : 'group-only',
  };
}
