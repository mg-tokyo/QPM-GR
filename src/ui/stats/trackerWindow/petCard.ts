import type { ActivePetInfo } from '../../../store/pets';
import { getPetSpriteDataUrlWithMutations } from '../../../sprite-v2/compat';
import { getAbilityColor } from '../../../utils/rendering/petCardRenderer';
import { findAbilityHistoryForIdentifiers } from '../../../store/abilityLogs';
import { formatCoinsAbbreviated } from '../../../features/economy/valueCalculator';
import type { AbilityValuationContext } from '../../../features/pets/abilityValuation';
import { t } from '../../../i18n';
import { resolvePetAbilities, type ActiveAbility } from './abilities';
import { updateTimerCell } from './timing';

// Persistent UI state — survives re-renders.

/** Whether each pet card is collapsed. Keyed by pet id/slot. */
const petCardCollapsed = new Map<string, boolean>();

/** Per-pet set of ability IDs that the user has hidden (removed from view). */
const hiddenAbilities = new Map<string, Set<string>>();

/** Per-ability stats visibility. Key = `petKey:abilityId`. True = stats are hidden. */
const abilityStatsHidden = new Map<string, boolean>();

export function getCardPetKey(pet: ActivePetInfo): string {
  return pet.petId ?? pet.slotId ?? `slot:${pet.slotIndex}`;
}

/** PD2: muted full-day line only when the rounded average differs from the live cells. */
function buildDayAverageLine(ability: ActiveAbility, procsText: string, coinsText: string): HTMLElement | null {
  if (ability.dayAverageProcsPerHour == null) return null;
  const avgProcsText = ability.dayAverageProcsPerHour.toFixed(1);
  const avgCoins = ability.dayAverageCoinsPerHour;
  const avgCoinsText = avgCoins != null && avgCoins > 0 ? formatCoinsAbbreviated(avgCoins) : '';
  if (avgProcsText === procsText && avgCoinsText === coinsText) return null;
  const line = document.createElement('span');
  line.textContent = avgCoinsText
    ? t('feature.abilityTracker.dayAverageRow', { procs: avgProcsText, coins: avgCoinsText })
    : t('feature.abilityTracker.dayAverageRowProcs', { procs: avgProcsText });
  line.style.cssText = 'flex-basis:100%;padding-left:16px;font-size:10px;color:var(--qpm-text-muted);';
  return line;
}

/** e.g. "Midnight +20 STR"; shown at every stage for a nocturnal pet (PD2). */
function stageLabelFor(abilities: readonly ActiveAbility[]): string | null {
  const first = abilities[0];
  if (!first?.isNocturnal || first.stage === null) return null;
  const stage = first.stage.charAt(0).toUpperCase() + first.stage.slice(1);
  return t('feature.xpTracker.stageBonus', { stage, bonus: String(first.stageBonus) });
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
    'flex-wrap:wrap',
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
  if (ability.inactiveWeather) {
    const weatherTag = document.createElement('span');
    weatherTag.textContent = ability.inactiveWeather;
    weatherTag.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);flex-shrink:0;white-space:nowrap;';
    row.appendChild(weatherTag);
    row.style.opacity = '0.55';
  }

  // Fixed-width stat columns — widths match the card column header for alignment.
  const procsText = ability.procsPerHour.toFixed(1);
  const procsChip = document.createElement('span');
  procsChip.textContent = t('feature.abilityTracker.perHour', { rate: procsText });
  procsChip.title = t('feature.abilityTracker.expectedProcs');
  procsChip.style.cssText = 'font-size:10px;font-family:monospace;color:var(--qpm-accent);flex-shrink:0;width:52px;text-align:right;';
  row.appendChild(procsChip);

  const hasCoins = ability.coinsPerHour != null && ability.coinsPerHour > 0;
  const coinsText = hasCoins ? formatCoinsAbbreviated(ability.coinsPerHour ?? 0) : '';
  const coinsChip = document.createElement('span');
  if (hasCoins) {
    coinsChip.textContent = t('feature.abilityTracker.perHour', { rate: coinsText });
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
  timerEl.dataset.timerCell = '1';
  timerEl.dataset.lastProc = lastProcAt ? String(lastProcAt) : '';
  timerEl.dataset.procsPerHour = String(ability.procsPerHour);
  updateTimerCell(timerEl);
  row.appendChild(timerEl);

  const dayAverageEl = buildDayAverageLine(ability, procsText, coinsText);
  if (dayAverageEl) row.appendChild(dayAverageEl);

  // Stats visibility toggle — click the row to show/hide procs/coins/timer columns.
  const applyStatsVisibility = () => {
    const hidden = abilityStatsHidden.get(statsKey) ?? false;
    const vis = hidden ? 'none' : '';
    procsChip.style.display = vis;
    coinsChip.style.display = vis;
    timerEl.style.display = vis;
    if (dayAverageEl) dayAverageEl.style.display = vis;
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

export function buildPetCard(pet: ActivePetInfo, gardenCtx?: AbilityValuationContext): HTMLElement | null {
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
    // eslint-disable-next-line qpm/no-hardcoded-colors -- baseline relocated from trackerWindow.ts by REL-6.6 (pure split); no token has this white alpha.
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
  const stageLabel = stageLabelFor(allAbilities);
  const stageText = stageLabel ? ` · ${stageLabel}` : '';
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
          // eslint-disable-next-line qpm/no-hardcoded-colors -- baseline relocated from trackerWindow.ts by REL-6.6 (pure split); no token has this white alpha.
          'background:rgba(255,255,255,0.07)',
          // eslint-disable-next-line qpm/no-hardcoded-colors -- baseline relocated from trackerWindow.ts by REL-6.6 (pure split); no token has this white alpha.
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
    const strLine = `${strText}${speciesText}${stageText}`;
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
