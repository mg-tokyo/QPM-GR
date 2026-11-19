// ALR-16.4: a stocked seed the journal still needs (features/journalSeeds) gets a restock card,
// gated by two centre rows (PD-C). Pinned seeds keep the pin's title and sound; the line is added.

import { t } from '../../../i18n';
import { getAnySpriteDataUrl, isSpritesReady } from '../../../sprite-v2/compat';
import { getMutationName, getPlantSafe } from '../../../utils/game/catalogHelpers';
import { getWatchedSeeds, type WatchedSeed } from '../../../features/journalSeeds';
import { findVariantBadge } from '../../../features/mutations/data/variantBadges';
import { resolveWeatherMutationEntry } from '../../../features/garden/cropMutationAnalytics';
import { getWeatherSnapshot } from '../../../store/weatherHub';
import { registerAlertRow, getAlertRow } from '../../../features/alertHub/registry';
import { getAlertRowSettings } from '../../../features/alertHub/settings';
import type { AlertChip } from '../../../features/alertHub/raise';
import { el, createMetaRow } from './cardShell';
import { getAlertSpriteUrl } from './itemLook';
import type { ActiveAlert, JournalCardInfo } from './types';

export const JOURNAL_SEED_ROW = 'shops.journalSeed';
export const JOURNAL_SEED_WEATHER_ROW = 'shops.journalSeedWeather';
const MAX_JOURNAL_CHIPS = 3;

function rowOn(id: string): boolean {
  const def = getAlertRow(id);
  return def ? getAlertRowSettings(id, def.defaultSound, def.defaultEnabled).enabled : false;
}

const cropName = (species: string): string => getPlantSafe(species)?.crop.name ?? species;

function variantChip(variant: string): AlertChip {
  const badge = findVariantBadge(variant);
  const iconUrl = isSpritesReady() ? getAnySpriteDataUrl(badge?.iconKey) || undefined : undefined;
  return {
    text: getMutationName(variant),
    ...(badge?.color ? { color: badge.color } : {}),
    ...(iconUrl ? { iconUrl } : {}),
  };
}

function journalLine(seed: WatchedSeed): string {
  const count = seed.missing.length;
  if (seed.forSpecies !== seed.seedSpecies) {
    return t('feature.restockAlert.journalMissingFor', { count, species: cropName(seed.forSpecies) });
  }
  return count === 1 ? t('feature.restockAlert.journalMissingOne') : t('feature.restockAlert.journalMissing', { count });
}

function weatherLine(mutation: string): string {
  const weather = resolveWeatherMutationEntry(getWeatherSnapshot().kind).displayName ?? '';
  return t('feature.restockAlert.journalWeatherLine', { weather, mutation: getMutationName(mutation) });
}

/** Weather match first, then the remaining missing variants in journal order. */
function journalChips(seed: WatchedSeed): AlertChip[] {
  const order = seed.weatherMatch ? [seed.weatherMatch, ...seed.missing.filter((v) => v !== seed.weatherMatch)] : seed.missing;
  return order.slice(0, MAX_JOURNAL_CHIPS).map(variantChip);
}

export interface JournalRowsState {
  mainOn: boolean;
  weatherOn: boolean;
}

/** Which row a watched seed's card answers to; null when neither row lets it through. */
export function pickJournalRow(seed: WatchedSeed, rows: JournalRowsState): string | null {
  if (seed.weatherMatch && rows.weatherOn) return JOURNAL_SEED_WEATHER_ROW;
  return rows.mainOn ? JOURNAL_SEED_ROW : null;
}

/** The journal part of a stocked seed's card, or null when the seed is not watched or its rows are off. */
export function resolveJournalCard(seedSpecies: string, pinned: boolean): JournalCardInfo | null {
  const seed = getWatchedSeeds().find((s) => s.seedSpecies === seedSpecies);
  if (!seed) return null;
  const rowId = pickJournalRow(seed, { mainOn: rowOn(JOURNAL_SEED_ROW), weatherOn: rowOn(JOURNAL_SEED_WEATHER_ROW) });
  if (!rowId) return null;
  return {
    rowId,
    pinned,
    line: journalLine(seed),
    weatherLine: seed.weatherMatch ? weatherLine(seed.weatherMatch) : null,
    chips: journalChips(seed),
  };
}

/** A shop entry is a seed when the seed shop sells it or a mixed (weather) shop tags it `Seed`. */
export function isSeedEntry(shopType: string, itemType: string | undefined): boolean {
  return shopType === 'seed' || itemType === 'Seed';
}

export function createJournalParts(): Required<Pick<ActiveAlert, 'journalEl' | 'journalMeta'>> {
  // Own line under the stock row: that row lays its children out side by side.
  const journalEl = el('div', 'qpm-alert-card__body');
  journalEl.style.whiteSpace = 'pre-line';
  journalEl.style.display = 'none';
  return { journalEl, journalMeta: createMetaRow() };
}

/** Caption, journal lines, chips and stack position follow `model.journal`; absent → the plain card. */
export function applyJournalLook(active: ActiveAlert): void {
  const journal = active.model.journal;
  if (active.captionEl && !active.model.isWeatherAlert) {
    active.captionEl.textContent = journal && !journal.pinned
      ? t('feature.restockAlert.journalSeedInStock')
      : t('feature.restockAlert.pinnedRestocked');
  }
  if (active.journalEl) {
    const lines = journal ? [journal.line, journal.weatherLine].filter((l): l is string => !!l) : [];
    active.journalEl.textContent = lines.join('\n');
    active.journalEl.style.display = lines.length > 0 ? '' : 'none';
  }
  active.journalMeta?.setChips(journal?.chips ?? []);
  active.root.style.order = journal?.weatherLine ? '-1' : '';
}

function watchedSummary(): string {
  const count = getWatchedSeeds().length;
  return count > 0 ? t('feature.restockAlert.journalRowSummary', { count }) : t('feature.restockAlert.journalRowSummaryNone');
}

function weatherSummary(): string {
  const matched = getWatchedSeeds().filter((s) => s.weatherMatch);
  const first = matched[0]?.weatherMatch;
  return first
    ? t('feature.restockAlert.journalWeatherRowSummary', { mutation: getMutationName(first), count: matched.length })
    : t('feature.restockAlert.journalWeatherRowSummaryNone');
}

function firstSeedIcon(weatherOnly: boolean): string | null {
  const seed = getWatchedSeeds().find((s) => !weatherOnly || s.weatherMatch);
  return seed ? getAlertSpriteUrl('seed', seed.seedSpecies, seed.seedSpecies) : null;
}

/** Idempotent (registerAlertRow replaces in place). */
export function registerJournalSeedRows(): void {
  registerAlertRow({
    id: JOURNAL_SEED_ROW,
    group: 'shops',
    labelKey: 'feature.restockAlert.journalRow',
    defaultSound: 'chime',
    icon: () => firstSeedIcon(false),
    summary: watchedSummary,
    accent: 'var(--qpm-accent)',
  });
  registerAlertRow({
    id: JOURNAL_SEED_WEATHER_ROW,
    group: 'shops',
    labelKey: 'feature.restockAlert.journalWeatherRow',
    defaultSound: 'alert',
    icon: () => firstSeedIcon(true),
    summary: weatherSummary,
    accent: () => {
      const m = getWatchedSeeds().find((s) => s.weatherMatch)?.weatherMatch;
      return m ? findVariantBadge(m)?.color ?? null : null;
    },
  });
}
