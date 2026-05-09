// src/ui/xpTracker/xpTrackerContent.ts — XP Tracker content (renders inside modalWindow or hub card)

import { formatCoins } from '../../features/valueCalculator';
import { log } from '../../utils/logger';
import { onActivePetInfos, type ActivePetInfo } from '../../store/pets';
import { getPetSpriteDataUrlWithMutations, getAnySpriteDataUrl } from '../../sprite-v2/compat';
import {
  calculateXpStats,
  getCombinedXpStats,
  getSpeciesXpPerLevel,
  calculateMaxStrength,
  calculateTimeToLevel,
  onXpTrackerUpdate,
  type XpAbilityStats,
} from '../../store/xpTracker';
import { getAbilityDefinition, type AbilityDefinition } from '../../data/petAbilities';
import { getAbilityColor } from '../../utils/petCardRenderer';
import { getHungerCapOrDefault } from '../../data/petHungerCaps';
import { calculateFeedsPerLevel } from '../../data/petHungerDepletion';
import { throttle } from '../../utils/scheduling';
import { getWeatherSnapshot } from '../../store/weatherHub';
import type { DetailedWeather } from '../../utils/weatherDetection';
import { getAbilityName } from '../../utils/catalogHelpers';
import { onCatalogsReady } from '../../catalogs/gameCatalogs';
import { t } from '../../i18n';
import { renderNearMaxSection, type NearMaxState } from './nearMaxSection';
import {
  getXpPotionCount,
  onXpPotionCountChange,
  isPetEligibleForXpPotion,
  projectXpPotion,
  sendUseXpPotion,
  XP_POTION_AMOUNT,
} from '../../features/xpPotion';

// ============================================================================
// CONSTANTS
// ============================================================================

const WEATHER_ICONS: Record<string, string> = {
  snow: '❄️', rain: '🌧️', dawn: '🌅', amber: '🌕', sunny: '☀️',
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
    'font-size:11px',
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
    'font-size:11px',
    'border-radius:10px',
    'cursor:pointer',
    `font-weight:${active ? '600' : '400'}`,
    `background:${active ? 'var(--qpm-accent,#4CAF50)' : 'rgba(255,255,255,0.06)'}`,
    `color:${active ? '#fff' : 'var(--qpm-text-muted,#888)'}`,
    `border:1px solid ${active ? 'var(--qpm-accent,#4CAF50)' : 'rgba(255,255,255,0.12)'}`,
    'transition:all 0.15s ease',
  ].join(';');
  return btn;
}

function createCollapsible(titleText: string, startExpanded: boolean): { wrapper: HTMLElement; content: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.style.borderTop = '1px solid var(--qpm-border,#2a2a2a)';

  const header = document.createElement('div');
  header.style.cssText = [
    'display:flex',
    'align-items:center',
    'justify-content:space-between',
    'padding:8px 14px',
    'cursor:pointer',
    'user-select:none',
    'background:var(--qpm-surface-1,#141414)',
  ].join(';');

  const titleEl = document.createElement('span');
  titleEl.textContent = titleText;
  titleEl.style.cssText = 'color:var(--qpm-text,#fff);font-size:12px;font-weight:600;pointer-events:none;';

  const chevron = document.createElement('span');
  chevron.textContent = startExpanded ? '▼' : '▶';
  chevron.style.cssText = 'color:var(--qpm-text-muted,#555);font-size:9px;pointer-events:none;';

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
// POTION PROJECTION COLORS
// ============================================================================

const POTION_COLOR = '#64d2ff';
const POTION_GLOW = 'rgba(100,210,255,0.45)';
const POTION_BG = 'rgba(100,210,255,0.12)';
const POTION_BORDER = 'rgba(100,210,255,0.35)';

// ============================================================================
// PET CARD
// ============================================================================

/** Shared mutable flag — set by any card's potion hover to suppress re-renders. */
interface HoverGuard { hovering: boolean; pendingRender: boolean }

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
    'background:var(--qpm-surface-2,#1a1a1a)',
    'border:1px solid var(--qpm-border,#2a2a2a)',
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
  nameEl.style.cssText = 'font-weight:600;color:var(--qpm-text,#fff);font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
  nameBlock.appendChild(nameEl);

  if (pet.name && pet.species) {
    const sub = document.createElement('div');
    sub.textContent = pet.species;
    sub.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#555);margin-top:1px;';
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
    strEl.style.cssText = 'font-weight:700;font-family:monospace;font-size:13px;color:var(--qpm-accent,#4CAF50);white-space:nowrap;';
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
      maxEl.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#666);font-family:monospace;margin-top:1px;';
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
      maxMsg.style.cssText = 'font-size:11px;color:var(--qpm-accent,#4CAF50);font-weight:600;';
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
      fill.style.cssText = `width:${pct.toFixed(1)}%;height:100%;background:linear-gradient(90deg,var(--qpm-accent,#4CAF50),#8BC34A);border-radius:4px;`;
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
      barLbl.style.cssText = 'display:flex;justify-content:space-between;font-size:10px;color:var(--qpm-text-muted,#666);font-family:monospace;';
      barLblOrigHtml = `<span>${formatCoins(xpToNext)} / ${formatCoins(xpPerLevel)}</span><span>${pct.toFixed(1)}%</span>`;
      barLbl.innerHTML = barLblOrigHtml;
      barWrap.appendChild(barLbl);
      card.appendChild(barWrap);

      // Time chips row
      const chips = document.createElement('div');
      chips.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px;align-items:center;';

      if (teamXpPerHour > 0) {
        const timeToNext = calculateTimeToLevel(xpToNext, xpPerLevel, teamXpPerHour);
        if (timeToNext) {
          chips.appendChild(makeChip(`⏱ ${t('feature.xpTracker.nextLevel', { time: formatTime(timeToNext.totalMinutes) })}`, 'var(--qpm-positive,#4CAF50)'));
        }

        const levelsLeft = maxStr - pet.strength;
        const xpToMax = (xpPerLevel - xpToNext) + xpPerLevel * (levelsLeft - 1);
        const minsToMax = (xpToMax / teamXpPerHour) * 60;
        chips.appendChild(makeChip(`🏁 ${t('feature.xpTracker.toMax', { time: formatTime(minsToMax) })}`, 'var(--qpm-warning,#FF9800)'));

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
        chips.appendChild(makeChip(t('feature.xpTracker.noXpRate'), 'var(--qpm-text-muted,#555)'));
      }

      if (chips.children.length > 0) card.appendChild(chips);
    }
  } else if (!xpPerLevel && pet.species) {
    const note = document.createElement('div');
    note.textContent = t('feature.xpTracker.xpLoading');
    note.style.cssText = 'font-size:10px;color:var(--qpm-text-muted,#444);font-style:italic;';
    card.appendChild(note);
  }

  return card;
}

// ============================================================================
// POTION BUTTON (extracted to keep createPetCard readable)
// ============================================================================

function createPotionButton(
  pet: ActivePetInfo,
  potionCount: number,
  xpPerLevel: number,
  maxStr: number,
  currentPct: number,
  xpToNext: number,
  projectionFill: HTMLElement | null,
  strProjection: HTMLElement | null,
  barLbl: HTMLElement | null,
  barLblOrigHtml: string,
  hoverGuard: HoverGuard,
): HTMLElement {
  const btn = document.createElement('button');
  btn.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'gap:4px',
    'padding:2px 8px 2px 5px',
    'font-size:10px',
    'border-radius:10px',
    'cursor:pointer',
    `background:${POTION_BG}`,
    `color:${POTION_COLOR}`,
    `border:1px solid ${POTION_BORDER}`,
    'font-weight:600',
    'white-space:nowrap',
    'transition:background 0.15s ease,box-shadow 0.15s ease',
    'flex-shrink:0',
  ].join(';');

  // Potion sprite
  const potionUrl = getAnySpriteDataUrl('sprite/item/XPPotion')
    ?? getAnySpriteDataUrl('item/XPPotion');
  if (potionUrl) {
    const img = document.createElement('img');
    img.src = potionUrl;
    img.alt = 'XP Potion';
    img.style.cssText = 'width:14px;height:14px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';
    btn.appendChild(img);
  }

  const label = document.createElement('span');
  label.textContent = `×${potionCount}`;
  btn.appendChild(label);

  // Hover glow
  btn.addEventListener('mouseenter', () => {
    btn.style.boxShadow = `0 0 8px ${POTION_GLOW}`;
    btn.style.background = 'rgba(100,210,255,0.2)';
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.boxShadow = 'none';
    btn.style.background = POTION_BG;
  });

  // Projection — compute once, toggle on hover
  const proj = projectXpPotion(pet.xp!, pet.strength!, xpPerLevel, maxStr);
  const projPct = proj.reachesMax ? 100 : proj.pctOfLevel;
  const projBarWidth = proj.levelsGained > 0
    ? (100 - currentPct)
    : Math.max(0, projPct - currentPct);

  const showProjection = () => {
    hoverGuard.hovering = true;
    if (projectionFill) {
      projectionFill.style.left = `${currentPct.toFixed(1)}%`;
      projectionFill.style.width = `${projBarWidth.toFixed(1)}%`;
      projectionFill.style.opacity = '0.7';
    }
    if (strProjection) {
      strProjection.textContent = ` → ${proj.newStrength}`;
      strProjection.style.display = 'inline';
    }
    if (barLbl) {
      if (proj.levelsGained > 0) {
        barLbl.innerHTML = `<span style="color:${POTION_COLOR};text-shadow:0 0 4px ${POTION_GLOW}">${formatCoins(proj.xpIntoLevel)} / ${formatCoins(xpPerLevel)}</span><span style="color:${POTION_COLOR};text-shadow:0 0 4px ${POTION_GLOW}">${projPct.toFixed(1)}% (${proj.reachesMax ? 'MAX' : `+${proj.levelsGained} STR`})</span>`;
      } else {
        barLbl.innerHTML = `<span>${formatCoins(xpToNext)} <span style="color:${POTION_COLOR};text-shadow:0 0 4px ${POTION_GLOW}">→ ${formatCoins(proj.xpIntoLevel)}</span> / ${formatCoins(xpPerLevel)}</span><span>${currentPct.toFixed(1)}% <span style="color:${POTION_COLOR};text-shadow:0 0 4px ${POTION_GLOW}">→ ${projPct.toFixed(1)}%</span></span>`;
      }
    }
  };

  const hideProjection = () => {
    hoverGuard.hovering = false;
    if (projectionFill) {
      projectionFill.style.width = '0';
      projectionFill.style.opacity = '0';
    }
    if (strProjection) {
      strProjection.style.display = 'none';
    }
    if (barLbl) {
      barLbl.innerHTML = barLblOrigHtml;
    }
    // Flush any render that was deferred while hovering
    if (hoverGuard.pendingRender) {
      hoverGuard.pendingRender = false;
      // Dispatch async so mouseleave finishes first
      queueMicrotask(() => {
        if (!hoverGuard.hovering) {
          window.dispatchEvent(new CustomEvent('qpm:xptracker-deferred-render'));
        }
      });
    }
  };

  btn.addEventListener('mouseenter', showProjection);
  btn.addEventListener('mouseleave', hideProjection);

  // Click handler
  btn.addEventListener('click', async () => {
    if (!pet.slotId) return;
    btn.disabled = true;
    hideProjection();
    const origChildren = Array.from(btn.childNodes);
    btn.textContent = t('feature.xpTracker.potionUsing');
    btn.style.opacity = '0.6';

    const result = await sendUseXpPotion(pet.slotId);
    if (result.ok) {
      btn.textContent = t('feature.xpTracker.potionUsed');
      btn.style.color = 'var(--qpm-accent,#4CAF50)';
    } else {
      btn.textContent = t('feature.xpTracker.potionFailed');
      btn.style.color = 'var(--qpm-negative,#f44336)';
    }

    setTimeout(() => {
      btn.textContent = '';
      for (const child of origChildren) btn.appendChild(child);
      btn.style.opacity = '1';
      btn.style.color = POTION_COLOR;
      btn.disabled = false;
    }, 1500);
  });

  return btn;
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
    el.appendChild(frag(petCount !== 1 ? t('feature.xpTracker.petCounts', { count: String(petCount) }) : t('feature.xpTracker.petCount', { count: String(petCount) }), 'var(--qpm-text-muted,#666)'));
    el.appendChild(frag('·', 'var(--qpm-border,#444)'));
    el.appendChild(frag(t('feature.xpTracker.baseXpRate'), 'var(--qpm-warning,#FF9800)'));
    el.appendChild(frag(t('feature.xpTracker.baseNoAbilities'), 'var(--qpm-text-muted,#444)'));
  } else {
    el.appendChild(frag(t('feature.xpTracker.base'), 'var(--qpm-text-muted,#666)'));
    el.appendChild(frag('3,600', 'var(--qpm-warning,#FF9800)'));
    el.appendChild(frag('+', 'var(--qpm-text-muted,#444)'));
    el.appendChild(frag(t('feature.xpTracker.ability'), 'var(--qpm-text-muted,#666)'));
    el.appendChild(frag(`+${formatCoins(abilityXp)}`, 'var(--qpm-warning,#FF9800)'));
    el.appendChild(frag('=', 'var(--qpm-text-muted,#444)'));

    const total = frag(t('feature.xpTracker.xpPerHour', { rate: formatCoins(teamXpPerHour) }), 'var(--qpm-accent,#4CAF50)');
    total.style.fontWeight = '700';
    total.style.fontSize = '12px';
    el.appendChild(total);

    el.appendChild(frag(`· ${stats.length === 1 ? t('feature.xpTracker.xpPetCount', { count: String(stats.length) }) : t('feature.xpTracker.xpPetCounts', { count: String(stats.length) })}`, 'var(--qpm-text-muted,#555)'));
  }

  if (weatherLabel) {
    const wChip = document.createElement('span');
    wChip.textContent = `${weatherIcon} ${weatherLabel}`;
    wChip.style.cssText = 'margin-left:auto;color:var(--qpm-text-muted,#666);font-size:11px;';
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
    'background:var(--qpm-surface-1,#111)',
    'border-bottom:1px solid var(--qpm-border,#2a2a2a)',
    'font-size:11px',
    'font-family:monospace',
    'color:var(--qpm-text-muted,#777)',
    'flex-shrink:0',
  ].join(';');
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

  const loadingCard = document.createElement('div');
  loadingCard.textContent = t('common.loading');
  loadingCard.style.cssText = 'padding:12px;color:var(--qpm-text-muted,#555);font-style:italic;font-size:12px;';
  petCardsContainer.appendChild(loadingCard);

  activeSec.content.appendChild(petCardsContainer);
  contentWrap.appendChild(activeSec.wrapper);

  // Near Max Level section (collapsed by default)
  const nearMaxSec = createCollapsible(`🏆 ${t('feature.xpTracker.nearMaxLevel')}`, false);
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
      const empty = document.createElement('div');
      empty.textContent = t('feature.xpTracker.noActivePets');
      empty.style.cssText = 'padding:18px;color:var(--qpm-text-muted,#555);font-style:italic;text-align:center;font-size:12px;';
      petCardsContainer.appendChild(empty);
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
