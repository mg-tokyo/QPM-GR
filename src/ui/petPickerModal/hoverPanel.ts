// src/ui/petPickerModal/hoverPanel.ts
// Hover detail panel for the pet picker modal.

import { getAbilityColor } from '../../utils/petCardRenderer';
import { getAbilityDefinition, computeAbilityStats, computeEffectPerHour, type AbilityDefinition } from '../../data/petAbilities';
import { findAbilityHistoryForIdentifiers } from '../../store/abilityLogs';
import { computeObservedMetrics } from '../abilityAnalysis';
import { calculateMaxStrength, getSpeciesXpPerLevel } from '../../store/xpTracker';
import { formatCoinsAbbreviated } from '../../features/economy/valueCalculator';
import { getPetMetadata } from '../../data/petMetadata';
import { getHungerDepletionTime } from '../../data/petHungerDepletion';
import { buildAbilityValuationContext, resolveDynamicAbilityEffect, type AbilityValuationContext } from '../../features/abilityValuation';
import type { PooledPet } from '../../types/petTeams';
import { getMutationTier, getTierLabel, getLocationLabel, getSpriteSrc } from './helpers';
import { isEventTriggeredAbility, getTriggerLabel, formatProcValue } from './comparePanel';

// ---------------------------------------------------------------------------
// Ability metric summary
// ---------------------------------------------------------------------------

export function getAbilityMetric(
  abilityId: string,
  strength: number | null | undefined,
  valuationContext: AbilityValuationContext | null,
): string {
  const def = getAbilityDefinition(abilityId);
  if (!def) return '';
  const stats = computeAbilityStats(def, strength ?? null);
  if (!stats) return '';

  if (isEventTriggeredAbility(def)) {
    const triggerChance = Math.max(0, Math.min(100, stats.chancePerMinute));
    let valuePerProc = 0;
    if (valuationContext) {
      const dynamic = resolveDynamicAbilityEffect(abilityId, valuationContext, strength ?? null);
      if (dynamic && Number.isFinite(dynamic.effectPerProc) && dynamic.effectPerProc > 0) {
        valuePerProc = dynamic.effectPerProc;
      }
    }
    if (valuePerProc <= 0 && Number.isFinite(def.effectValuePerProc) && (def.effectValuePerProc ?? 0) > 0) {
      valuePerProc = def.effectValuePerProc!;
    }
    if (valuePerProc > 0) {
      return `${getTriggerLabel(def)} ${triggerChance.toFixed(1)}% · ${formatProcValue(def, valuePerProc)}`;
    }
    return `${getTriggerLabel(def)} ${triggerChance.toFixed(1)}%`;
  }

  const effectPerHour = computeEffectPerHour(def, stats, strength);
  if (def.effectUnit === 'coins' && effectPerHour > 0) {
    return `~${formatCoinsAbbreviated(Math.round(effectPerHour))} $/hr`;
  }
  if ((def.category === 'plantGrowth' || def.category === 'eggGrowth') && effectPerHour > 0) {
    return `~${effectPerHour.toFixed(1)} min/hr`;
  }
  if (def.category === 'xp' && effectPerHour > 0) {
    return `~${formatCoinsAbbreviated(Math.round(effectPerHour))} xp/hr`;
  }
  if (stats.procsPerHour > 0) {
    return `${stats.procsPerHour.toFixed(1)} proc/hr`;
  }
  return '';
}

// ---------------------------------------------------------------------------
// Bar row element builder
// ---------------------------------------------------------------------------

function makeBarRow(label: string, value: number, max: number, color: string, suffix = ''): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'qpm-hover__bar-row';

  const labelRow = document.createElement('div');
  labelRow.className = 'qpm-hover__bar-label-row';
  const lbl = document.createElement('span');
  lbl.className = 'qpm-hover__bar-label';
  lbl.textContent = label;
  const val = document.createElement('span');
  val.className = 'qpm-hover__bar-value';
  val.textContent = `${value}${suffix} / ${max}${suffix}`;
  labelRow.appendChild(lbl);
  labelRow.appendChild(val);
  wrap.appendChild(labelRow);

  const track = document.createElement('div');
  track.className = 'qpm-hover__bar-track';
  const fill = document.createElement('div');
  fill.className = 'qpm-hover__bar-fill';
  fill.style.width = `${Math.min(100, Math.max(0, (value / Math.max(max, 1)) * 100))}%`;
  fill.style.background = color;
  track.appendChild(fill);
  wrap.appendChild(track);

  return wrap;
}

// ---------------------------------------------------------------------------
// Hover panel builder
// ---------------------------------------------------------------------------

export function buildHoverPanel(pet: PooledPet, panel: HTMLElement): void {
  panel.innerHTML = '';
  panel.className = 'qpm-picker__hover-panel';
  let valuationContext: AbilityValuationContext | null = null;
  try {
    valuationContext = buildAbilityValuationContext();
  } catch {
    valuationContext = null;
  }

  // --- Sprite section ---
  const spriteSection = document.createElement('div');
  spriteSection.className = 'qpm-hover__sprite-section';

  const tier = getMutationTier(pet.mutations);
  const spriteSrc = getSpriteSrc(pet.species, pet.mutations);
  if (spriteSrc) {
    const img = document.createElement('img');
    img.className = 'qpm-hover__sprite';
    img.src = spriteSrc;
    img.alt = pet.species;
    if (tier === 'rainbow') {
      img.style.filter = 'drop-shadow(0 0 6px rgba(200,100,255,0.6))';
    } else if (tier === 'gold') {
      img.style.filter = 'drop-shadow(0 0 6px rgba(255,215,0,0.5))';
    }
    spriteSection.appendChild(img);
  } else {
    const ph = document.createElement('div');
    ph.className = 'qpm-hover__sprite-placeholder';
    ph.textContent = '🐾';
    spriteSection.appendChild(ph);
  }
  panel.appendChild(spriteSection);

  // --- Identity row ---
  const idRow = document.createElement('div');
  idRow.className = 'qpm-hover__id-row';

  const nameEl = document.createElement('div');
  nameEl.className = 'qpm-hover__name';
  nameEl.textContent = pet.name || pet.species;
  idRow.appendChild(nameEl);

  const locBadge = document.createElement('span');
  locBadge.className = `qpm-hover__location-badge qpm-hover__location-badge--${pet.location}`;
  locBadge.textContent = getLocationLabel(pet.location);
  idRow.appendChild(locBadge);

  panel.appendChild(idRow);

  // --- Species + tier row ---
  const speciesRow = document.createElement('div');
  speciesRow.className = 'qpm-hover__species-row';
  speciesRow.textContent = pet.species;
  if (tier !== 'none') {
    const tierBadge = document.createElement('span');
    tierBadge.className = 'qpm-hover__tier-badge';
    tierBadge.textContent = getTierLabel(tier);
    tierBadge.title = tier;
    speciesRow.appendChild(tierBadge);
  }
  panel.appendChild(speciesRow);

  // --- Stats section ---
  const statsSection = document.createElement('div');
  statsSection.className = 'qpm-hover__section';

  const statsTitle = document.createElement('div');
  statsTitle.className = 'qpm-hover__section-title';
  statsTitle.textContent = 'Stats';
  statsSection.appendChild(statsTitle);

  const maxStr = calculateMaxStrength(pet.targetScale, pet.species);

  // STR bar
  if (pet.strength != null) {
    const barMax = maxStr ?? Math.max(100, pet.strength);
    statsSection.appendChild(makeBarRow('STR', pet.strength, barMax, '#8f82ff'));
  }

  // Max STR bar (if different from current)
  if (maxStr != null && (pet.strength == null || pet.strength < maxStr)) {
    const row = document.createElement('div');
    row.className = 'qpm-hover__bar-label-row';
    const lbl = document.createElement('span');
    lbl.className = 'qpm-hover__bar-label';
    lbl.textContent = 'Max STR';
    const val = document.createElement('span');
    val.className = 'qpm-hover__bar-value';
    val.textContent = String(maxStr);
    row.appendChild(lbl);
    row.appendChild(val);
    statsSection.appendChild(row);
  }

  // XP bar
  if (pet.xp != null && maxStr != null && pet.strength != null && pet.strength < maxStr) {
    const xpPerLevel = getSpeciesXpPerLevel(pet.species);
    if (xpPerLevel && xpPerLevel > 0) {
      const levelsToMax = maxStr - pet.strength;
      const xpForMax = levelsToMax * xpPerLevel;
      const xpProgress = xpForMax > 0 ? pet.xp / (pet.xp + xpForMax) : 1;
      statsSection.appendChild(makeBarRow('XP', Math.round(xpProgress * 100), 100, '#6eb5ff', '%'));
      const xpNote = document.createElement('div');
      xpNote.className = 'qpm-hover__xp-note';
      xpNote.textContent = `${pet.xp.toLocaleString()} XP earned`;
      statsSection.appendChild(xpNote);
    }
  }

  // Hunger bar
  if (pet.hunger != null) {
    statsSection.appendChild(makeBarRow('Hunger', Math.round(pet.hunger), 100, '#64ff96', '%'));
  }

  panel.appendChild(statsSection);

  // --- Mutations ---
  if (pet.mutations.length > 0) {
    const mutSection = document.createElement('div');
    mutSection.className = 'qpm-hover__section';
    const mutTitle = document.createElement('div');
    mutTitle.className = 'qpm-hover__section-title';
    mutTitle.textContent = 'Mutations';
    mutSection.appendChild(mutTitle);
    const pillWrap = document.createElement('div');
    pillWrap.className = 'qpm-hover__mutation-list';
    for (const m of pet.mutations) {
      const pill = document.createElement('span');
      const isRainbow = /rainbow/i.test(m);
      const isGold = /gold(?:en)?/i.test(m);
      pill.className = `qpm-hover__mutation-pill${isRainbow ? ' qpm-hover__mutation-pill--rainbow' : isGold ? ' qpm-hover__mutation-pill--gold' : ''}`;
      pill.textContent = m;
      pillWrap.appendChild(pill);
    }
    mutSection.appendChild(pillWrap);
    panel.appendChild(mutSection);
  }

  // --- Abilities (compact rows) ---
  if (pet.abilities.length > 0) {
    const abilSection = document.createElement('div');
    abilSection.className = 'qpm-hover__section';
    const abilTitle = document.createElement('div');
    abilTitle.className = 'qpm-hover__section-title';
    abilTitle.textContent = 'Abilities';
    abilSection.appendChild(abilTitle);

    for (const abilityId of pet.abilities) {
      const def = getAbilityDefinition(abilityId);
      const color = getAbilityColor(abilityId);

      // Observed history for active pets
      const history = findAbilityHistoryForIdentifiers(abilityId, {
        petId: pet.petId,
        slotId: pet.id,
        slotIndex: pet.slotIndex ?? null,
      });
      const observed = history && def ? computeObservedMetrics(history, def) : null;

      const row = document.createElement('div');
      row.className = 'qpm-hover__abil-row';

      const dot = document.createElement('div');
      dot.className = 'qpm-hover__abil-dot';
      dot.style.background = color.base;
      row.appendChild(dot);

      const name = document.createElement('span');
      name.className = 'qpm-hover__abil-name';
      name.textContent = def?.name ?? abilityId;
      row.appendChild(name);

      // Key metric: observed first, then estimated
      let metric = '';
      if (observed?.procsPerHour != null && def && !isEventTriggeredAbility(def)) {
        const stats = computeAbilityStats(def, pet.strength ?? null);
        if (stats) {
          const eph = computeEffectPerHour(def, { ...stats, procsPerHour: observed.procsPerHour }, pet.strength);
          if (def.effectUnit === 'coins' && eph > 0) {
            metric = `~${formatCoinsAbbreviated(Math.round(eph))} $/hr`;
          } else if (stats.procsPerHour > 0) {
            metric = `${observed.procsPerHour.toFixed(1)}/hr`;
          }
        }
      }
      if (!metric) {
        metric = getAbilityMetric(abilityId, pet.strength, valuationContext);
      }

      if (metric) {
        const metricEl = document.createElement('span');
        metricEl.className = 'qpm-hover__abil-metric';
        metricEl.textContent = metric;
        row.appendChild(metricEl);
      }

      abilSection.appendChild(row);
    }

    panel.appendChild(abilSection);
  }

  // --- Metadata footer ---
  const meta = getPetMetadata(pet.species);
  const depleteMin = getHungerDepletionTime(pet.species);
  const metaParts: string[] = [];
  if (meta?.rarity) metaParts.push(`Rarity: ${meta.rarity}`);
  if (meta?.maturityHours != null) metaParts.push(`Matures ${meta.maturityHours}h`);
  if (depleteMin != null) metaParts.push(`Depletes ${depleteMin}min`);
  if (metaParts.length > 0) {
    const footerEl = document.createElement('div');
    footerEl.style.cssText = 'font-size:10px;color:rgba(224,224,224,0.3);margin-top:4px;text-align:center;';
    footerEl.textContent = metaParts.join('  ·  ');
    panel.appendChild(footerEl);
  }
}
