// Watched journal seeds (ALR-16.3): fed by the restock module's myData subscription
// (restockAlerts/index.ts) plus weather and rare-pair changes. No subscription of its own to myData.

import { getAllPlantSpecies, getMutationCatalog } from '../../catalogs/gameCatalogs';
import { getRarePatchPairs, onRarePatchPairsChange } from '../../catalogs/logic/rarePatchPairsCatalog';
import { getWeatherSnapshot, onWeatherSnapshot } from '../../store/weatherHub';
import { resolveWeatherMutationEntry } from '../garden/cropMutationAnalytics';
import { normalizeJournal } from '../journal/checker';
import { computeWatchedSeeds, countOwnedSeeds, type WatchedSeed } from './core';

export { computeWatchedSeeds, countOwnedSeeds } from './core';
export type { WatchedSeed, WatchedSeedsInput } from './core';

interface Inputs {
  journal: unknown;
  inventory: unknown;
  garden: unknown;
  mutationCatalog: unknown;
  speciesCount: number;
  pairsResolved: boolean;
  weatherMutation: string | null;
}

const listeners = new Set<(seeds: readonly WatchedSeed[]) => void>();
const cleanups: Array<() => void> = [];
let started = false;
let myData: Record<string, unknown> | null = null;
let lastInputs: Inputs | null = null;
let watched: WatchedSeed[] = [];
let signature = '';
const counts = { ingests: 0, computes: 0, changes: 0 };

const currentWeatherMutation = (): string | null => {
  const kind = getWeatherSnapshot().kind;
  return kind === 'unknown' ? null : resolveWeatherMutationEntry(kind).mutation;
};

function recompute(): void {
  if (!started || !myData) return;
  const species = getAllPlantSpecies();
  const inputs: Inputs = {
    journal: myData.journal,
    inventory: myData.inventory,
    garden: myData.garden,
    mutationCatalog: getMutationCatalog(),
    speciesCount: species.length,
    pairsResolved: getRarePatchPairs() !== null,
    weatherMutation: currentWeatherMutation(),
  };
  const prev = lastInputs;
  if (prev && (Object.keys(inputs) as Array<keyof Inputs>).every((k) => prev[k] === inputs[k])) return;
  lastInputs = inputs;
  if (species.length === 0 || !inputs.journal || typeof inputs.journal !== 'object') return;
  counts.computes += 1;
  const next = computeWatchedSeeds({
    journal: normalizeJournal(inputs.journal),
    species,
    owned: countOwnedSeeds(myData),
    pairs: getRarePatchPairs(),
    weatherMutation: inputs.weatherMutation,
  });
  const nextSignature = JSON.stringify(next);
  if (nextSignature === signature) return;
  signature = nextSignature;
  watched = next;
  counts.changes += 1;
  for (const cb of Array.from(listeners)) {
    try { cb(watched); } catch { /* one listener failing must not stop the others */ }
  }
}

/** Called with every myData value the restock module receives. */
export function ingestJournalSeedsMyData(value: unknown): void {
  myData = typeof value === 'object' && value !== null ? value as Record<string, unknown> : null;
  counts.ingests += 1;
  recompute();
}

export function startJournalSeeds(): void {
  if (started) return;
  started = true;
  cleanups.push(onWeatherSnapshot(() => recompute(), false));
  cleanups.push(onRarePatchPairsChange(() => recompute()));
  recompute();
}

export function stopJournalSeeds(): void {
  started = false;
  while (cleanups.length > 0) cleanups.pop()?.();
  lastInputs = null;
}

export function getWatchedSeeds(): readonly WatchedSeed[] {
  return watched;
}

export function onWatchedSeedsChange(cb: (seeds: readonly WatchedSeed[]) => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

export function getJournalSeedsState(): Record<string, unknown> {
  return {
    started,
    myDataSeen: myData !== null,
    pairsResolved: getRarePatchPairs() !== null,
    weatherKind: getWeatherSnapshot().kind,
    weatherMutation: currentWeatherMutation(),
    ...counts,
    count: watched.length,
    watched,
  };
}
