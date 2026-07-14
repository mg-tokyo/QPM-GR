import { onActivePetInfos, type ActivePetInfo } from '../../store/pets';
import { getPetSpriteDataUrlWithMutations } from '../../sprite-v2/compat';
import { getAbilityDefinition, computeAbilityStats, type AbilityDefinition } from '../../features/pets/data/petAbilities';
import { getAbilityColor } from '../../utils/rendering/petCardRenderer';
import { findAbilityHistoryForIdentifiers, onAbilityHistoryUpdate } from '../../store/abilityLogs';
import { formatCoinsAbbreviated } from '../../features/economy/valueCalculator';
import { throttle } from '../../utils/scheduling/scheduling';
import {
  buildAbilityValuationContext,
  resolveDynamicAbilityEffect,
  type AbilityValuationContext,
} from '../../features/pets/abilityValuation';
import { onGardenSnapshot } from '../../features/garden/bridge';
import { visibleInterval } from '../../utils/scheduling/timerManager';
import { t } from '../../i18n';

// ============================================================================
// CONSTANTS
// ============================================================================

const TICKER_INTERVAL_MS = 1000;

// ============================================================================
// PERSISTENT UI STATE — survives re-renders
// ============================================================================

/** Whether each pet card is collapsed. Keyed by pet id/slot. */
const petCardCollapsed = new Map<string, boolean>();

/** Per-pet set of ability IDs that the user has hidden (removed from view). */
const hiddenAbilities = new Map<string, Set<string>>();

/** Per-ability stats visibility. Key = `petKey:abilityId`. True = stats are hidden. */
const abilityStatsHidden = new Map<string, boolean>();

function getCardPetKey(pet: ActivePetInfo): string {
  return pet.petId ?? pet.slotId ?? `slot:${pet.slotIndex}`;
}

// ============================================================================
// TYPES
// ============================================================================

export interface AbilityTrackerTotals {
  procsPerHour: number;
  coinsPerHour: number;
  abilityCount: number;
  petCount: number;
}

// ============================================================================
// UTILITY HELPERS
// ============================================================================

function formatAgo(ts: number | null | undefined): string {
  if (!ts) return '—';
  const ms = Date.now() - ts;
  if (ms < 5000) return t('feature.abilityTracker.justNow');
  if (ms < 60000) return t('feature.abilityTracker.secsAgo', { n: String(Math.floor(ms / 1000)) });
  const mins = Math.floor(ms / 60000);
  if (mins < 60) return t('feature.abilityTracker.minsAgo', { n: String(mins) });
  const hrs = Math.floor(mins / 60);
  return t('feature.abilityTracker.hoursMinAgo', { h: String(hrs), m: String(mins % 60) });
}

/** Format the average interval between procs (shown when no history yet). */
function formatAvgInterval(procsPerHour: number): string {
  if (procsPerHour <= 0) return '—';
  const avgMins = 60 / procsPerHour;
  if (avgMins >= 60) {
    const h = Math.floor(avgMins / 60);
    const m = Math.round(avgMins % 60);
    return m > 0 ? `~${h}h ${m}m` : `~${h}h`;
  }
  if (avgMins >= 1) return `~${Math.round(avgMins)}m`;
  return `~${Math.round(avgMins * 60)}s`;
}

/**
 * Exported utility kept for API compatibility.
 */
export function calculateLiveETA(
  lastProcAt: number,
  expectedMinutesBetween: number | null,
  effectiveProcsPerHour?: number,
): { text: string; isOverdue: boolean } {
  const minutesBetween = effectiveProcsPerHour
    ? effectiveProcsPerHour > 0 ? 60 / effectiveProcsPerHour : null
    : expectedMinutesBetween;
  if (!minutesBetween || minutesBetween <= 0) return { text: '—', isOverdue: false };
  const expectedNextProc = lastProcAt + minutesBetween * 60 * 1000;
  const msRemaining = expectedNextProc - Date.now();
  const abs = Math.abs(msRemaining);
  const h = Math.floor(abs / 3600000);
  const m = Math.floor((abs % 3600000) / 60000);
  const s = Math.floor((abs % 60000) / 1000);
  const prefix = msRemaining < 0 ? '-' : '';
  const text = h > 0 ? `${prefix}${h}h ${m}m` : m > 0 ? `${prefix}${m}m ${s}s` : `${prefix}${s}s`;
  return { text, isOverdue: msRemaining < 0 };
}

// ============================================================================
// PET CARD BUILDING
// ============================================================================

interface ActiveAbility {
  def: AbilityDefinition;
  raw: string;
  procsPerHour: number;
  coinsPerHour: number | null;
  suppressRateDisplay?: boolean;
}

const SUPPRESS_RATE_ABILITY_IDS = new Set(['ProduceMutationBoost', 'ProduceMutationBoostII']);

function resolvePetAbilities(pet: ActivePetInfo, gardenCtx?: AbilityValuationContext): ActiveAbility[] {
  if (!pet.abilities?.length) return [];
  const result: ActiveAbility[] = [];
  for (const raw of pet.abilities) {
    if (!raw) continue;
    const def = getAbilityDefinition(raw);
    if (!def || def.trigger !== 'continuous' || (def.baseProbability ?? 0) <= 0) continue;
    const stats = computeAbilityStats(def, pet.strength);
    let coinsPerHour: number | null = null;
    if (stats.procsPerHour > 0) {
      if (def.effectUnit === 'coins' && def.effectValuePerProc != null) {
        coinsPerHour = stats.procsPerHour * def.effectValuePerProc * (stats.multiplier ?? 1);
      } else if (gardenCtx && def.effectUnit !== 'xp' && def.effectUnit !== 'minutes') {
        try {
          const dynamic = resolveDynamicAbilityEffect(def.id, gardenCtx, pet.strength);
          if (dynamic && dynamic.effectPerProc > 0) {
            coinsPerHour = dynamic.effectPerProc * stats.procsPerHour;
          }
        } catch { /* ignore if garden not ready */ }
      }
    }
    result.push({ def, raw, procsPerHour: stats.procsPerHour, coinsPerHour, suppressRateDisplay: SUPPRESS_RATE_ABILITY_IDS.has(def.id) });
  }
  return result;
}

function buildAbilityRow(
  pet: ActivePetInfo,
  petKey: string,
  ability: ActiveAbility,
  onHide: (abilityId: string) => void,
): HTMLElement {
  const statsKey = `${petKey}:${ability.def.id}`;

  const row = document.createElement('div');
  row.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:8px',
    'padding:6px 0',
    'border-top:1px solid var(--qpm-divider)',
    'cursor:pointer',
    'border-radius:4px',
    'transition:background 0.1s',
  ].join(';');

  // Color dot — click to hide this ability entirely (stopPropagation keeps row click separate)
  const color = getAbilityColor(ability.def.id);
  const dot = document.createElement('div');
  dot.title = t('feature.abilityTracker.hideAbility');
  dot.style.cssText = [
    `background:${color.base}`,
    `box-shadow:0 0 4px ${color.glow}`,
    'width:8px',
    'height:8px',
    'border-radius:50%',
    'flex-shrink:0',
    'cursor:pointer',
    'transition:opacity 0.1s',
  ].join(';');
  dot.addEventListener('mouseenter', () => { dot.style.opacity = '0.4'; });
  dot.addEventListener('mouseleave', () => { dot.style.opacity = '1'; });
  dot.addEventListener('click', (e) => {
    e.stopPropagation();
    row.style.display = 'none'; // immediate feedback
    onHide(ability.def.id);
  });
  row.appendChild(dot);

  // Ability name
  const name = document.createElement('span');
  name.textContent = ability.def.name;
  name.style.cssText = 'flex:1;font-size:12px;color:var(--qpm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  row.appendChild(name);

  // Fixed-width stat columns — widths match the card column header for alignment.
  const procsChip = document.createElement('span');
  if (ability.suppressRateDisplay) {
    procsChip.textContent = '—';
    procsChip.title = t('feature.abilityTracker.rateUnavailable');
    procsChip.style.cssText = 'font-size:10px;font-family:monospace;color:var(--qpm-text-muted);flex-shrink:0;width:52px;text-align:right;';
  } else {
    procsChip.textContent = `${ability.procsPerHour.toFixed(1)}/hr`;
    procsChip.title = t('feature.abilityTracker.expectedProcs');
    procsChip.style.cssText = 'font-size:10px;font-family:monospace;color:var(--qpm-accent);flex-shrink:0;width:52px;text-align:right;';
  }
  row.appendChild(procsChip);

  const coinsChip = document.createElement('span');
  if (ability.suppressRateDisplay) {
    coinsChip.style.cssText = 'flex-shrink:0;width:62px;';
  } else if (ability.coinsPerHour != null && ability.coinsPerHour > 0) {
    coinsChip.textContent = `${formatCoinsAbbreviated(ability.coinsPerHour)}/hr`;
    coinsChip.title = t('feature.abilityTracker.estimatedCoins');
    coinsChip.style.cssText = 'font-size:10px;font-family:monospace;color:var(--qpm-warning);flex-shrink:0;width:62px;text-align:right;';
  } else {
    coinsChip.style.cssText = 'flex-shrink:0;width:62px;';
  }
  row.appendChild(coinsChip);

  // Timer cell: countdown when history known; avg interval when no history yet.
  const history = findAbilityHistoryForIdentifiers(ability.def.id, {
    petId: pet.petId,
    slotId: pet.slotId,
    slotIndex: pet.slotIndex,
  });
  const lastProcAt = history?.lastPerformedAt ?? null;

  const timerEl = document.createElement('span');
  timerEl.style.cssText = 'font-size:10px;white-space:nowrap;flex-shrink:0;width:76px;text-align:right;';
  if (ability.suppressRateDisplay) {
    timerEl.textContent = '—';
    timerEl.style.color = 'var(--qpm-text-muted)';
  } else {
    timerEl.dataset.timerCell = '1';
    timerEl.dataset.lastProc = lastProcAt ? String(lastProcAt) : '';
    timerEl.dataset.procsPerHour = String(ability.procsPerHour);
    updateTimerCell(timerEl);
  }
  row.appendChild(timerEl);

  // Stats visibility toggle — click the row to show/hide procs/coins/timer columns.
  const applyStatsVisibility = () => {
    const hidden = abilityStatsHidden.get(statsKey) ?? false;
    const vis = hidden ? 'none' : '';
    procsChip.style.display = vis;
    coinsChip.style.display = vis;
    timerEl.style.display = vis;
    name.style.opacity = hidden ? '0.55' : '1';
    row.title = hidden ? t('feature.abilityTracker.statsHidden', { name: ability.def.name }) : t('feature.abilityTracker.statsVisible', { name: ability.def.name });
  };

  applyStatsVisibility();

  row.addEventListener('mouseenter', () => { row.style.background = 'var(--qpm-accent-tint)'; });
  row.addEventListener('mouseleave', () => { row.style.background = ''; });
  row.addEventListener('click', () => {
    const nowHidden = !(abilityStatsHidden.get(statsKey) ?? false);
    abilityStatsHidden.set(statsKey, nowHidden);
    applyStatsVisibility();
  });

  return row;
}

function updateTimerCell(el: HTMLElement): void {
  const lastProc = el.dataset.lastProc ? parseInt(el.dataset.lastProc, 10) : null;
  const procsPerHour = el.dataset.procsPerHour ? parseFloat(el.dataset.procsPerHour) : 0;

  if (lastProc && procsPerHour > 0) {
    const { text, isOverdue } = calculateLiveETA(lastProc, null, procsPerHour);
    if (isOverdue) {
      el.textContent = t('feature.abilityTracker.late', { time: text });
      el.style.color = 'var(--qpm-danger)';
    } else {
      el.textContent = t('feature.abilityTracker.next', { time: text });
      el.style.color = 'var(--qpm-accent)';
    }
  } else if (lastProc) {
    el.textContent = formatAgo(lastProc);
    el.style.color = 'var(--qpm-text-muted)';
  } else if (procsPerHour > 0) {
    el.textContent = formatAvgInterval(procsPerHour);
    el.style.color = 'var(--qpm-text-muted)';
  } else {
    el.textContent = '—';
    el.style.color = 'var(--qpm-text-muted)';
  }
}

function buildPetCard(pet: ActivePetInfo, gardenCtx?: AbilityValuationContext): HTMLElement | null {
  const petKey = getCardPetKey(pet);
  const allAbilities = resolvePetAbilities(pet, gardenCtx);
  if (!allAbilities.length) return null;

  const hiddenSet = hiddenAbilities.get(petKey) ?? new Set<string>();
  const visibleAbilities = allAbilities.filter(a => !hiddenSet.has(a.def.id));

  const card = document.createElement('div');
  card.style.cssText = [
    'background:var(--qpm-surface-2)',
    'border:1px solid var(--qpm-border)',
    'border-radius:8px',
    'padding:12px',
    'display:flex',
    'flex-direction:column',
    'gap:4px',
  ].join(';');

  // Card header
  const header = document.createElement('div');
  header.style.cssText = 'display:flex;align-items:center;gap:8px;margin-bottom:4px;cursor:pointer;user-select:none;';

  // Sprite
  const spriteUrl = getPetSpriteDataUrlWithMutations(pet.species ?? '', pet.mutations ?? []);
  if (spriteUrl) {
    const img = document.createElement('img');
    img.src = spriteUrl;
    img.style.cssText = 'width:28px;height:28px;object-fit:contain;image-rendering:pixelated;flex-shrink:0;';
    img.alt = pet.species ?? '';
    header.appendChild(img);
  } else {
    const placeholder = document.createElement('div');
    placeholder.style.cssText = 'width:28px;height:28px;background:rgba(255,255,255,0.05);border-radius:4px;flex-shrink:0;';
    header.appendChild(placeholder);
  }

  // Pet name + strength
  const nameWrap = document.createElement('div');
  nameWrap.style.cssText = 'display:flex;flex-direction:column;gap:2px;overflow:hidden;flex:1;';

  const petName = document.createElement('span');
  petName.textContent = pet.name ?? pet.species ?? t('feature.abilityTracker.slot', { n: String(pet.slotIndex + 1) });
  petName.style.cssText = 'font-size:14px;font-weight:600;color:var(--qpm-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  nameWrap.appendChild(petName);

  const petMeta = document.createElement('span');
  const strText = pet.strength != null ? t('feature.abilityTracker.strValue', { value: String(pet.strength) }) : t('feature.abilityTracker.strUnknown');
  const speciesText = pet.species ? ` · ${pet.species}` : '';
  petMeta.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);';
  nameWrap.appendChild(petMeta);

  header.appendChild(nameWrap);

  // "N hidden" badge — click to restore all hidden abilities for this pet
  let hiddenBadge: HTMLElement | null = null;
  const updateHiddenBadge = () => {
    const currentHidden = hiddenAbilities.get(petKey)?.size ?? 0;
    if (currentHidden > 0) {
      if (!hiddenBadge) {
        hiddenBadge = document.createElement('button');
        hiddenBadge.style.cssText = [
          'background:rgba(255,255,255,0.07)',
          'border:1px solid rgba(255,255,255,0.12)',
          'border-radius:4px',
          'color:var(--qpm-text-muted)',
          'font-size:9px',
          'cursor:pointer',
          'padding:1px 5px',
          'flex-shrink:0',
          'white-space:nowrap',
        ].join(';');
        hiddenBadge.title = t('feature.abilityTracker.showAllHidden');
        hiddenBadge.addEventListener('click', (e) => {
          e.stopPropagation();
          hiddenAbilities.delete(petKey);
          rebuildAbilities();
          updateHiddenBadge();
        });
        header.insertBefore(hiddenBadge, header.lastChild);
      }
      hiddenBadge.textContent = t('feature.abilityTracker.hiddenCount', { count: String(currentHidden) });
    } else if (hiddenBadge) {
      hiddenBadge.remove();
      hiddenBadge = null;
    }
  };

  // Collapse toggle
  const collapseBtn = document.createElement('button');
  collapseBtn.style.cssText = [
    'background:none',
    'border:none',
    'color:var(--qpm-text-muted)',
    'cursor:pointer',
    'font-size:12px',
    'padding:2px 4px',
    'line-height:1',
    'flex-shrink:0',
    'transition:transform 0.15s ease',
  ].join(';');
  header.appendChild(collapseBtn);

  card.appendChild(header);

  // Column header row — labels align with the fixed-width stat columns.
  const colHeader = document.createElement('div');
  colHeader.style.cssText = 'display:flex;align-items:center;gap:8px;padding-bottom:2px;';

  const colHeaderSpacer = document.createElement('span');
  colHeaderSpacer.style.cssText = 'width:8px;flex-shrink:0;';
  colHeader.appendChild(colHeaderSpacer);

  const colHeaderName = document.createElement('span');
  colHeaderName.style.cssText = 'flex:1;';
  colHeader.appendChild(colHeaderName);

  const colHeaderProcs = document.createElement('span');
  colHeaderProcs.textContent = t('feature.abilityTracker.colProcs');
  colHeaderProcs.style.cssText = 'font-size:9px;color:var(--qpm-text-muted);flex-shrink:0;width:52px;text-align:right;';
  colHeader.appendChild(colHeaderProcs);

  const colHeaderCoins = document.createElement('span');
  colHeaderCoins.textContent = t('feature.abilityTracker.colCoins');
  colHeaderCoins.style.cssText = 'font-size:9px;color:var(--qpm-text-muted);flex-shrink:0;width:62px;text-align:right;';
  colHeader.appendChild(colHeaderCoins);

  const colHeaderTimer = document.createElement('span');
  colHeaderTimer.textContent = t('feature.abilityTracker.colNext');
  colHeaderTimer.style.cssText = 'font-size:9px;color:var(--qpm-text-muted);flex-shrink:0;width:76px;text-align:right;';
  colHeader.appendChild(colHeaderTimer);

  card.appendChild(colHeader);

  // Abilities container — rebuilt in place without re-rendering the card
  const abilitiesContainer = document.createElement('div');
  abilitiesContainer.style.cssText = 'display:flex;flex-direction:column;';
  card.appendChild(abilitiesContainer);

  const buildAbilityRows = () => {
    abilitiesContainer.innerHTML = '';
    const currentHidden = hiddenAbilities.get(petKey) ?? new Set<string>();
    const currentVisible = allAbilities.filter(a => !currentHidden.has(a.def.id));
    if (currentVisible.length === 0) {
      const msg = document.createElement('div');
      msg.textContent = t('feature.abilityTracker.allHidden');
      msg.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);font-style:italic;padding:4px 0;';
      abilitiesContainer.appendChild(msg);
    } else {
      for (const ability of currentVisible) {
        abilitiesContainer.appendChild(buildAbilityRow(pet, petKey, ability, (id) => {
          const set = hiddenAbilities.get(petKey) ?? new Set<string>();
          set.add(id);
          hiddenAbilities.set(petKey, set);
          buildAbilityRows();
          updateHiddenBadge();
        }));
      }
    }
  };

  const rebuildAbilities = buildAbilityRows;
  buildAbilityRows();

  // Collapse/expand — persisted across re-renders
  let expanded = !(petCardCollapsed.get(petKey) ?? false);

  const applyCollapseState = () => {
    abilitiesContainer.style.display = expanded ? 'flex' : 'none';
    colHeader.style.display = expanded ? 'flex' : 'none';
    collapseBtn.textContent = expanded ? '▾' : '▸';
    collapseBtn.title = expanded ? t('feature.abilityTracker.collapse') : t('feature.abilityTracker.expand');
    collapseBtn.style.transform = expanded ? 'rotate(0deg)' : 'rotate(-90deg)';
    const strLine = `${strText}${speciesText}`;
    petMeta.textContent = strLine;
  };

  const toggleCollapse = () => {
    expanded = !expanded;
    petCardCollapsed.set(petKey, !expanded);
    applyCollapseState();
  };

  applyCollapseState();
  updateHiddenBadge();

  collapseBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleCollapse(); });
  header.addEventListener('click', toggleCollapse);

  return card;
}

// ============================================================================
// RENDER LOGIC
// ============================================================================

function getTotals(pets: ActivePetInfo[], gardenCtx?: AbilityValuationContext): AbilityTrackerTotals {
  let procsPerHour = 0;
  let coinsPerHour = 0;
  let abilityCount = 0;
  let petCount = 0;
  for (const pet of pets) {
    const abilities = resolvePetAbilities(pet, gardenCtx);
    if (!abilities.length) continue;
    petCount++;
    for (const a of abilities) {
      if (!a.suppressRateDisplay) {
        procsPerHour += a.procsPerHour;
        coinsPerHour += a.coinsPerHour ?? 0;
      }
      abilityCount++;
    }
  }
  return { procsPerHour, coinsPerHour, abilityCount, petCount };
}

export function getAbilityTrackerTotals(pets: ActivePetInfo[]): AbilityTrackerTotals {
  let gardenCtx: AbilityValuationContext | undefined;
  try { gardenCtx = buildAbilityValuationContext(); } catch { /* not ready yet */ }
  return getTotals(pets, gardenCtx);
}

// ============================================================================
// RENDER CONTENT (embeddable — no window chrome)
// ============================================================================

/**
 * Builds ability tracker content inside the given container.
 * Sets up subscriptions for live updates and returns an idempotent cleanup function.
 */
export function renderAbilityTrackerContent(container: HTMLElement): () => void {
  let cleaned = false;
  const cleanups: Array<() => void> = [];

  // -- DOM structure --
  // Summary strip
  const summaryStrip = document.createElement('div');
  summaryStrip.style.cssText = [
    'padding:6px 12px',
    'font-size:12px',
    'color:var(--qpm-text-muted)',
    'border-bottom:1px solid var(--qpm-border)',
    'flex-shrink:0',
    'white-space:nowrap',
    'overflow:hidden',
    'text-overflow:ellipsis',
  ].join(';');
  summaryStrip.dataset.tour = 'ability-summary';
  summaryStrip.textContent = t('common.loading');
  container.appendChild(summaryStrip);

  // Scroll container
  const scrollContent = document.createElement('div');
  scrollContent.style.cssText = 'flex:1;overflow-y:auto;overflow-x:hidden;';

  const contentWrap = document.createElement('div');
  contentWrap.style.cssText = 'padding:12px;display:flex;flex-direction:column;gap:8px;';

  const cardsContainer = document.createElement('div');
  cardsContainer.style.cssText = 'display:flex;flex-direction:column;gap:8px;';
  cardsContainer.dataset.tour = 'ability-cards';
  contentWrap.appendChild(cardsContainer);
  scrollContent.appendChild(contentWrap);
  container.appendChild(scrollContent);

  // Footer hint
  const footerHint = document.createElement('div');
  footerHint.textContent = t('feature.abilityTracker.footerHint');
  footerHint.style.cssText = [
    'padding:4px 12px',
    'font-size:10px',
    'color:var(--qpm-text-muted)',
    'text-align:center',
    'border-top:1px solid var(--qpm-border)',
    'flex-shrink:0',
    'user-select:none',
  ].join(';');
  footerHint.dataset.tour = 'ability-hint';
  container.appendChild(footerHint);

  // -- Internal state --
  let latestPets: ActivePetInfo[] = [];
  let timerCells: HTMLElement[] = [];
  let lastRenderSig: string | null = null;

  const buildRenderSignature = (pets: ActivePetInfo[]): string => {
    const parts: string[] = [String(pets.length)];
    for (const pet of pets) {
      const petKey = getCardPetKey(pet);
      const abilities = (pet.abilities ?? []).join(',');
      const strBucket = pet.strength != null ? Math.floor(pet.strength / 5) : 'x';
      let procsSig = '';
      for (const raw of pet.abilities ?? []) {
        if (!raw) continue;
        const h = findAbilityHistoryForIdentifiers(raw, {
          petId: pet.petId,
          slotId: pet.slotId,
          slotIndex: pet.slotIndex,
        });
        procsSig += `${raw}:${h?.lastPerformedAt ?? 0};`;
      }
      parts.push(`${petKey}|${pet.species ?? ''}|${abilities}|${strBucket}|${pet.targetScale ?? ''}|${(pet.mutations ?? []).join(',')}|${procsSig}`);
    }
    return parts.join('\n');
  };

  // -- Render function --
  const render = () => {
    const activePets = latestPets;
    const sig = buildRenderSignature(activePets);
    if (sig === lastRenderSig) return;
    lastRenderSig = sig;

    let gardenCtx: AbilityValuationContext | undefined;
    try { gardenCtx = buildAbilityValuationContext(); } catch { /* not ready yet */ }

    const totals = getTotals(activePets, gardenCtx);
    const summaryParts: string[] = [
      totals.petCount !== 1 ? t('feature.abilityTracker.summaryPets', { count: String(totals.petCount) }) : t('feature.abilityTracker.summaryPet', { count: String(totals.petCount) }),
      totals.abilityCount !== 1 ? t('feature.abilityTracker.summaryAbilities', { count: String(totals.abilityCount) }) : t('feature.abilityTracker.summaryAbility', { count: String(totals.abilityCount) }),
      t('feature.abilityTracker.summaryProcs', { rate: totals.procsPerHour.toFixed(1) }),
    ];
    if (totals.coinsPerHour > 0) {
      summaryParts.push(t('feature.abilityTracker.summaryCoins', { rate: formatCoinsAbbreviated(totals.coinsPerHour) }));
    }
    summaryStrip.textContent = summaryParts.join(' · ');

    cardsContainer.innerHTML = '';

    if (!activePets.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:24px;text-align:center;color:var(--qpm-text-muted);font-size:12px;';
      empty.textContent = t('feature.abilityTracker.noPets');
      cardsContainer.appendChild(empty);
      return;
    }

    let hasCards = false;
    for (const pet of activePets) {
      const card = buildPetCard(pet, gardenCtx);
      if (card) {
        cardsContainer.appendChild(card);
        hasCards = true;
      }
    }

    if (!hasCards) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:24px;text-align:center;color:var(--qpm-text-muted);font-size:12px;';
      empty.textContent = t('feature.abilityTracker.noAbilities');
      cardsContainer.appendChild(empty);
    }

    timerCells = Array.from(cardsContainer.querySelectorAll<HTMLElement>('[data-timer-cell]'));
  };

  // -- Subscriptions --
  const throttledRender = throttle((pets: ActivePetInfo[]) => {
    latestPets = pets;
    render();
  }, 400);
  const unsubPets = onActivePetInfos(throttledRender);
  cleanups.push(unsubPets);

  const throttledHistoryRender = throttle(() => { render(); }, 400);
  const unsubHistory = onAbilityHistoryUpdate(() => { throttledHistoryRender(); });
  cleanups.push(unsubHistory);

  const throttledGardenRender = throttle(() => { render(); }, 2000);
  const unsubGarden = onGardenSnapshot(() => { throttledGardenRender(); });
  cleanups.push(unsubGarden);

  // -- Ticker (1s timer updates) --
  const tickerCleanup = visibleInterval('ability-tracker-tick', () => {
    for (const el of timerCells) {
      updateTimerCell(el);
    }
  }, TICKER_INTERVAL_MS);
  cleanups.push(tickerCleanup);

  // Tour system: check for first-time tour and inject replay button
  import('../tour').then(({ checkTour, injectReplayButton }) => {
    checkTour('trackers-v2-ability', container);
    injectReplayButton('trackers-v2-ability');
  });

  // -- Idempotent cleanup --
  return () => {
    if (cleaned) return;
    cleaned = true;
    for (const fn of cleanups) fn();
    cleanups.length = 0;
  };
}
