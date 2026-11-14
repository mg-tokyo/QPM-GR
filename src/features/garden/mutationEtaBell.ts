// Mutation done bell (ALR-5.5): one alert when "remaining" for a belled mutation reaches 0.
import { getGardenSnapshot, onGardenSnapshot } from './bridge';
import { countActionableFruits, extractTiles, tileFruitCount } from './gardenTiles';
import { findVariantBadge } from '../mutations/data/variantBadges';
import { getAnySpriteDataUrl, isSpritesReady } from '../../sprite-v2/compat';
import { getMutationName } from '../../utils/game/catalogHelpers';
import { storage } from '../../utils/storage';
import { isRecord } from '../../utils/typeGuards';
import { t } from '../../i18n';
import { raiseAlert, registerAlertRow, setAlertRowEnabled } from '../alertHub';

export const MUTATION_DONE_ROW = 'garden.mutationDone';
export const MUTATION_ETA_KEY = 'qpm.mutationEta.v1';

export interface MutationBellState {
  remaining: number | null;   // null until the first reading (a baseline, never an alert)
  totalFruit: number;
}

/**
 * PD2: only a drop that comes with a mutation gain rings. A harvest takes fruit out of the
 * garden, so a step whose total fruit fell is treated as a harvest and stays silent.
 */
export function stepMutationBell(state: MutationBellState, remaining: number, totalFruit: number): boolean {
  const fire = state.remaining !== null && state.remaining > 0 && remaining === 0 && totalFruit >= state.totalFruit;
  state.remaining = remaining;
  state.totalFruit = totalFruit;
  return fire;
}

export function getBelledMutations(): string[] {
  const raw = storage.get<unknown>(MUTATION_ETA_KEY, null);
  const bells = isRecord(raw) ? raw.bells : undefined;
  return isRecord(bells) ? Object.keys(bells).filter((k) => bells[k] === true) : [];
}

const bellListeners = new Set<() => void>();

export function onMutationBellsChange(cb: () => void): () => void {
  bellListeners.add(cb);
  return () => { bellListeners.delete(cb); };
}

/** Turning a bell on also switches the centre row on: new alerts default to off (ALR-9 PD1). */
export function setMutationBell(mutation: string, on: boolean): void {
  const bells: Record<string, true> = {};
  for (const m of getBelledMutations()) if (m !== mutation) bells[m] = true;
  if (on) bells[mutation] = true;
  storage.set(MUTATION_ETA_KEY, { bells });
  if (on) setAlertRowEnabled(MUTATION_DONE_ROW, true);
  for (const cb of [...bellListeners]) {
    try { cb(); } catch { /* one listener must not stop the rest */ }
  }
}

let started = false;
let cleanups: Array<() => void> = [];
const states = new Map<string, MutationBellState>();
const counts = { fired: 0, evaluations: 0 };

function mutationIconUrl(mutation: string): string | undefined {
  if (!isSpritesReady()) return undefined;
  return getAnySpriteDataUrl(findVariantBadge(mutation)?.iconKey) || undefined;
}

function fire(mutation: string): void {
  counts.fired += 1;
  const iconUrl = mutationIconUrl(mutation);
  raiseAlert(MUTATION_DONE_ROW, {
    title: t('feature.mutationEta.bellTitle', { mutation: getMutationName(mutation) }),
    body: t('feature.mutationEta.bellBody'),
    cardKey: `mutationDone:${mutation}`,
    ...(iconUrl ? { iconUrl } : {}),
  });
}

function evaluate(): void {
  const belled = getBelledMutations();
  for (const m of [...states.keys()]) if (!belled.includes(m)) states.delete(m);
  if (!started || belled.length === 0) return;
  counts.evaluations += 1;
  const tiles = extractTiles(getGardenSnapshot());
  const totalFruit = tiles.reduce((s, tile) => s + tileFruitCount(tile), 0);
  for (const mutation of belled) {
    const state = states.get(mutation) ?? { remaining: null, totalFruit: 0 };
    states.set(mutation, state);
    if (stepMutationBell(state, countActionableFruits(tiles, [mutation]), totalFruit)) fire(mutation);
  }
}

export function startMutationEtaBell(): void {
  if (started) return;
  started = true;
  registerAlertRow({ id: MUTATION_DONE_ROW, group: 'garden', labelKey: 'feature.mutationEta.bellRow', defaultSound: 'chime' });
  cleanups = [onGardenSnapshot(evaluate, false), onMutationBellsChange(evaluate)];
  evaluate();
}

export function stopMutationEtaBell(): void {
  if (!started) return;
  started = false;
  for (const off of cleanups.splice(0)) off();
  states.clear();
}

export function getMutationEtaBellState(): {
  started: boolean;
  bells: string[];
  states: Record<string, MutationBellState>;
  fired: number;
  evaluations: number;
} {
  return { started, bells: getBelledMutations(), states: Object.fromEntries(states), ...counts };
}
