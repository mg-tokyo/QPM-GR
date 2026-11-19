// ALR-6.2: one hub card per gained mutation that keeps counting while open (PD1). Only the raise
// that opens a card chimes and writes History; later gains update the open card silently.

import { t } from '../../../i18n';
import { getAnySpriteDataUrl, getCropSpriteDataUrlWithMutations, isSpritesReady } from '../../../sprite-v2/compat';
import { getMutationName, getMutationsSafe, getPlantSafe } from '../../../utils/game/catalogHelpers';
import { storage } from '../../../utils/storage';
import { isRecord } from '../../../utils/typeGuards';
import { findVariantBadge } from '../../mutations/data/variantBadges';
import { setStatsHubTileOverride } from '../filters';
import {
  isAlertCardOpen,
  raiseAlert,
  registerAlertRow,
  type AlertCardHandle,
  type AlertCardPatch,
  type AlertChip,
  type AlertPayload,
  type AlertSprite,
} from '../../alertHub';
import type { MutationGain } from './diff';
import { getPanState, panToTile, releasePan } from './pan';

export const MUTATION_GAIN_ROW = 'garden.mutationGain';
const SETTINGS_KEY = 'qpm.mutationGainAlert.v1';
// Intake (user, 2026-11-12): Gold and Rainbow are on once the alert is; kept only if the catalog lists them.
const DEFAULT_MUTATIONS = ['Gold', 'Rainbow'];

const cardKeyOf = (mutation: string): string => `mutationGain:${mutation}`;

/** The stored pick, or the defaults the live catalog knows (none while the catalog is absent). */
export function getWatchedMutations(): string[] {
  const raw = storage.get<unknown>(SETTINGS_KEY, null);
  if (isRecord(raw) && Array.isArray(raw.mutations)) {
    return raw.mutations.filter((m): m is string => typeof m === 'string' && m.length > 0);
  }
  const known = getMutationsSafe();
  return DEFAULT_MUTATIONS.filter((m) => known.includes(m));
}

export function setWatchedMutations(mutations: readonly string[]): void {
  storage.set(SETTINGS_KEY, { mutations: [...new Set(mutations)] });
}

interface CardState {
  gains: MutationGain[];
  seen: Set<string>;
  index: number;
  cycling: boolean;
  handle: AlertCardHandle | null;
}

const cards = new Map<string, CardState>();
let spotlit: string | null = null;
let started = false;
const counts = { batches: 0, opened: 0, updated: 0 };

const cropName = (species: string): string => getPlantSafe(species)?.crop.name ?? species;
const tileOf = (tileKey: string): string => tileKey.slice(tileKey.indexOf(':') + 1);

function cropSprite(g: MutationGain): string | undefined {
  if (!isSpritesReady()) return undefined;
  return getCropSpriteDataUrlWithMutations(g.species, g.mutations) || undefined;
}

export function mutationIcon(mutation: string): string | undefined {
  if (!isSpritesReady()) return undefined;
  return getAnySpriteDataUrl(findVariantBadge(mutation)?.iconKey) || undefined;
}

// Solid only: a gradient (Rainbow) is not a valid border colour.
export const mutationColor = (mutation: string): string | undefined => findVariantBadge(mutation)?.color;

function groupBySpecies(gains: readonly MutationGain[]): Array<{ first: MutationGain; count: number }> {
  const groups = new Map<string, { first: MutationGain; count: number }>();
  for (const g of gains) {
    const group = groups.get(g.species);
    if (group) group.count += 1;
    else groups.set(g.species, { first: g, count: 1 });
  }
  return [...groups.values()];
}

function bodyOf(st: CardState): string {
  const shown = st.gains[st.index];
  if (st.cycling && shown) {
    return t('feature.mutationGain.showing', { index: st.index + 1, count: st.gains.length, crop: cropName(shown.species), tile: tileOf(shown.tileKey) });
  }
  const only = st.gains.length === 1 ? st.gains[0] : undefined;
  if (only) return t('feature.mutationGain.oneCrop', { crop: cropName(only.species), tile: tileOf(only.tileKey) });
  return groupBySpecies(st.gains)
    .map((g) => (g.count > 1 ? t('feature.mutationGain.nameCount', { name: cropName(g.first.species), count: g.count }) : cropName(g.first.species)))
    .join(' · ');
}

function chipOf(mutation: string): AlertChip {
  const color = mutationColor(mutation);
  const iconUrl = mutationIcon(mutation);
  return { text: getMutationName(mutation), ...(color ? { color } : {}), ...(iconUrl ? { iconUrl } : {}) };
}

function patchOf(mutation: string, st: CardState): AlertCardPatch {
  return {
    body: bodyOf(st),
    chips: [chipOf(mutation)],
    figure: { value: String(st.gains.length), label: t('feature.mutationGain.figure') },
  };
}

function buildMutationGainPayload(mutation: string, st: CardState): AlertPayload {
  const sprites: AlertSprite[] = [];
  for (const g of groupBySpecies(st.gains)) {
    const url = cropSprite(g.first);
    if (url) sprites.push({ url, ...(g.count > 1 ? { count: g.count } : {}) });
  }
  const accent = mutationColor(mutation);
  const icon = sprites[0]?.url;
  const patch = patchOf(mutation, st);
  return {
    title: t('feature.mutationGain.title', { mutation: getMutationName(mutation) }),
    body: patch.body ?? '',
    cardKey: cardKeyOf(mutation),
    level: 'success',
    ...(patch.chips ? { chips: patch.chips } : {}),
    ...(patch.figure ? { figure: patch.figure } : {}),
    actions: [
      { label: t('feature.mutationGain.show'), onClick: () => { showCrop(mutation, false); }, keepOpen: true },
      { label: t('feature.mutationGain.next'), onClick: () => { showCrop(mutation, true); }, keepOpen: true },
    ],
    ...(sprites.length > 1 ? { sprites } : {}),
    ...(icon ? { iconUrl: icon } : {}),
    ...(accent ? { accent } : {}),
  };
}

function releaseSpotlight(mutation?: string): void {
  if (spotlit === null || (mutation !== undefined && spotlit !== mutation)) return;
  spotlit = null;
  setStatsHubTileOverride(null);
  releasePan();
}

/** Show spotlights the current crop; Next steps on first, unless nothing is shown yet. */
function showCrop(mutation: string, advance: boolean): void {
  const st = cards.get(mutation);
  if (!st || st.gains.length === 0) return;
  if (advance && st.cycling) st.index = (st.index + 1) % st.gains.length;
  st.cycling = true;
  const shown = st.gains[st.index];
  if (!shown) return;
  spotlit = mutation;
  setStatsHubTileOverride([shown.tileKey]);
  panToTile(shown.tileKey);
  st.handle?.update({ body: bodyOf(st) });
}

function onCardClosed(mutation: string, st: CardState): void {
  if (cards.get(mutation) === st) cards.delete(mutation);
  releaseSpotlight(mutation);
}

function addGains(mutation: string, gains: readonly MutationGain[]): void {
  let st = cards.get(mutation);
  if (st && !isAlertCardOpen(cardKeyOf(mutation))) {
    onCardClosed(mutation, st);
    st = undefined;
  }
  const fresh = !st;
  const state: CardState = st ?? { gains: [], seen: new Set(), index: 0, cycling: false, handle: null };
  for (const g of gains) {
    const id = `${g.tileKey}#${g.slotId}`;
    if (state.seen.has(id)) continue;
    state.seen.add(id);
    state.gains.push(g);
  }
  if (!fresh && state.handle) {
    state.handle.update(patchOf(mutation, state));
    counts.updated += 1;
    return;
  }
  cards.set(mutation, state);
  const handle = raiseAlert(MUTATION_GAIN_ROW, buildMutationGainPayload(mutation, state), {
    onClose: () => { onCardClosed(mutation, state); },
  });
  if (!handle) { cards.delete(mutation); return; }
  state.handle = handle;
  counts.opened += 1;
}

export function onMutationGains(gains: readonly MutationGain[]): void {
  if (!started || gains.length === 0) return;
  counts.batches += 1;
  const watched = new Set(getWatchedMutations());
  const byMutation = new Map<string, MutationGain[]>();
  for (const g of gains) {
    if (!watched.has(g.mutation)) continue;
    const list = byMutation.get(g.mutation);
    if (list) list.push(g);
    else byMutation.set(g.mutation, [g]);
  }
  for (const [mutation, list] of byMutation) addGains(mutation, list);
}

export function startMutationGainAlarm(): void {
  if (started) return;
  started = true;
  registerAlertRow({
    id: MUTATION_GAIN_ROW,
    group: 'garden',
    labelKey: 'feature.mutationGain.row',
    defaultSound: 'chime',
    settingsAction: openMutationGainSettings,
    icon: () => { const m = getWatchedMutations()[0]; return m ? mutationIcon(m) ?? null : null; },
    summary: () => {
      const list = getWatchedMutations();
      return list.length === 0
        ? t('feature.mutationGain.summaryNone')
        : t('feature.mutationGain.summary', { list: list.map(getMutationName).join(', ') });
    },
    accent: () => { const m = getWatchedMutations()[0]; return m ? mutationColor(m) ?? null : null; },
  });
}

// Lazy so the alarm core never loads window code.
function openMutationGainSettings(): void {
  void import('../../../ui/garden/mutationGainWindow').then((m) => { m.openMutationGainWindow(); });
}

export function stopMutationGainAlarm(): void {
  if (!started) return;
  started = false;
  cards.clear();
  releaseSpotlight();
}

export function getMutationGainAlarmState(): {
  started: boolean;
  watched: string[];
  cards: Record<string, { crops: number; index: number; cycling: boolean; open: boolean }>;
  spotlit: string | null;
  pan: ReturnType<typeof getPanState>;
  batches: number;
  opened: number;
  updated: number;
} {
  const out: Record<string, { crops: number; index: number; cycling: boolean; open: boolean }> = {};
  for (const [m, st] of cards) out[m] = { crops: st.gains.length, index: st.index, cycling: st.cycling, open: isAlertCardOpen(cardKeyOf(m)) };
  return { started, watched: getWatchedMutations(), cards: out, spotlit, pan: getPanState(), ...counts };
}
