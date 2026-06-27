// src/ui/xpTracker/xpTrackerContent.ts — XP Tracker content (renders inside modalWindow or hub card)

import { formatCoins } from '../../../features/economy/valueCalculator';
import { onActivePetInfos, type ActivePetInfo } from '../../../store/pets';
import { getPetSpriteDataUrlWithMutations } from '../../../sprite-v2/compat';
import {
  calculateXpStats,
  getCombinedXpStats,
  getSpeciesXpPerLevel,
  calculateMaxStrength,
  calculateTimeToLevel,
  onXpTrackerUpdate,
  type XpAbilityStats,
} from '../../../store/xpTracker';
import { getAbilityDefinition, type AbilityDefinition } from '../../../features/pets/data/petAbilities';
import { getAbilityColor } from '../../../utils/rendering/petCardRenderer';
import { getHungerCapOrDefault } from '../../../features/pets/data/petHungerCaps';
import { calculateFeedsPerLevel } from '../../../features/pets/data/petHungerDepletion';
import { throttle } from '../../../utils/scheduling/scheduling';
import { getWeatherSnapshot } from '../../../store/weatherHub';
import type { DetailedWeather } from '../../../utils/game/weatherDetection';
import { getAbilityName } from '../../../utils/game/catalogHelpers';
import { onCatalogsReady } from '../../../catalogs/gameCatalogs';
import { t } from '../../../i18n';
import { renderNearMaxSection, type NearMaxState } from './nearMaxSection';
import {
  getXpPotionCount,
  onXpPotionCountChange,
  isPetEligibleForXpPotion,
} from '../../../features/pets/xpPotion';
import { createPotionButton, POTION_COLOR, POTION_GLOW, type HoverGuard } from './xpPotionButton';
import { createSpinner } from '../../components/spinner';
import { createEmptyState } from '../../components/emptyState';

// ============================================================================
// CONSTANTS
// ============================================================================

const WEATHER_ICONS: Record<string, string> = {
  snow: '❄️', rain: '🌧️', dawn: '🌅', amber: '🌕', thunderstorm: '⚡', sunny: '☀️',
};

// ============================================================================
// ABILITY DETECTION — dynamic, catalog-driven (no hardcoded ID list)
// ============================================================================

function findXpAbilities(pet: ActivePetInfo): AbilityDefinition[] {
  if (!pet.abilities?.length) return [];
  return pet.abilities
    .map(id => getAbilityDefinition(id))
    .filter((def): def is AbilityDefinition =>
      def?.category === 'xp' && def.trigger === 'continuous'
    );
}

export interface XpTrackerSummaryStats {
  abilityCount: number;
  abilityXpPerHour: number;
  totalTeamXpPerHour: number;
  totalProcsPerHour: number;
  totalProcCount: number;
  currentWeather: DetailedWeather;
}

interface XpTrackerComputedStats extends XpTrackerSummaryStats {
  stats: XpAbilityStats[];
}

function getXpTrackerComputedStats(pets: ActivePetInfo[]): XpTrackerComputedStats {
  const currentWeather = getWeatherSnapshot().kind;
  const stats: XpAbilityStats[] = [];
  for (const pet of pets) {
    for (const def of findXpAbilities(pet)) {
      stats.push(calculateXpStats(
        pet,
        def.id,
        getAbilityName(def.id),
        def.baseProbability ?? 0,
        def.effectValuePerProc ?? 0,
        def.requiredWeather ?? null,
        currentWeather,
      ));
    }
  }

  const combined = stats.length > 0 ? getCombinedXpStats(stats) : null;
  const abilityXpPerHour = combined?.totalXpPerHour ?? 0;
  return {
    stats,
    abilityCount: stats.length,
    abilityXpPerHour,
    totalTeamXpPerHour: 3600 + abilityXpPerHour,
    totalProcsPerHour: combined?.totalProcsPerHour ?? 0,
    totalProcCount: combined?.totalProcCount ?? 0,
    currentWeather,
  };
}

export function getXpTrackerSummaryStats(pets: ActivePetInfo[]): XpTrackerSummaryStats {
  const { stats: _stats, ...summary } = getXpTrackerComputedStats(pets);
  return summary;
}

// ============================================================================
// UTILITY HELPERS
// ============================================================================

/** Format total minutes into a compact human-readable string */
function formatTime(totalMinutes: number): string {
  if (totalMinutes >= 1440) {
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const mins = Math.round(totalMinutes % 60);
  return hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
}

export function getMaxStr(pet: ActivePetInfo): number | null {
  if (pet.species && pet.targetScale) return calculateMaxStrength(pet.targetScale, pet.species);
  if (pet.strength != null && pet.strength >= 80 && pet.strength <= 100) return pet.strength;
  return null;
}

// ============================================================================
// UI PRIMITIVES
// ============================================================================

export function makeChip(text: string, color: string): HTMLElement {
  const el = document.createElement('span');
  el.textContent = text;
  el.style.cssText = [
    `color:${color}`,
    'font-size:12px',
    'font-family:monospace',
    'background:rgba(255,255,255,0.05)',
    'padding:2px 8px',
    'border-radius:10px',
    'border:1px solid rgba(255,255,255,0.08)',
    'white-space:nowrap',
  ].join(';');
  return el;
}

export function makePillButton(text: string, active: boolean): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.textContent = text;
  btn.style.cssText = [
    'padding:3px 10px',
    'font-size:12px',
    'border-radius:10px',
    'cursor:pointer',
    `font-weight:${active ? '600' : '400'}`,
    `background:${active ? 'var(--qpm-accent)' : 'rgba(255,255,255,0.06)'}`,
    `color:${active ? '#fff' : 'var(--qpm-text-muted)'}`,
    `border:1px solid ${active ? 'var(--qpm-accent)' : 'rgba(255,255,255,0.12)'}`,
    'transition:all 0.15s ease',
  ].join(';');
  return btn;
}

function createCollapsible(titleText: string, startExpanded: boolean): { wrapper: HTMLElement; content: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.style.borderTop = '1px solid var(--qpm-border)';

  const header = document.createElement('div');
  header.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'padding:8px 14px',
    'cursor:pointer',
    'user-select:none',
    'background:var(--qpm-surface-1)',
  ].join(';');

  const titleEl = document.createElement('span');
  titleEl.textContent = titleText;
  titleEl.style.cssText = 'color:var(--qpm-text);font-size:12px;font-weight:600;pointer-events:none;';

  const chevron = document.createElement('span');
  chevron.textContent = startExpanded ? '▼' : '▶';
  chevron.style.cssText = 'color:var(--qpm-text-muted);font-size:9px;pointer-events:none;';

  header.appendChild(titleEl);
  header.appendChild(chevron);

  const content = document.createElement('div');
  content.style.display = startExpanded ? 'block' : 'none';

  header.addEventListener('click', () => {
    const open = content.style.display !== 'none';
    content.style.display = open ? 'none' : 'block';
    chevron.textContent = open ? '▶' : '▼';
  });

  wrapper.appendChild(header);
  wrapper.appendChild(content);
  return { wrapper, content };
}

// ============================================================================
// PET CARD
// ============================================================================

function createPetCard(
  pet: ActivePetInfo,
  teamXpPerHour: number,
  potionCount: number,
  hoverGuard: HoverGuard,
): HTMLElement {
  const maxStr = getMaxStr(pet);
  const xpPerLevel = pet.species ? getSpeciesXpPerLevel(pet.species) : null;
  const canPotion = potionCount > 0 && isPetEligibleForXpPotion(pet)
    && xpPerLevel != null && maxStr != null && pet.xp != null && pet.strength != null;

  const card = document.createElement('div');
  card.style.cssText = [
    'background:var(--qpm-surface-2)',
    'border:1px solid var(--qpm-border)',
    'border-radius:6px',
    'padding:10px 12px',
    'display:flex',
    'flex-direction:column',
    'gap:7px',
  ].join(';');

  // ── Header row: [ability badges] [sprite] [name block] [STR badge] ──
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;';

  // Ability badge column
  const petAbilities = pet.abilities ?? [];
  if (petAbilities.length > 0) {
    const col = document.createElement('div');
    col.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex-shrink:0;';
    for (const id of petAbilities.slice(0, 4)) {
      const c = getAbilityColor(id);
      const sq = document.createElement('div');
      sq.title = id;
      sq.style.cssText = [
        'width:8px',
        'height:8px',
        'border-radius:2px',
        `background:${c.base}`,
        'border:1px solid rgba(255,255,255,0.2)',
        `box-shadow:0 0 3px ${c.glow}`,
      ].join(';');
      col.appendChild(sq);
    }
    header.appendChild(col);
  }

  // Sprite
  if (pet.species) {
    const img = document.createElement('img');
    img.src = getPetSpriteDataUrlWithMutations(pet.species, pet.mutations ?? []) ?? '';
    img.dataset.qpmSprite = `pet:${pet.species}`;
    img.alt = pet.species;
    img.style.cssText = 'width:36px;height:36px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';
    header.appendChild(img);
  }

  // Name + species
  const nameBlock = document.createElement('div');
  nameBlock.style.cssText = 'flex:1;min-width:0;';

  const nameEl = document.createElement('div');
  nameEl.textContent = pet.name || pet.species || t('feature.xpTracker.unknown');
  nameEl.style.cssText = 'font-weight:600;color:var(--qpm-text);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  nameBlock.appendChild(nameEl);

  if (pet.name && pet.species) {
    const sub = document.createElement('div');
    sub.textContent = pet.species;
    sub.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);margin-top:1px;';
    nameBlock.appendChild(sub);
  }
  header.appendChild(nameBlock);

  // STR badge — keep refs for potion projection
  let strProjection: HTMLElement | null = null;
  if (pet.strength != null) {
    const badge = document.createElement('div');
    badge.style.cssText = 'text-align:right;flex-shrink:0;';

    const strEl = document.createElement('div');
    strEl.textContent = t('feature.xpTracker.str', { value: String(pet.strength) });
    strEl.style.cssText = 'font-weight:700;font-family:monospace;font-size:12px;color:var(--qpm-accent);white-space:nowrap;';
    badge.appendChild(strEl);

    // Pre-create hidden projection span
    if (canPotion) {
      strProjection = document.createElement('span');
      strProjection.style.cssText = `color:${POTION_COLOR};text-shadow:0 0 6px ${POTION_GLOW};display:none;`;
      strEl.appendChild(strProjection);
    }

    if (maxStr) {
      const maxEl = document.createElement('div');
      maxEl.textContent = t('feature.xpTracker.maxStr', { value: String(maxStr) });
      maxEl.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);font-family:monospace;margin-top:1px;';
      badge.appendChild(maxEl);
    }
    header.appendChild(badge);
  }

  card.appendChild(header);

  // ── Progress bar + time chips ──
  let projectionFill: HTMLElement | null = null;
  let barLbl: HTMLElement | null = null;
  let barLblOrigHtml = '';

  if (pet.xp !== null && pet.strength !== null && xpPerLevel && maxStr) {
    if (pet.strength >= maxStr) {
      const maxMsg = document.createElement('div');
      maxMsg.textContent = `🌟 ${t('feature.xpTracker.fullyLevelled', { value: String(maxStr) })}`;
      maxMsg.style.cssText = 'font-size:12px;color:var(--qpm-accent);font-weight:600;';
      card.appendChild(maxMsg);
    } else {
      const xpToNext = pet.xp % xpPerLevel;
      const pct = Math.min(100, (xpToNext / xpPerLevel) * 100);

      // Progress bar
      const barWrap = document.createElement('div');
      barWrap.style.cssText = 'display:flex;flex-direction:column;gap:3px;';

      const track = document.createElement('div');
      track.style.cssText = 'height:8px;background:rgba(255,255,255,0.07);border-radius:4px;overflow:hidden;position:relative;';

      const fill = document.createElement('div');
      fill.style.cssText = `width:${pct.toFixed(1)}%;height:100%;background:linear-gradient(90deg,var(--qpm-accent),var(--qpm-positive));border-radius:4px;`;
      track.appendChild(fill);

      // Pre-create hidden projection fill (light blue)
      if (canPotion) {
        projectionFill = document.createElement('div');
        projectionFill.style.cssText = [
          'position:absolute',
          'top:0',
          'height:100%',
          `background:linear-gradient(90deg,${POTION_COLOR},#a0e4ff)`,
          'border-radius:4px',
          'opacity:0',
          'left:0',
          'width:0',
          `box-shadow:0 0 8px ${POTION_GLOW}`,
          'transition:width 0.15s ease,opacity 0.15s ease',
        ].join(';');
        track.appendChild(projectionFill);
      }

      barWrap.appendChild(track);

      barLbl = document.createElement('div');
      barLbl.style.cssText = 'display:flex;justify-content:space-between;font-size:10px;color:var(--qpm-text-muted);font-family:monospace;';
      barLblOrigHtml = `<span>${formatCoins(xpToNext)} / ${formatCoins(xpPerLevel)}</span><span>${pct.toFixed(1)}%</span>`;
      barLbl.innerHTML = barLblOrigHtml;
      barWrap.appendChild(barLbl);
      card.appendChild(barWrap);

      // Time chips row
      const chips = document.createElement('div');
      chips.className = 'qpm-xp-time-chips';
      chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;align-items:center;';

      if (teamXpPerHour > 0) {
        const timeToNext = calculateTimeToLevel(xpToNext, xpPerLevel, teamXpPerHour);
        if (timeToNext) {
          chips.appendChild(makeChip(`⏱ ${t('feature.xpTracker.nextLevel', { time: formatTime(timeToNext.totalMinutes) })}`, 'var(--qpm-positive)'));
        }

        const levelsLeft = maxStr - pet.strength;
        const xpToMax = (xpPerLevel - xpToNext) + xpPerLevel * (levelsLeft - 1);
        const minsToMax = (xpToMax / teamXpPerHour) * 60;
        chips.appendChild(makeChip(`🏁 ${t('feature.xpTracker.toMax', { time: formatTime(minsToMax) })}`, 'var(--qpm-warning)'));

        // ── XP Potion button (3rd chip, after next + max) ──
        if (canPotion) {
          const potionBtn = createPotionButton(
            pet, potionCount, xpPerLevel, maxStr, pct, xpToNext,
            projectionFill, strProjection, barLbl, barLblOrigHtml, hoverGuard,
          );
          chips.appendChild(potionBtn);
        }

        if (pet.species) {
          const hungerCap = getHungerCapOrDefault(pet.species);
          const feeds = calculateFeedsPerLevel(pet.species, hungerCap, xpPerLevel, teamXpPerHour);
          if (feeds && feeds > 0) {
            chips.appendChild(makeChip(`🍖 ${t('feature.xpTracker.feedsPerLevel', { count: String(feeds) })}`, 'rgba(255,255,255,0.4)'));
          }
        }
      } else {
        chips.appendChild(makeChip(t('feature.xpTracker.noXpRate'), 'var(--qpm-text-muted)'));
      }

      if (chips.children.length > 0) card.appendChild(chips);
    }
  } else if (!xpPerLevel && pet.species) {
    const note = document.createElement('div');
    note.textContent = t('feature.xpTracker.xpLoading');
    note.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);font-style:italic;';
    card.appendChild(note);
  }

  return card;
}

// ============================================================================
// SUMMARY STRIP
// ============================================================================

function updateSummaryStrip(
  el: HTMLElement,
  stats: XpAbilityStats[],
  teamXpPerHour: number,
  weather: DetailedWeather,
  petCount: number,
): void {
  el.innerHTML = '';
  const abilityXp = teamXpPerHour - 3600;
  const weatherIcon = WEATHER_ICONS[weather] ?? '';
  const weatherLabel = weather === 'unknown' ? '' : weather;

  const frag = (html: string, color?: string) => {
    const s = document.createElement('span');
    s.innerHTML = html;
    if (color) s.style.color = color;
    return s;
  };

  if (stats.length === 0) {
    el.appendChild(frag(petCount !== 1 ? t('feature.xpTracker.petCounts', { count: String(petCount) }) : t('feature.xpTracker.petCount', { count: String(petCount) }), 'var(--qpm-text-muted)'));
    el.appendChild(frag('·', 'var(--qpm-border)'));
    el.appendChild(frag(t('feature.xpTracker.baseXpRate'), 'var(--qpm-warning)'));
    el.appendChild(frag(t('feature.xpTracker.baseNoAbilities'), 'var(--qpm-text-muted)'));
  } else {
    el.appendChild(frag(t('feature.xpTracker.base'), 'var(--qpm-text-muted)'));
    el.appendChild(frag('3,600', 'var(--qpm-warning)'));
    el.appendChild(frag('+', 'var(--qpm-text-muted)'));
    el.appendChild(frag(t('feature.xpTracker.ability'), 'var(--qpm-text-muted)'));
    el.appendChild(frag(`+${formatCoins(abilityXp)}`, 'var(--qpm-warning)'));
    el.appendChild(frag('=', 'var(--qpm-text-muted)'));

    const total = frag(t('feature.xpTracker.xpPerHour', { rate: formatCoins(teamXpPerHour) }), 'var(--qpm-accent)');
    total.style.fontWeight = '700';
    total.style.fontSize = '12px';
    el.appendChild(total);

    el.appendChild(frag(`· ${stats.length === 1 ? t('feature.xpTracker.xpPetCount', { count: String(stats.length) }) : t('feature.xpTracker.xpPetCounts', { count: String(stats.length) })}`, 'var(--qpm-text-muted)'));
  }

  if (weatherLabel) {
    const wChip = document.createElement('span');
    wChip.textContent = `${weatherIcon} ${weatherLabel}`;
    wChip.style.cssText = 'margin-left:auto;color:var(--qpm-text-muted);font-size:12px;';
    el.appendChild(wChip);
  }
}

// ============================================================================
// RENDER CONTENT (embeddable — no window chrome)
// ============================================================================

/**
 * Builds XP tracker content inside the given container.
 * Sets up subscriptions for live updates and returns an idempotent cleanup function.
 */
export function renderXpTrackerContent(container: HTMLElement): () => void {
  let cleaned = false;
  const cleanups: Array<() => void> = [];

  // -- Internal state --
  let latestPets: ActivePetInfo[] = [];
  let latestStats: XpAbilityStats[] = [];
  let totalTeamXpPerHour = 0;
  let currentWeather: DetailedWeather = 'unknown';
  let potionCount = getXpPotionCount();

  // Hover guard — suppresses card rebuilds while a potion button is hovered
  const hoverGuard: HoverGuard = { hovering: false, pendingRender: false };

  // Near-max state (shared with nearMaxSection)
  const nearMaxState: NearMaxState = {
    expandedPetKey: null,
    busyPetKey: null,
    status: null,
    statusTimer: null,
  };

  // -- DOM structure --
  // Summary strip
  const summaryStrip = document.createElement('div');
  summaryStrip.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:6px',
    'flex-wrap:wrap',
    'padding:6px 14px',
    'background:var(--qpm-surface-1)',
    'border-bottom:1px solid var(--qpm-border)',
    'font-size:12px',
    'font-family:monospace',
    'color:var(--qpm-text-muted)',
    'flex-shrink:0',
  ].join(';');
  summaryStrip.dataset.tour = 'xp-summary';
  summaryStrip.textContent = t('common.loading');
  container.appendChild(summaryStrip);

  // Scrollable content area
  const scrollContent = document.createElement('div');
  scrollContent.style.cssText = [
    'flex:1',
    'overflow-y:auto',
    'overflow-x:hidden',
    'min-height:0',
    'scrollbar-width:thin',
    'scrollbar-color:rgba(255,255,255,0.1) transparent',
  ].join(';');

  const contentWrap = document.createElement('div');
  contentWrap.style.cssText = 'display:flex;flex-direction:column;';

  // Active pets section
  const activeSec = createCollapsible(`🐾 ${t('feature.xpTracker.activePets')}`, true);
  const petCardsContainer = document.createElement('div');
  petCardsContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;padding:8px 12px 10px;';
  petCardsContainer.dataset.tour = 'xp-pet-cards';

  petCardsContainer.appendChild(createSpinner(t('common.loading')));

  activeSec.content.appendChild(petCardsContainer);
  contentWrap.appendChild(activeSec.wrapper);

  // Near Max Level section (collapsed by default)
  const nearMaxSec = createCollapsible(`🏆 ${t('feature.xpTracker.nearMaxLevel')}`, false);
  nearMaxSec.wrapper.dataset.tour = 'xp-near-max';
  const nearMaxContainer = document.createElement('div');
  nearMaxSec.content.appendChild(nearMaxContainer);
  contentWrap.appendChild(nearMaxSec.wrapper);

  scrollContent.appendChild(contentWrap);
  container.appendChild(scrollContent);

  // -- Render functions --
  const renderPetCards = (): void => {
    // Suppress rebuild while user hovers a potion button (prevents flicker)
    if (hoverGuard.hovering) {
      hoverGuard.pendingRender = true;
      return;
    }
    petCardsContainer.innerHTML = '';
    if (latestPets.length === 0) {
      petCardsContainer.appendChild(createEmptyState(t('feature.xpTracker.noActivePets')));
      return;
    }
    for (const pet of latestPets) {
      petCardsContainer.appendChild(createPetCard(pet, totalTeamXpPerHour, potionCount, hoverGuard));
    }
  };

  const updateDisplay = (): void => {
    const computed = getXpTrackerComputedStats(latestPets);
    currentWeather = computed.currentWeather;
    latestStats = computed.stats;
    totalTeamXpPerHour = computed.totalTeamXpPerHour;

    updateSummaryStrip(summaryStrip, latestStats, totalTeamXpPerHour, currentWeather, latestPets.length);
    renderPetCards();
    renderNearMaxSection(nearMaxContainer, nearMaxState, latestPets, totalTeamXpPerHour);
  };

  // -- Subscriptions --
  const throttledPetUpdate = throttle((pets: ActivePetInfo[]) => {
    latestPets = pets;
    updateDisplay();
  }, 500);
  const unsubPets = onActivePetInfos(throttledPetUpdate);
  cleanups.push(unsubPets);

  const unsubXpTracker = onXpTrackerUpdate(() => { renderPetCards(); });
  cleanups.push(unsubXpTracker);

  // Deferred render listener — fires when potion hover ends and a render was pending
  const onDeferredRender = () => { renderPetCards(); };
  window.addEventListener('qpm:xptracker-deferred-render', onDeferredRender);
  cleanups.push(() => window.removeEventListener('qpm:xptracker-deferred-render', onDeferredRender));

  const unsubPotions = onXpPotionCountChange((count) => {
    potionCount = count;
    renderPetCards();
  });
  cleanups.push(unsubPotions);

  const unsubCatalogs = onCatalogsReady(() => {
    renderNearMaxSection(nearMaxContainer, nearMaxState, latestPets, totalTeamXpPerHour);
  });
  cleanups.push(unsubCatalogs);

  // Clean up near-max status timer
  cleanups.push(() => {
    if (nearMaxState.statusTimer != null) {
      window.clearTimeout(nearMaxState.statusTimer);
      nearMaxState.statusTimer = null;
    }
  });

  // -- Idempotent cleanup --
  return () => {
    if (cleaned) return;
    cleaned = true;
    for (const fn of cleanups) fn();
    cleanups.length = 0;
  };
}
