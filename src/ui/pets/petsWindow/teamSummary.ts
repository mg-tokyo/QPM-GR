// Team ability pills computation and team summary bar rendering.

import { getHungerCapForSpecies, DEFAULT_HUNGER_CAP } from '../../../features/pets/data/petHungerCaps';
import { buildAbilityValuationContext, type AbilityValuationContext } from '../../../features/pets/abilityValuation';
import { formatCoinsAbbreviated } from '../../../features/economy/valueCalculator';
import {
  buildPetCompareProfile,
  captureProgressionStage,
  getAbilityFamilyKey,
} from '../../../features/pets/compare';
import { getAbilityColor } from '../../../utils/rendering/petCardRenderer';
import { getCoinSpriteUrl } from './helpers';
import { t } from '../../../i18n';

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export function parseHexChannelPair(hex: string): number | null {
  if (!/^[0-9a-f]{2}$/i.test(hex)) return null;
  const parsed = Number.parseInt(hex, 16);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getReadableBadgeTextColor(background: string, fallback: string): string {
  const hexMatch = background.trim().match(/^#([0-9a-f]{6})$/i);
  if (hexMatch?.[1]) {
    const raw = hexMatch[1];
    const r = parseHexChannelPair(raw.slice(0, 2));
    const g = parseHexChannelPair(raw.slice(2, 4));
    const b = parseHexChannelPair(raw.slice(4, 6));
    if (r != null && g != null && b != null) {
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance > 0.6 ? '#101318' : '#f6f8ff';
    }
  }

  const rgbMatch = background.trim().match(/^rgba?\(([^)]+)\)$/i);
  if (rgbMatch?.[1]) {
    const pieces = rgbMatch[1].split(',').map((part) => Number.parseFloat(part.trim()));
    const r = pieces[0];
    const g = pieces[1];
    const b = pieces[2];
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) {
      const luminance = (0.299 * (r as number) + 0.587 * (g as number) + 0.114 * (b as number)) / 255;
      return luminance > 0.6 ? '#101318' : '#f6f8ff';
    }
  }

  return fallback;
}

// ---------------------------------------------------------------------------
// Team ability pills
// ---------------------------------------------------------------------------

export function computeTeamAbilityPills(
  slots: Array<{ abilities: string[]; strength: number | null; targetScale: number | null; species: string }>,
): Array<{
  abilityId: string;
  abilityName: string;
  hoverTitle: string;
  unit: 'coins' | 'minutes' | 'xp' | 'food' | 'none';
  valueText: string;
  valueSuffix: ' /hr' | ' /proc' | ' food /hr';
  sortValue: number;
}> {
  const inputs = slots.map((slot, index) => ({
    id: `team-summary-${index}`,
    species: slot.species,
    strength: slot.strength,
    targetScale: slot.targetScale,
    abilities: slot.abilities,
    mutations: [],
  }));
  const stage = captureProgressionStage(inputs);
  const teamFoodBarValues = inputs
    .map((input) => {
      const cap = getHungerCapForSpecies(input.species);
      return Number.isFinite(cap) && (cap as number) > 0 ? (cap as number) : DEFAULT_HUNGER_CAP;
    })
    .filter((value) => Number.isFinite(value) && value > 0);
  const averageTeamFoodBar = teamFoodBarValues.length > 0
    ? teamFoodBarValues.reduce((sum, value) => sum + value, 0) / teamFoodBarValues.length
    : DEFAULT_HUNGER_CAP;

  let valuationContext: AbilityValuationContext | null = null;
  try {
    valuationContext = buildAbilityValuationContext();
  } catch {
    valuationContext = null;
  }

  type Unit = 'coins' | 'minutes' | 'xp' | 'food' | 'none';
  const resolveHungerRestorePerProcFood = (abilityId: string): number | null => {
    if (!abilityId.startsWith('HungerRestore')) return null;
    if (/IV$/i.test(abilityId)) return 0.45;
    if (/III$/i.test(abilityId)) return 0.40;
    if (/II$/i.test(abilityId)) return 0.35;
    return 0.30;
  };
  const byAbility = new Map<string, {
    abilityId: string;
    abilityName: string;
    unit: Unit;
    displayValue: number;
    valueSuffix: ' /hr' | ' /proc' | ' food /hr';
    sortValue: number;
    representativeSortValue: number;
    isGranter: boolean;
    abilityNames: Set<string>;
  }>();
  for (const input of inputs) {
    const profile = buildPetCompareProfile(input, stage, valuationContext);
    for (const entry of profile.abilities) {
      if (entry.isIgnored || entry.isReview) continue;
      if (entry.group === 'hatch_trio' || entry.group === 'hatch_dollar') continue;

      let unit: Unit = entry.unit !== 'none'
        ? entry.unit
        : entry.group === 'food'
          ? 'minutes'
          : entry.group === 'sale' || entry.group === 'per_hour'
            ? 'coins'
            : 'none';
      let rawDisplayValue = entry.isAction ? entry.expectedValuePerTrigger : entry.impactPerHour;
      let rawSortValue = entry.isAction ? entry.expectedValuePerHour : entry.impactPerHour;
      let valueSuffix: ' /hr' | ' /proc' | ' food /hr' = entry.isAction ? ' /proc' : ' /hr';

      // Hunger Restore should be shown as food/hr, not coin-value proxy.
      const restoreFoodPerProc = resolveHungerRestorePerProcFood(entry.abilityId);
      if (restoreFoodPerProc != null) {
        unit = 'food';
        rawDisplayValue = Math.max(0, entry.procsPerHour) * restoreFoodPerProc * averageTeamFoodBar;
        rawSortValue = rawDisplayValue;
        valueSuffix = ' food /hr';
      }

      const displayValue = Number.isFinite(rawDisplayValue) ? Math.max(0, rawDisplayValue) : 0;
      const sortValue = Number.isFinite(rawSortValue) ? Math.max(0, rawSortValue) : 0;
      const familyKeyRaw = getAbilityFamilyKey(entry.abilityId).trim();
      const familyKey = (familyKeyRaw || entry.abilityId).toLowerCase();
      const existing = byAbility.get(familyKey);
      if (existing) {
        existing.displayValue += displayValue;
        existing.sortValue += sortValue;
        existing.abilityNames.add(entry.name);
        if (existing.unit === 'none' && unit !== 'none') existing.unit = unit;
        if (sortValue > existing.representativeSortValue) {
          existing.abilityId = entry.abilityId;
          existing.abilityName = entry.name;
          existing.representativeSortValue = sortValue;
        }
      } else {
        byAbility.set(familyKey, {
          abilityId: entry.abilityId,
          abilityName: entry.name,
          unit,
          displayValue,
          valueSuffix,
          sortValue,
          representativeSortValue: sortValue,
          isGranter: entry.abilityId.endsWith('Granter'),
          abilityNames: new Set([entry.name]),
        });
      }
    }
  }

  const formatDisplayValue = (value: number, unit: Unit): string => {
    if (unit === 'coins') return formatCoinsAbbreviated(Math.max(0, Math.round(value)));
    if (unit === 'food') {
      if (value >= 1000) return formatCoinsAbbreviated(Math.max(0, Math.round(value)));
      return value.toFixed(value >= 10 ? 1 : 2);
    }
    if (unit === 'minutes') return `${value.toFixed(value >= 10 ? 1 : 2)}min`;
    if (unit === 'xp') return `${formatCoinsAbbreviated(Math.max(0, Math.round(value)))} xp`;
    return `${formatCoinsAbbreviated(Math.max(0, Math.round(value)))}`;
  };

  return [...byAbility.values()]
    .filter((entry) => entry.sortValue > 0.001 || entry.isGranter)
    .sort((a, b) => {
      if (a.isGranter !== b.isGranter) return a.isGranter ? -1 : 1;
      return b.sortValue - a.sortValue;
    })
    .map((entry) => ({
      // Show all merged tier names when a family badge represents multiple abilities.
      hoverTitle: entry.abilityNames.size > 1
        ? `Abilities:\n${[...entry.abilityNames].join('\n')}`
        : (entry.abilityName || [...entry.abilityNames][0] || ''),
      abilityId: entry.abilityId,
      abilityName: entry.abilityName,
      unit: entry.unit,
      valueText: formatDisplayValue(entry.displayValue, entry.unit),
      valueSuffix: entry.valueSuffix,
      sortValue: entry.sortValue,
    }));
}

// ---------------------------------------------------------------------------
// Team summary bar (used inside the editor)
// ---------------------------------------------------------------------------

export function renderTeamSummaryBar(
  filledSlotData: Array<{ strength: number | null; targetScale: number | null; species: string; abilities: string[] }>,
  teamScore?: number,
): HTMLElement {
  const summary = document.createElement('div');
  summary.className = 'qpm-team-summary';

  const filledCount = filledSlotData.length;

  // Slot fill indicator
  const slotStat = document.createElement('div');
  slotStat.className = 'qpm-team-summary__stat';
  const slotVal = document.createElement('div');
  slotVal.className = 'qpm-team-summary__val';
  slotVal.textContent = `${filledCount}/3`;
  const slotLbl = document.createElement('div');
  slotLbl.className = 'qpm-team-summary__lbl';
  slotLbl.textContent = t('feature.petsWindow.slots');
  slotStat.appendChild(slotVal);
  slotStat.appendChild(slotLbl);
  summary.appendChild(slotStat);

  // Total STR
  const totalStr = filledSlotData.reduce((sum, p) => sum + (p.strength ?? 0), 0);
  const sep1 = document.createElement('div');
  sep1.className = 'qpm-team-summary__sep';
  summary.appendChild(sep1);

  const strStat = document.createElement('div');
  strStat.className = 'qpm-team-summary__stat';
  const strVal = document.createElement('div');
  strVal.className = 'qpm-team-summary__val';
  strVal.textContent = String(totalStr);
  const strLbl = document.createElement('div');
  strLbl.className = 'qpm-team-summary__lbl';
  strLbl.textContent = t('feature.petsWindow.totalStr');
  strStat.appendChild(strVal);
  strStat.appendChild(strLbl);
  summary.appendChild(strStat);

  // Ability contribution pills
  const pills = computeTeamAbilityPills(filledSlotData);
  if (pills.length > 0) {
    const sep2 = document.createElement('div');
    sep2.className = 'qpm-team-summary__sep';
    summary.appendChild(sep2);

    const pillsWrap = document.createElement('div');
    pillsWrap.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap;align-items:center;align-content:center;max-height:38px;overflow:hidden;flex:1;min-width:0;';
    for (const pill of pills) {
      const p = document.createElement('span');
      p.className = 'qpm-team-summary__pill qpm-team-summary__pill--ability';
      const colors = getAbilityColor(pill.abilityId);
      if (pill.abilityId === 'RainbowGranter') {
        p.classList.add('qpm-team-summary__pill--rainbow');
        p.style.background = 'linear-gradient(135deg,#ff477e,#ff9f1c,#35d9c8,#4b7bec,#a55eea,#ff477e)';
        p.style.color = '#f6f8ff';
      } else {
        p.style.background = colors.base;
        p.style.color = getReadableBadgeTextColor(colors.base, colors.text);
      }
      p.title = pill.hoverTitle || pill.abilityName;

      if (pill.unit === 'coins') {
        const valueEl = document.createElement('span');
        valueEl.textContent = pill.valueText;
        p.appendChild(valueEl);

        const coin = getCoinSpriteUrl();
        if (coin) {
          const coinEl = document.createElement('img');
          coinEl.className = 'qpm-team-summary__pill-coin';
          coinEl.src = coin;
          coinEl.alt = '$';
          p.appendChild(coinEl);
        } else {
          const coinFallback = document.createElement('span');
          coinFallback.textContent = '$';
          p.appendChild(coinFallback);
        }

        const suffix = document.createElement('span');
        suffix.className = 'qpm-team-summary__pill-suffix';
        suffix.textContent = pill.valueSuffix;
        p.appendChild(suffix);
      } else {
        p.textContent = `${pill.valueText}${pill.valueSuffix}`;
      }

      pillsWrap.appendChild(p);
    }
    summary.appendChild(pillsWrap);
  }

  // Team score (right-aligned)
  if (teamScore != null && teamScore > 0) {
    const scoreWrap = document.createElement('div');
    scoreWrap.className = 'qpm-team-summary__score';
    const scoreLbl = document.createElement('span');
    scoreLbl.className = 'qpm-team-summary__score-label';
    scoreLbl.textContent = t('feature.petsWindow.teamScoreColon');
    const scoreVal = document.createElement('span');
    scoreVal.className = 'qpm-team-summary__score-value';
    scoreVal.textContent = String(Math.round(teamScore));
    scoreWrap.appendChild(scoreLbl);
    scoreWrap.appendChild(scoreVal);
    summary.appendChild(scoreWrap);
  }

  return summary;
}
