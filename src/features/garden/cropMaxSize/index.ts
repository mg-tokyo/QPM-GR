import { onGardenSnapshot } from '../bridge';
import { walkPlantSlots } from '../slotWalk';
import { getJournal } from '../../journal/checker';
import {
  createSizeEdgeTracker,
  DEFAULT_CROP_MAX_SIZE_FILTER,
  edgeQualifies,
  isMaxWeightLogged,
  type CropMaxSizeFilter,
  type SizeEdge,
} from './core';
import { readCropMaxSizeAlertSettings, startCropMaxSizeAlarm, stopCropMaxSizeAlarm, writeCropMaxSizeAlertSettings } from './alarm';

export type { CropMaxSizeFilter, SizeEdge } from './core';
export { createSizeEdgeTracker, edgeQualifies, isMaxWeightLogged, MAX_CROP_SIZE, MAX_WEIGHT_VARIANT } from './core';
export { buildCropMaxSizePayload, CROP_MAX_SIZE_ROW, getCropMaxSizeAlarmState } from './alarm';

export interface CheckedSizeEdge extends SizeEdge {
  at: number;
  /** null when the journal could not be read at edge time. */
  journalLogged: boolean | null;
  qualifies: boolean;
}

type BatchListener = (batch: CheckedSizeEdge[]) => void;

const RECENT_LIMIT = 20;

const tracker = createSizeEdgeTracker();
const listeners = new Set<BatchListener>();
let unsubscribe: (() => void) | null = null;
let generation = 0;
let steps = 0;
let filter: CropMaxSizeFilter = DEFAULT_CROP_MAX_SIZE_FILTER;
let recent: CheckedSizeEdge[] = [];

async function checkBatch(edges: SizeEdge[], gen: number): Promise<void> {
  const needsJournal = filter.unloggedJournal && edges.some((e) => !filter.species.includes(e.species));
  const journal = needsJournal ? await getJournal().catch(() => null) : null;
  if (gen !== generation) return;
  const at = Date.now();
  const checked = edges.map((e): CheckedSizeEdge => ({
    ...e,
    at,
    journalLogged: journal ? isMaxWeightLogged(journal, e.species) : null,
    qualifies: edgeQualifies(e.species, filter, journal),
  }));
  recent = [...checked, ...recent].slice(0, RECENT_LIMIT);
  const batch = checked.filter((e) => e.qualifies);
  if (batch.length === 0) return;
  for (const cb of [...listeners]) {
    try { cb(batch); } catch { /* one listener must not break the others */ }
  }
}

export function startCropMaxSize(): void {
  if (unsubscribe) return;
  const gen = ++generation;
  filter = readCropMaxSizeAlertSettings();
  startCropMaxSizeAlarm(onCropMaxSizeBatch);
  unsubscribe = onGardenSnapshot((snapshot) => {
    // A null garden is a gap in the feed, not an empty garden; keep the baseline across it.
    if (!snapshot || gen !== generation) return;
    const edges = tracker.step(walkPlantSlots(snapshot));
    steps += 1;
    if (edges.length > 0) void checkBatch(edges, gen);
  });
}

export function stopCropMaxSize(): void {
  generation += 1;
  stopCropMaxSizeAlarm();
  unsubscribe?.();
  unsubscribe = null;
  tracker.reset();
  steps = 0;
  recent = [];
}

/** Batches hold only qualifying edges from one garden snapshot. */
export function onCropMaxSizeBatch(cb: BatchListener): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}

/** Stored in `qpm.cropMaxSizeAlert.v1`; the next batch uses it. */
export function setCropMaxSizeFilter(next: CropMaxSizeFilter): void {
  filter = { unloggedJournal: next.unloggedJournal, species: [...next.species] };
  writeCropMaxSizeAlertSettings(filter);
}

export function getCropMaxSizeFilter(): CropMaxSizeFilter {
  return { unloggedJournal: filter.unloggedJournal, species: [...filter.species] };
}

/** Newest first, qualifying or not. */
export function getRecentSizeEdges(): CheckedSizeEdge[] {
  return recent.map((e) => ({ ...e }));
}

export function getCropMaxSizeState(): { running: boolean; steps: number; filter: CropMaxSizeFilter; listeners: number } {
  return { running: unsubscribe !== null, steps, filter: getCropMaxSizeFilter(), listeners: listeners.size };
}
