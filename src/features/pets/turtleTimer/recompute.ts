import { computeSupportProcPerMinute, normalizeAbility, resolveGrowthAbility, resolveSupportEffect } from './abilities';
import { FOCUS_KEY_SEPARATOR, SUPPORT_PATTERNS } from './constants';
import { computeContribution, describePetKey, resolveTurtlePetStats } from './petStats';
import { collectSlots, isEggSlot, makeFocusKey, pickFocusSlot } from './slots';
import { config, createEmptyChannel, createInitialState, latest, publish } from './state';
import type {
  GardenSlotEstimate,
  ResolvedGrowthAbility,
  SupportAbilityBreakdown,
  TurtleAbilityKind,
  TurtleContribution,
  TurtleFocusOption,
  TurtleSupportEntry,
  TurtleSupportKind,
  TurtleTimerChannel,
  TurtleTimerFocus,
  TurtleTimerStatus,
} from './types';

function computeChannel(
  kind: TurtleAbilityKind,
  slots: GardenSlotEstimate[],
  contributions: TurtleContribution[],
  now: number,
  enabled: boolean,
  focusMode: TurtleTimerFocus,
  focusTargetTileId: string | null,
  focusTargetSlotIndex: number | null,
): TurtleTimerChannel {
  if (!enabled) {
    return { ...createEmptyChannel('disabled'), contributions: [] };
  }

  const trackedSlots = slots.filter((slot) => slot.endTime != null).length;
  const growingSlots = slots.filter((slot) => slot.endTime != null && slot.endTime > now).length;
  const maturedSlots = slots.filter((slot) => slot.endTime != null && slot.endTime <= now).length;

  const baseChannel: TurtleTimerChannel = {
    status: 'no-data',
    trackedSlots,
    growingSlots,
    maturedSlots,
    contributions: contributions.slice().sort((a, b) => b.rateContribution - a.rateContribution),
    expectedMinutesRemoved: null,
    effectiveRate: null,
    naturalMsRemaining: null,
    adjustedMsRemaining: null,
    minutesSaved: null,
    focusSlot: null,
  };

  if (slots.length === 0 || trackedSlots === 0) {
    return baseChannel;
  }

  if (growingSlots === 0) {
    return {
      ...baseChannel,
      status: kind === 'egg' ? 'no-eggs' : 'no-crops',
    };
  }

  const focusSlot = pickFocusSlot(slots, focusMode, focusTargetTileId, focusTargetSlotIndex, now);
  if (!focusSlot || focusSlot.endTime == null) {
    return {
      ...baseChannel,
      status: 'no-data',
    };
  }

  const naturalMsRemaining = Math.max(0, focusSlot.endTime - now);
  const naturalMinutes = naturalMsRemaining / 60000;
  const expectedMinutesRemovedRaw = contributions.reduce((sum, entry) => sum + entry.rateContribution, 0);
  const hasValidBoosters = Number.isFinite(expectedMinutesRemovedRaw) && expectedMinutesRemovedRaw > 0;
  const expectedMinutesRemoved = hasValidBoosters ? expectedMinutesRemovedRaw : 0;
  const effectiveRate = hasValidBoosters ? Math.max(0.01, 1 + expectedMinutesRemoved) : 1;
  const adjustedMinutes = naturalMinutes / Math.max(0.01, effectiveRate);
  const adjustedMsRemaining = adjustedMinutes * 60000;
  const minutesSaved = hasValidBoosters ? Math.max(0, naturalMinutes - adjustedMinutes) : null;
  const status: TurtleTimerStatus = hasValidBoosters ? 'estimating' : 'no-turtles';

  return {
    status,
    trackedSlots,
    growingSlots,
    maturedSlots,
    contributions: baseChannel.contributions,
    expectedMinutesRemoved: hasValidBoosters ? expectedMinutesRemoved : null,
    effectiveRate: hasValidBoosters ? effectiveRate : null,
    naturalMsRemaining,
    adjustedMsRemaining: hasValidBoosters ? adjustedMsRemaining : naturalMsRemaining,
    minutesSaved,
    focusSlot: {
      ...focusSlot,
      remainingMs: naturalMsRemaining,
    },
  };
}

export function recompute(): void {
  const now = Date.now();
  const next = createInitialState();
  next.now = now;

  if (!config.enabled) {
    next.enabled = false;
    next.plant.status = 'disabled';
    next.egg.status = 'disabled';
    publish(next);
    return;
  }

  const slots = collectSlots(latest.garden, config.includeBoardwalk);
  const eggSlots = slots.filter((slot) => isEggSlot(slot));
  const plantSlots = slots.filter((slot) => !isEggSlot(slot));

  const plantContributions: TurtleContribution[] = [];
  const eggContributions: TurtleContribution[] = [];
  const supportEntries: TurtleSupportEntry[] = [];

  const availableKeys = new Set<string>();
  const hungerFilteredKeys = new Set<string>();
  const missingStatKeys = new Set<string>();

  for (const pet of latest.pets) {
    if (!pet || typeof pet !== 'object') {
      continue;
    }

    const abilities = Array.isArray(pet.abilities)
      ? pet.abilities
          .filter((ability): ability is string => typeof ability === 'string' && ability.trim().length > 0)
          .map((ability) => ({ raw: ability, normalized: normalizeAbility(ability) }))
      : [];

    if (abilities.length === 0) {
      continue;
    }

    const petKey = describePetKey(pet);
    const hungerPct = pet.hungerPct;
    const hungerOk = hungerPct == null || hungerPct > config.minActiveHungerPct;

    let matchedReductionAbility = false;

    // Resolve growth abilities per-pet using catalog definitions
    const resolvedByKind = new Map<'plant' | 'egg', { resolved: ResolvedGrowthAbility; names: string[] }>();
    for (const { raw, normalized } of abilities) {
      const resolved = resolveGrowthAbility(raw, normalized);
      if (!resolved) continue;
      const existing = resolvedByKind.get(resolved.kind);
      if (existing) {
        existing.names.push(raw);
      } else {
        resolvedByKind.set(resolved.kind, { resolved, names: [raw] });
      }
    }

    for (const [kind, { resolved, names }] of resolvedByKind) {
      matchedReductionAbility = true;
      availableKeys.add(petKey);

      if (!hungerOk) {
        hungerFilteredKeys.add(petKey);
        continue;
      }

      const contribution = computeContribution(pet, resolved, names);
      if (contribution.missingStats) {
        missingStatKeys.add(petKey);
      }
      if (contribution.rateContribution <= 0) {
        continue;
      }

      if (kind === 'plant') {
        plantContributions.push(contribution);
      } else {
        eggContributions.push(contribution);
      }
    }

    const stats = resolveTurtlePetStats(pet);

    for (const supportKind of Object.keys(SUPPORT_PATTERNS) as TurtleSupportKind[]) {
      const matches = abilities
        .filter(({ normalized }) => SUPPORT_PATTERNS[supportKind].some((pattern) => normalized.includes(pattern)))
        .map(({ raw }) => raw);

      if (matches.length === 0) {
        continue;
      }

      const abilityDetails: SupportAbilityBreakdown[] = [];
      let totalRestorePerTriggerPct = 0;
      let totalRestorePerHourPct = 0;
      let totalTriggersPerHour = 0;
      let totalSlowPct = 0;

      for (const abilityName of matches) {
        const normalizedAbility = normalizeAbility(abilityName);
        const effect = resolveSupportEffect(supportKind, abilityName, normalizedAbility);
        if (!effect) {
          continue;
        }

        if (supportKind === 'restore') {
          const procsPerMinute = computeSupportProcPerMinute(stats.baseScore, effect.procOdds);
          const triggersPerHour = procsPerMinute * 60;
          const pctPerHour = triggersPerHour * effect.effectPct;
          totalRestorePerTriggerPct += effect.effectPct;
          totalRestorePerHourPct += pctPerHour;
          totalTriggersPerHour += triggersPerHour;
          abilityDetails.push({
            abilityName,
            normalizedName: normalizedAbility,
            perTriggerPct: effect.effectPct,
            slowdownPct: null,
            triggersPerHour,
            pctPerHour,
            probabilityPerMinute: procsPerMinute,
          });
        } else {
          totalSlowPct += effect.effectPct;
          abilityDetails.push({
            abilityName,
            normalizedName: normalizedAbility,
            perTriggerPct: null,
            slowdownPct: effect.effectPct,
            triggersPerHour: null,
            pctPerHour: null,
            probabilityPerMinute: null,
          });
        }
      }

      if (abilityDetails.length === 0) {
        continue;
      }

      supportEntries.push({
        type: supportKind,
        abilityNames: matches,
        slotIndex: pet.slotIndex,
        name: pet.name,
        species: pet.species,
        hungerPct,
        active: hungerOk,
        xp: stats.xp,
        targetScale: stats.targetScale,
        baseScore: stats.baseScore,
        missingStats: stats.missingStats,
        abilityDetails,
        totalRestorePerTriggerPct,
        totalRestorePerHourPct,
        totalTriggersPerHour,
        totalSlowPct,
      });
    }

    if (!matchedReductionAbility && !hungerOk) {
      hungerFilteredKeys.add(petKey);
    }
  }

  const focusTargetTileId = config.focusTargetTileId;
  const focusTargetSlotIndex = config.focusTargetSlotIndex;

  const plantChannel = computeChannel(
    'plant',
    plantSlots,
    plantContributions,
    now,
    true,
    config.focus,
    focusTargetTileId,
    focusTargetSlotIndex,
  );
  const eggFocusTargetTileId = config.eggFocusTargetTileId;
  const eggFocusTargetSlotIndex = config.eggFocusTargetSlotIndex;
  const eggChannel = computeChannel(
    'egg',
    eggSlots,
    eggContributions,
    now,
    true,
    config.eggFocus,
    eggFocusTargetTileId,
    eggFocusTargetSlotIndex,
  );

  let restoreCount = 0;
  let restoreActiveCount = 0;
  let slowCount = 0;
  let slowActiveCount = 0;
  let restorePctTotal = 0;
  let restorePctActive = 0;
  let restorePctPerHourTotal = 0;
  let restorePctPerHourActive = 0;
  let restoreTriggersPerHourTotal = 0;
  let restoreTriggersPerHourActive = 0;
  let slowPctTotal = 0;
  let slowPctActive = 0;

  supportEntries.sort((a, b) => {
    if (a.type === b.type) {
      if (a.active === b.active) {
        return (a.name ?? '').localeCompare(b.name ?? '');
      }
      return a.active ? -1 : 1;
    }
    return a.type === 'restore' ? -1 : 1;
  });

  for (const entry of supportEntries) {
    if (entry.type === 'restore') {
      restoreCount += 1;
      restorePctTotal += entry.totalRestorePerTriggerPct;
      restorePctPerHourTotal += entry.totalRestorePerHourPct;
      restoreTriggersPerHourTotal += entry.totalTriggersPerHour;
      if (entry.active) {
        restoreActiveCount += 1;
        restorePctActive += entry.totalRestorePerTriggerPct;
        restorePctPerHourActive += entry.totalRestorePerHourPct;
        restoreTriggersPerHourActive += entry.totalTriggersPerHour;
      }
    } else {
      slowCount += 1;
      slowPctTotal += entry.totalSlowPct;
      if (entry.active) {
        slowActiveCount += 1;
        slowPctActive += entry.totalSlowPct;
      }
    }
  }

  next.enabled = true;
  next.includeBoardwalk = config.includeBoardwalk;
  next.focus = config.focus;
  next.eggFocus = config.eggFocus;
  const plantTargets: TurtleFocusOption[] = plantSlots
    .filter((slot) => slot.endTime != null && slot.endTime > now)
    .map((slot) => ({
      key: makeFocusKey(slot.tileId, slot.slotIndex) ?? `${slot.tileId}${FOCUS_KEY_SEPARATOR}${slot.slotIndex}`,
      tileId: slot.tileId,
      slotIndex: slot.slotIndex,
      species: slot.species ?? slot.seedSpecies ?? slot.plantSpecies,
      boardwalk: slot.boardwalk,
      endTime: slot.endTime ?? null,
      remainingMs: slot.endTime != null ? Math.max(0, slot.endTime - now) : null,
    }));
  next.plantTargets = plantTargets;
  next.focusTargetKey = makeFocusKey(focusTargetTileId, focusTargetSlotIndex);
  next.focusTargetAvailable = next.focusTargetKey != null
    ? plantTargets.some((target) => target.key === next.focusTargetKey)
    : false;
  const eggTargets: TurtleFocusOption[] = eggSlots
    .filter((slot) => slot.endTime != null && slot.endTime > now)
    .map((slot) => ({
      key: makeFocusKey(slot.tileId, slot.slotIndex) ?? `${slot.tileId}${FOCUS_KEY_SEPARATOR}${slot.slotIndex}`,
      tileId: slot.tileId,
      slotIndex: slot.slotIndex,
      species: slot.eggSpecies ?? slot.eggId ?? slot.species,
      boardwalk: slot.boardwalk,
      endTime: slot.endTime ?? null,
      remainingMs: slot.endTime != null ? Math.max(0, slot.endTime - now) : null,
    }));
  next.eggTargets = eggTargets;
  next.eggFocusTargetKey = makeFocusKey(eggFocusTargetTileId, eggFocusTargetSlotIndex);
  next.eggFocusTargetAvailable = next.eggFocusTargetKey != null
    ? eggTargets.some((target) => target.key === next.eggFocusTargetKey)
    : false;
  next.minActiveHungerPct = config.minActiveHungerPct;
  next.fallbackTargetScale = config.fallbackTargetScale;
  next.availableTurtles = availableKeys.size;
  next.hungerFilteredCount = hungerFilteredKeys.size;
  next.turtlesMissingStats = missingStatKeys.size;
  next.plant = plantChannel;
  next.egg = eggChannel;
  next.support = {
    restoreCount,
    restoreActiveCount,
    slowCount,
    slowActiveCount,
    restorePctTotal,
    restorePctActive,
    restorePctPerHourTotal,
    restorePctPerHourActive,
    restoreTriggersPerHourTotal,
    restoreTriggersPerHourActive,
    slowPctTotal,
    slowPctActive,
    entries: supportEntries,
  };

  publish(next);
}

export function recalculateTimerState(): void {
  recompute();
}
