// ALR-15.2: one hub card for crops that reached max size (PD2: count and names updated in place).

import { t } from '../../../i18n';
import { getCropSpriteDataUrlWithMutations, isSpritesReady } from '../../../sprite-v2/compat';
import { getPlantSafe } from '../../../utils/game/catalogHelpers';
import { storage } from '../../../utils/storage';
import { isRecord } from '../../../utils/typeGuards';
import {
  isAlertCardOpen,
  raiseAlert,
  registerAlertRow,
  type AlertChip,
  type AlertPayload,
  type AlertSprite,
} from '../../alertHub';
import { DEFAULT_CROP_MAX_SIZE_FILTER, type CropMaxSizeFilter, type SizeEdge } from './core';

export const CROP_MAX_SIZE_ROW = 'garden.cropMaxSize';
const SETTINGS_KEY = 'qpm.cropMaxSizeAlert.v1';
const CARD_KEY = 'cropMaxSize';

export function readCropMaxSizeAlertSettings(): CropMaxSizeFilter {
  const raw = storage.get<unknown>(SETTINGS_KEY, null);
  const r = isRecord(raw) ? raw : {};
  return {
    unloggedJournal: typeof r.unloggedJournal === 'boolean' ? r.unloggedJournal : DEFAULT_CROP_MAX_SIZE_FILTER.unloggedJournal,
    species: Array.isArray(r.species) ? r.species.filter((s): s is string => typeof s === 'string' && s.length > 0) : [],
  };
}

export function writeCropMaxSizeAlertSettings(next: CropMaxSizeFilter): void {
  storage.set(SETTINGS_KEY, { unloggedJournal: next.unloggedJournal, species: [...next.species] });
}

const cropName = (species: string): string => getPlantSafe(species)?.crop.name ?? species;

function cropSprite(edge: SizeEdge): string | undefined {
  if (!isSpritesReady()) return undefined;
  return getCropSpriteDataUrlWithMutations(edge.species, edge.mutations) || undefined;
}

/** Species in the order they reached max, each with its first crop and how many. */
function groupBySpecies(edges: readonly SizeEdge[]): Array<{ first: SizeEdge; count: number }> {
  const groups = new Map<string, { first: SizeEdge; count: number }>();
  for (const e of edges) {
    const g = groups.get(e.species);
    if (g) g.count += 1;
    else groups.set(e.species, { first: e, count: 1 });
  }
  return [...groups.values()];
}

const named = (species: string, count: number): string =>
  count > 1 ? t('feature.cropMaxSize.nameCount', { name: cropName(species), count }) : cropName(species);

export function buildCropMaxSizePayload(edges: readonly SizeEdge[]): AlertPayload {
  const groups = groupBySpecies(edges);
  const sprites: AlertSprite[] = [];
  const chips: AlertChip[] = [];
  for (const g of groups) {
    const url = cropSprite(g.first);
    if (url) sprites.push({ url, ...(g.count > 1 ? { count: g.count } : {}) });
    chips.push({ text: named(g.first.species, g.count), ...(url ? { iconUrl: url } : {}) });
  }
  const icon = sprites[0]?.url;
  return {
    title: t('feature.cropMaxSize.title'),
    body: groups.map((g) => named(g.first.species, g.count)).join(' · '),
    cardKey: CARD_KEY,
    level: 'success',
    chips,
    figure: { value: String(edges.length), label: t('feature.cropMaxSize.figure') },
    ...(sprites.length > 1 ? { sprites } : {}),
    ...(icon ? { iconUrl: icon } : {}),
  };
}

const onCard = new Map<string, SizeEdge>();
let lastEdge: SizeEdge | null = null;
let stopBatches: (() => void) | null = null;
const counts = { batches: 0, raised: 0 };

function onBatch(batch: readonly SizeEdge[]): void {
  counts.batches += 1;
  if (!isAlertCardOpen(CARD_KEY)) onCard.clear();
  for (const e of batch) onCard.set(`${e.tileKey}#${e.slotId}`, e);
  lastEdge = batch[0] ?? lastEdge;
  const card = raiseAlert(CROP_MAX_SIZE_ROW, buildCropMaxSizePayload([...onCard.values()]));
  if (card) counts.raised += 1;
  else onCard.clear();
}

// Lazy so the alarm core never loads window code.
function openCropMaxSizeSettings(): void {
  void import('../../../ui/garden/cropMaxSizeWindow').then((m) => { m.openCropMaxSizeWindow(); });
}

/** Started and stopped by the size-edge core (index.ts), which hands over its batch feed. */
export function startCropMaxSizeAlarm(subscribeBatches: (cb: (batch: SizeEdge[]) => void) => () => void): void {
  if (stopBatches) return;
  registerAlertRow({
    id: CROP_MAX_SIZE_ROW,
    group: 'garden',
    labelKey: 'feature.cropMaxSize.row',
    defaultSound: 'chime',
    settingsAction: openCropMaxSizeSettings,
    icon: () => (lastEdge ? cropSprite(lastEdge) ?? null : null),
    summary: () => {
      const s = readCropMaxSizeAlertSettings();
      if (s.unloggedJournal && s.species.length > 0) return t('feature.cropMaxSize.summaryBoth', { count: s.species.length });
      if (s.unloggedJournal) return t('feature.cropMaxSize.summaryJournal');
      return t('feature.cropMaxSize.summaryPicked', { count: s.species.length });
    },
  });
  stopBatches = subscribeBatches(onBatch);
}

export function stopCropMaxSizeAlarm(): void {
  stopBatches?.();
  stopBatches = null;
  onCard.clear();
}

export function getCropMaxSizeAlarmState(): { started: boolean; cardOpen: boolean; onCard: string[]; batches: number; raised: number } {
  return { started: stopBatches !== null, cardOpen: isAlertCardOpen(CARD_KEY), onCard: [...onCard.keys()], ...counts };
}
