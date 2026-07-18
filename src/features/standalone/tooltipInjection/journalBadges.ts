// src/features/tooltipInjection/journalBadges.ts
// Journal variant badge rendering in crop tooltips.
// Shows letter badges (R, G, F, etc.) for unlogged produce variants.

import { getJournal, type Journal } from '../../journal/checker';
import { getVariantBadges } from '../../mutations/data/variantBadges';
import { renderBySpriteKey } from '../../../sprite-v2/compat';
import { storage } from '../../../utils/storage';
import { warnFeature } from './_diagnostics';
import { resolveCurrentSlot } from './atoms';
import { normalizeAriesValueIcons, getAriesValueRow } from './ariesCompat';
import {
  TOOLTIP_ROW_ATTR,
  JOURNAL_BADGE_ATTR,
  CROP_SIZE_STORAGE_KEY,
  CROP_SIZE_LEGACY_KEY,
} from './types';
import type { CropSizeConfig, VariantBadge } from './types';

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: CropSizeConfig = {
  enabled: true,
  showForGrowing: true,
  showForMature: true,
  showJournalIndicators: true,
  journalBadgeStyle: 'icons',
};

let config: CropSizeConfig = { ...DEFAULT_CONFIG };

export function getCropSizeConfig(): CropSizeConfig {
  return { ...config };
}

export function setCropSizeConfig(updates: Partial<CropSizeConfig>): void {
  config = { ...config, ...updates };
  storage.set(CROP_SIZE_STORAGE_KEY, config);
}

export function loadCropSizeConfig(): void {
  // Migrate from legacy key if needed
  const legacy = storage.get<CropSizeConfig | null>(CROP_SIZE_LEGACY_KEY, null);
  if (legacy) {
    storage.set(CROP_SIZE_STORAGE_KEY, legacy);
    storage.remove(CROP_SIZE_LEGACY_KEY);
    config = { ...DEFAULT_CONFIG, ...legacy };
    return;
  }

  const saved = storage.get<CropSizeConfig>(CROP_SIZE_STORAGE_KEY, DEFAULT_CONFIG);
  config = { ...DEFAULT_CONFIG, ...saved };
}

export function isBadgesEnabled(): boolean {
  return config.enabled && config.showJournalIndicators;
}

// ---------------------------------------------------------------------------
// Species key normalization (for alias lookup — simpler than helpers.ts version)
// ---------------------------------------------------------------------------

const normalizeKey = (value: string): string =>
  (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

const SPECIES_KEY_ALIASES: Record<string, string[]> = {
  cacaobean: ['cacao', 'cacao bean', 'cacao fruit', 'cocoabean', 'cocoa bean'],
  dragonfruit: ['dragon fruit'],
  favabean: ['fava bean', 'fava-bean', 'fava', 'fava bean pod', 'fava pod'],
  burrostail: ["burro's tail", 'burros tail', 'burro tail'],
  passionfruit: ['passion fruit', 'passion-fruit', 'passionfruit'],
  dawncelestial: ['dawnbinder', 'dawn binder'],
  mooncelestial: ['moonbinder', 'moon binder'],
  bamboo: ['bamboo shoot', 'bambooshoot'],
};

const resolveSpeciesKey = (raw: string): string => {
  const key = normalizeKey(raw);
  for (const [canonical, aliases] of Object.entries(SPECIES_KEY_ALIASES)) {
    if (key === canonical) return canonical;
    if (aliases.some((alias) => normalizeKey(alias) === key)) return canonical;
  }
  return key;
};

// ---------------------------------------------------------------------------
// Journal lookup
// ---------------------------------------------------------------------------

let cachedJournalData: Journal | null = null;

/** Clear cached journal data so it refreshes on next tooltip hover. */
export function clearJournalCache(): void {
  cachedJournalData = null;
}

interface ProduceEntry {
  variantsLogged?: Array<string | { variant?: string }>;
}

async function getUnloggedVariantBadges(species: string): Promise<VariantBadge[]> {
  try {
    if (!cachedJournalData) {
      cachedJournalData = await getJournal();
    }

    if (!cachedJournalData?.produce) return [];

    // Build lookup by normalized species key
    const produceByKey = new Map<string, ProduceEntry>();
    for (const [name, data] of Object.entries(cachedJournalData.produce)) {
      produceByKey.set(resolveSpeciesKey(name), data as ProduceEntry);
    }

    const speciesKey = resolveSpeciesKey(species);
    const speciesData = produceByKey.get(speciesKey);

    if (!speciesData) {
      // Species not in journal yet — everything counts as unlogged
      return getVariantBadges().map(badge => ({ ...badge }));
    }

    const loggedVariants = new Set(
      (speciesData.variantsLogged ?? [])
        .map((v) => {
          const name = typeof v === 'string' ? v : v?.variant;
          return typeof name === 'string' ? name.toLowerCase() : '';
        })
        .filter(Boolean),
    );

    const unloggedBadges: VariantBadge[] = [];
    for (const badge of getVariantBadges()) {
      const isLogged = badge.matches.some(matchName =>
        loggedVariants.has(matchName.toLowerCase()),
      );
      if (!isLogged) {
        unloggedBadges.push({ ...badge });
      }
    }

    return unloggedBadges;
  } catch (error) {
    warnFeature('QPM-FEATURE-004', { what: 'journal:variants', species }, error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// DOM rendering
// ---------------------------------------------------------------------------

// Game card ratio: 14px attribute font × 1.35 (gardenInfo/attributeChips.ts).
const BADGE_ICON_SIZE_PX = 19;

function createBadgeElement(badge: VariantBadge): HTMLElement {
  if (config.journalBadgeStyle !== 'letters' && badge.iconKey) {
    const canvas = renderBySpriteKey(badge.iconKey);
    if (canvas) {
      canvas.setAttribute(JOURNAL_BADGE_ATTR, 'true');
      canvas.style.height = `${BADGE_ICON_SIZE_PX}px`;
      canvas.style.width = 'auto';
      canvas.style.imageRendering = 'pixelated';
      canvas.style.display = 'inline-block';
      canvas.style.verticalAlign = 'middle';
      canvas.title = badge.displayName ?? badge.matches[0] ?? '';
      return canvas;
    }
    // Unknown/unready sprite key — fall through to the letter glyph.
  }

  const span = document.createElement('span');
  span.setAttribute(JOURNAL_BADGE_ATTR, 'true');
  span.textContent = badge.label;

  if (badge.gradient) {
    span.style.backgroundImage = badge.gradient;
    span.style.color = 'transparent';
    span.style.backgroundClip = 'text';
    span.style.setProperty('-webkit-background-clip', 'text');
    span.style.setProperty('-webkit-text-fill-color', 'transparent');
  } else if (badge.color) {
    span.style.color = badge.color;
  } else {
    span.style.color = '#FFFFFF';
  }

  // Force badge legibility (don't inherit tooltip/weight colors)
  span.style.textShadow = '0 1px 2px rgba(0, 0, 0, 0.35)';
  span.style.setProperty('color', span.style.color || '#FFFFFF', 'important');
  span.style.fontWeight = badge.bold ? '800' : '600';
  span.title = badge.displayName ?? badge.matches[0] ?? '';
  return span;
}

const BADGE_CONTAINER_ATTR = 'data-qpm-badge-container';

function ensureJournalBadgeRow(
  container: HTMLElement,
  badges: VariantBadge[],
): void {
  const ROW_SEL = `:scope > [${TOOLTIP_ROW_ATTR}="journal"]`;
  let row = container.querySelector(ROW_SEL) as HTMLElement | null;

  if (badges.length === 0) {
    row?.remove();
    return;
  }

  if (!row) {
    row = document.createElement('span');
    row.setAttribute(TOOLTIP_ROW_ATTR, 'journal');

    // Position after Aries row if present, otherwise append
    const ariesRow = getAriesValueRow(container);
    if (ariesRow && ariesRow.parentElement === container) {
      ariesRow.insertAdjacentElement('afterend', row);
    } else {
      container.appendChild(row);
    }
  }

  let badgeContainer = row.querySelector(
    `:scope > span[${BADGE_CONTAINER_ATTR}]`,
  ) as HTMLElement | null;
  if (!badgeContainer) {
    badgeContainer = document.createElement('span');
    badgeContainer.setAttribute(BADGE_CONTAINER_ATTR, 'true');
    badgeContainer.style.display = 'inline-flex';
    badgeContainer.style.gap = '4px';
    badgeContainer.style.alignItems = 'center';
    row.appendChild(badgeContainer);
  }

  const nodes = badges.map(createBadgeElement);
  badgeContainer.replaceChildren(...nodes);

  // Wrap to a second line for many variants
  const shouldWrap = badges.length > 8;
  row.style.flexWrap = shouldWrap ? 'wrap' : 'nowrap';
  row.style.rowGap = shouldWrap ? '2px' : '0';
  badgeContainer.style.flexWrap = shouldWrap ? 'wrap' : 'nowrap';
  badgeContainer.style.maxWidth = shouldWrap ? '220px' : '';
  badgeContainer.style.justifyContent = shouldWrap ? 'center' : '';
  badgeContainer.style.width = shouldWrap ? '100%' : 'auto';
  badgeContainer.style.textAlign = shouldWrap ? 'center' : 'right';
}

function removeJournalBadgeRow(container: HTMLElement): void {
  const row = container.querySelector(`:scope > [${TOOLTIP_ROW_ATTR}="journal"]`);
  row?.remove();
}

// ---------------------------------------------------------------------------
// Injector (registered with observer)
// ---------------------------------------------------------------------------

export async function injectJournalBadges(
  container: HTMLElement,
): Promise<void> {
  if (!config.enabled || !config.showJournalIndicators) {
    removeJournalBadgeRow(container);
    return;
  }

  const slot = resolveCurrentSlot();
  if (!slot) {
    removeJournalBadgeRow(container);
    return;
  }

  // Maturity check
  const isMature = slot.endTime > 0 && Date.now() >= slot.endTime;
  if ((isMature && !config.showForMature) || (!isMature && !config.showForGrowing)) {
    removeJournalBadgeRow(container);
    return;
  }

  const badges = await getUnloggedVariantBadges(slot.species);
  ensureJournalBadgeRow(container, badges);
  normalizeAriesValueIcons(container);
}
