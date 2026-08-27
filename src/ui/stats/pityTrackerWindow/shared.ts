import {
  getEggSafe as getEggType,
  getItemSafe as getItem,
  getPlantSafe as getPlantSpecies,
} from '../../../utils/game/catalogHelpers';
import {
  estimatePityCount,
  getPityOutcomes,
  getPityProximity,
  pityCounterKey,
  type PityKind,
  type PityOutcome,
  type PityProximity,
} from '../../../catalogs/pityThresholds';
import { pityGapFor, type PityCounter, type PityTrackerState } from '../../../store/pityTracker';
import { getAnySpriteDataUrl, getProduceSpriteDataUrlWithMutations } from '../../../sprite-v2/compat';
import { RAINBOW_GRADIENT } from '../statsHubWindow/constants';

export interface PityRowModel {
  kind: PityKind;
  id: string;
  name: string;
  spriteUrl: string;
  outcomes: PityOutcome[];
  observed: boolean;
  /** Highest estimate/threshold ratio across outcomes; drives Tracking order. */
  progress: number;
}

export const PROXIMITY_RANK: Readonly<Record<PityProximity, number>> = { far: 0, close: 1, imminent: 2, due: 3 };

export function titleCase(id: string): string {
  return id.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function stringField(entry: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = entry?.[key];
  return typeof value === 'string' && value ? value : null;
}

export function itemName(kind: PityKind, id: string): string {
  if (kind === 'egg') return stringField(getEggType(id), 'name') ?? titleCase(id);
  if (kind === 'capsule') return stringField(getItem(id), 'name') ?? titleCase(id);
  const plant = getPlantSpecies(id);
  const seed = plant?.seed as Record<string, unknown> | undefined;
  return stringField(seed, 'name') ?? stringField(plant, 'name') ?? titleCase(id);
}

export function cropName(species: string): string {
  const crop = getPlantSpecies(species)?.crop as Record<string, unknown> | undefined;
  return stringField(crop, 'name') ?? titleCase(species);
}

export function outcomeName(outcome: Pick<PityOutcome, 'roll' | 'outcomeId'>): string {
  return outcome.roll === 'variant' ? cropName(outcome.outcomeId) : titleCase(outcome.outcomeId);
}

export function spriteUrl(kind: PityKind, id: string): string {
  try {
    if (kind === 'egg') return getAnySpriteDataUrl(stringField(getEggType(id), 'sprite') ?? `sprite/pet/${id}`);
    if (kind === 'capsule') return getAnySpriteDataUrl(stringField(getItem(id), 'sprite') ?? `sprite/item/${id}`);
    const seed = getPlantSpecies(id)?.seed as Record<string, unknown> | undefined;
    const seedSprite = stringField(seed, 'sprite');
    return (seedSprite ? getAnySpriteDataUrl(seedSprite) : '') || getProduceSpriteDataUrlWithMutations(id, []);
  } catch {
    return '';
  }
}

export function formatChance(chance: number): string {
  return `${(chance * 100).toLocaleString(undefined, { maximumFractionDigits: 3 })}%`;
}

export function proximityColor(proximity: PityProximity): string | null {
  if (proximity === 'due' || proximity === 'imminent') return 'var(--qpm-positive)';
  if (proximity === 'close') return 'var(--qpm-warning)';
  return null;
}

/** Fill colour identifies the outcome (rainbow / gold) until the guarantee is due, then it goes positive. */
export function fillStyle(outcome: PityOutcome, proximity: PityProximity): { color?: string; gradient?: string } {
  if (proximity === 'due') return { color: 'var(--qpm-positive)' };
  if (outcome.outcomeId === 'Rainbow') return { gradient: RAINBOW_GRADIENT };
  if (outcome.outcomeId === 'Gold') return { color: 'var(--qpm-gold)' };
  return { color: 'var(--qpm-positive)' };
}

export function isObserved(counter: PityCounter | null | undefined): counter is PityCounter {
  return !!counter && counter.totalPulls > 0;
}

export interface OutcomeProgress {
  counter: PityCounter | null;
  observed: boolean;
  estimate: number;
  proximity: PityProximity;
  /** Unobserved pulls of this kind since the counter's last reset — >0 means the estimate is approximate. */
  gap: number;
  /** A miss past the threshold pulled the estimate down. */
  corrected: boolean;
}

export function outcomeProgress(row: Pick<PityRowModel, 'kind' | 'id'>, outcome: PityOutcome, state: PityTrackerState): OutcomeProgress {
  const counter = state.counters[pityCounterKey(row.kind, row.id, outcome.outcomeId)] ?? null;
  if (!isObserved(counter)) return { counter, observed: false, estimate: 0, proximity: 'far', gap: 0, corrected: false };
  const estimate = estimatePityCount(counter, outcome.thresholdPulls, state.account?.createdAt ?? null);
  return {
    counter,
    observed: true,
    estimate,
    proximity: getPityProximity(estimate, outcome.thresholdPulls),
    gap: pityGapFor(state, row.kind, counter),
    corrected: counter.correction < 0,
  };
}

export function makeSpriteEl(url: string, size: number): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = `width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;flex-shrink:0;`;
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.style.cssText = `width:${size}px;height:${size}px;object-fit:contain;display:block;`;
    wrap.appendChild(img);
  }
  return wrap;
}

export function buildRows(kind: PityKind, ids: string[], state: PityTrackerState): PityRowModel[] {
  const rows: PityRowModel[] = [];
  for (const id of ids) {
    const outcomes = getPityOutcomes({ kind, id });
    if (outcomes.length === 0) continue;
    let observed = false;
    let progress = 0;
    for (const outcome of outcomes) {
      const p = outcomeProgress({ kind, id }, outcome, state);
      if (!p.observed) continue;
      observed = true;
      progress = Math.max(progress, p.estimate / outcome.thresholdPulls);
    }
    rows.push({ kind, id, name: itemName(kind, id), spriteUrl: spriteUrl(kind, id), outcomes, observed, progress });
  }
  return rows;
}
