import { DEBUG_MUTATION_DECISIONS } from './constants';
import { reminderDiag } from './_diagnostics';
import type { PlantData, PlantDebugDetail, PlantMutationEvaluation, PlantSlotState, WeatherType } from './types';

export function generatePlantId(plant: PlantData): string {
  const slotSignature = buildSlotSignature(plant.slotStates);
  return `${plant.name}|${plant.mutations}|${plant.fruitCount}|${slotSignature}`;
}

function buildSlotSignature(slotStates: PlantSlotState[]): string {
  if (!slotStates.length) {
    return 'no-slots';
  }

  return slotStates
    .map((slot) => {
      const letters = slot.letters.join('');
      const boundFlags = `${slot.hasDawnbound ? 'd' : ''}${slot.hasAmberbound ? 'a' : ''}`;
      const base = letters || '_';
      return boundFlags ? `${base}+${boundFlags}` : base;
    })
    .join(',');
}

function debugPlantDecision(plant: PlantData, weather: WeatherType, decision: boolean, detail: PlantDebugDetail): void {
  if (!DEBUG_MUTATION_DECISIONS) return;

  const slotSummary = plant.slotStates.map((slot, index) => ({
    index,
    letters: slot.letters.join(''),
    wet: slot.hasWet,
    frozen: slot.hasFrozen,
    chilled: slot.hasChilled,
    dawn: slot.hasDawnlit,
    amber: slot.hasAmberlit,
    dawnbound: slot.hasDawnbound,
    amberbound: slot.hasAmberbound,
    rainbow: slot.hasRainbow,
    gold: slot.hasGold,
    progress: slot.progress,
  }));

  reminderDiag.debug(
    `${decision ? 'highlight' : 'skip'} ${plant.name} for ${weather}`,
    {
      slotSource: plant.slotSource,
      fruitCount: plant.fruitCount,
      domCounts: plant.domMutationCounts,
      domBold: plant.domBoldCounts,
      slotSummary,
      detail,
    }
  );
}

export function filterPlantsForWeather(plants: PlantData[], weather: WeatherType): PlantData[] {
  const toPlace: PlantData[] = [];

  for (const plant of plants) {
    const evaluation = evaluatePlantForWeather(plant, weather, true);
    if (evaluation.decision) {
      toPlace.push(plant);
    }
  }

  return toPlace;
}

export function evaluatePlantForWeather(
  plant: PlantData,
  weather: WeatherType,
  emitDebug = true,
): PlantMutationEvaluation {
  if (weather === 'sunny' || weather === 'unknown') {
    const detail: PlantDebugDetail = {
      strategy: 'fallback',
      fruitCount: Math.max(plant.fruitCount, 0),
      frozenCount: 0,
      wetCount: 0,
      chilledCount: 0,
      dawnCount: 0,
      amberCount: 0,
      dawnBoundCount: 0,
      amberBoundCount: 0,
      rainbowCount: 0,
      goldCount: 0,
    };
    if (emitDebug) {
      debugPlantDecision(plant, weather, false, detail);
    }
    return {
      decision: false,
      pendingFruits: 0,
      totalFruits: Math.max(plant.fruitCount, 0),
      needsSnow: 0,
      detail,
    };
  }

  if (plant.slotStates.length > 0 && (plant.slotSource === 'inventory' || plant.slotSource === 'garden')) {
    return evaluatePlantFromInventory(plant, weather, emitDebug);
  }

  return evaluatePlantFallback(plant, weather, emitDebug);
}

function evaluatePlantFromInventory(
  plant: PlantData,
  weather: WeatherType,
  emitDebug: boolean,
): PlantMutationEvaluation {
  const { slotStates } = plant;
  const hasAnyAmber = slotStates.some((slot) => slot.hasAmberlit || slot.hasAmberbound);
  const hasAnyDawn = slotStates.some((slot) => slot.hasDawnlit || slot.hasDawnbound);
  const hasAnyRainbow = slotStates.some((slot) => slot.hasRainbow);
  const hasAnyGold = slotStates.some((slot) => slot.hasGold);

  const hasSlotMutationInfo = slotStates.some((slot) =>
    slot.letters.length > 0 ||
    slot.hasWet ||
    slot.hasFrozen ||
    slot.hasChilled ||
    slot.hasDawnlit ||
    slot.hasAmberlit ||
    slot.hasDawnbound ||
    slot.hasAmberbound ||
    slot.hasRainbow ||
    slot.hasGold ||
    (slot.unknownMutations?.length ?? 0) > 0,
  );

  if (!hasSlotMutationInfo) {
    return evaluatePlantFallback(plant, weather, emitDebug);
  }

  // Multi-fruit plants can have different fruits with different colors; check conflicts per-fruit
  const slotsWithConflicts = slotStates.filter((slot) => {
    const hasBothColors = (slot.hasAmberlit || slot.hasAmberbound) && (slot.hasDawnlit || slot.hasDawnbound);
    const hasBothRarity = slot.hasRainbow && slot.hasGold;
    return hasBothColors || hasBothRarity;
  });

  if (slotsWithConflicts.length > 0) {
    reminderDiag.debug(`${plant.name} has ${slotsWithConflicts.length} fruit(s) with conflicting mutations (same fruit cannot be both amber+dawn or rainbow+gold)`);
  }

  let wetFinished = 0;
  let wetNeedsSnow = 0;
  let chilledFinished = 0;
  let chilledNeedsRain = 0;
  let dawnFinished = 0;
  let amberFinished = 0;
  let totalFruits = Math.max(plant.fruitCount, 1);
  let wetProgressTotal = 0;
  let wetProgressComplete = 0;
  let dawnProgressTotal = 0;
  let dawnProgressComplete = 0;
  let amberProgressTotal = 0;
  let amberProgressComplete = 0;

  for (const slot of slotStates) {
    const wetMutated = slot.hasWet || slot.hasFrozen;
    if (wetMutated) {
      wetFinished += 1;
    }
    if (slot.hasWet && !slot.hasFrozen) {
      wetNeedsSnow += 1;
    }
    const chilledMutated = slot.hasChilled || slot.hasFrozen;
    if (chilledMutated) {
      chilledFinished += 1;
    }
    if (slot.hasChilled && !slot.hasFrozen) {
      chilledNeedsRain += 1;
    }
    if (slot.hasDawnlit || slot.hasDawnbound) {
      dawnFinished += 1;
    }
    if (slot.hasAmberlit || slot.hasAmberbound) {
      amberFinished += 1;
    }

    const wetProgress = slot.progress?.wet;
    if (wetProgress) {
      wetProgressTotal = Math.max(wetProgressTotal, wetProgress.total);
      wetProgressComplete = Math.max(wetProgressComplete, wetProgress.complete);
    }
    const dawnProgress = slot.progress?.dawn;
    if (dawnProgress) {
      dawnProgressTotal = Math.max(dawnProgressTotal, dawnProgress.total);
      dawnProgressComplete = Math.max(dawnProgressComplete, dawnProgress.complete);
    }
    const amberProgress = slot.progress?.amber;
    if (amberProgress) {
      amberProgressTotal = Math.max(amberProgressTotal, amberProgress.total);
      amberProgressComplete = Math.max(amberProgressComplete, amberProgress.complete);
    }
  }
  totalFruits = Math.max(totalFruits, wetFinished, chilledFinished, dawnFinished, amberFinished);

  const clampDom = (value: number): number => Math.max(0, Math.min(totalFruits, value));
  const domFrozen = clampDom(plant.domMutationCounts.F);
  const domWetOnly = clampDom(plant.domMutationCounts.W);
  const domWetProgress = clampDom(domFrozen + domWetOnly);
  const domWetNeedsSnow = clampDom(Math.max(0, domWetProgress - domFrozen));
  const domChilledOnly = clampDom(plant.domMutationCounts.C);
  const domChilledProgress = clampDom(domFrozen + domChilledOnly);
  const domChilledNeedsRain = clampDom(Math.max(0, domChilledProgress - domFrozen));
  const domDawnComplete = clampDom(plant.domMutationCounts.D + plant.domBoldCounts.D);
  const domAmberComplete = clampDom(plant.domMutationCounts.A + plant.domBoldCounts.A);

  wetFinished = Math.max(wetFinished, domWetProgress);
  wetNeedsSnow = Math.max(wetNeedsSnow, domWetNeedsSnow);
  chilledFinished = Math.max(chilledFinished, domChilledProgress);
  chilledNeedsRain = Math.max(chilledNeedsRain, domChilledNeedsRain);
  dawnFinished = Math.max(dawnFinished, domDawnComplete);
  amberFinished = Math.max(amberFinished, domAmberComplete);

  if (wetProgressTotal > 0) {
    totalFruits = Math.max(totalFruits, wetProgressTotal);
    wetFinished = Math.max(wetFinished, wetProgressComplete);
  }
  if (dawnProgressTotal > 0) {
    totalFruits = Math.max(totalFruits, dawnProgressTotal);
    dawnFinished = Math.max(dawnFinished, dawnProgressComplete);
  }
  if (amberProgressTotal > 0) {
    totalFruits = Math.max(totalFruits, amberProgressTotal);
    amberFinished = Math.max(amberFinished, amberProgressComplete);
  }

  const wetPending = Math.max(0, totalFruits - wetFinished);
  const chilledPending = Math.max(0, totalFruits - chilledFinished);
  const dawnPending = Math.max(0, totalFruits - dawnFinished);
  const amberPending = Math.max(0, totalFruits - amberFinished);

  const inventoryDetail: PlantDebugDetail = {
    strategy: 'inventory',
    totalFruits,
    wetPending,
    wetFinished,
    wetNeedsSnow,
    wetProgressComplete,
    wetProgressTotal,
    domWetProgress,
    domWetNeedsSnow,
    dawnPending,
    dawnProgressComplete,
    dawnProgressTotal,
    domDawnComplete,
    amberPending,
    amberProgressComplete,
    amberProgressTotal,
    domAmberComplete,
    hasAnyDawn,
    hasAnyAmber,
    hasAnyRainbow,
    hasAnyGold,
  };

  let decision = false;
  let pendingFruits = 0;
  let needsSnow = wetNeedsSnow;

  switch (weather) {
    case 'rain':
      decision = wetPending > 0;
      pendingFruits = wetPending;
      break;
    case 'snow':
      if (chilledPending > 0) {
        // Priority 1: Highlight unmutated crops for new "Chilled" mutations
        decision = true;
        pendingFruits = chilledPending;
      } else {
        // Priority 2: Highlight "Wet" crops to upgrade to "Frozen"
        decision = wetNeedsSnow > 0;
        pendingFruits = wetNeedsSnow;
      }
      break;
    case 'dawn':
      // Allow dawn weather if there are dawn-pending fruits, even if some other fruits have amber
      // (multi-fruit plants can have different fruits needing different colors)
      decision = dawnPending > 0;
      pendingFruits = dawnPending;
      needsSnow = 0;
      break;
    case 'amber':
      // Allow amber weather if there are amber-pending fruits, even if some other fruits have dawn
      // (multi-fruit plants can have different fruits needing different colors)
      decision = amberPending > 0;
      pendingFruits = amberPending;
      needsSnow = 0;
      break;
    default:
      decision = false;
      pendingFruits = 0;
      needsSnow = 0;
      break;
  }

  const evaluation: PlantMutationEvaluation = {
    decision,
    pendingFruits: Math.max(0, pendingFruits),
    totalFruits: Math.max(1, totalFruits),
    needsSnow: Math.max(0, needsSnow),
    detail: { ...inventoryDetail },
  };

  if (emitDebug) {
    debugPlantDecision(plant, weather, evaluation.decision, evaluation.detail);
  }

  return evaluation;
}

function evaluatePlantFallback(
  plant: PlantData,
  weather: WeatherType,
  emitDebug: boolean,
): PlantMutationEvaluation {
  const { fruitCount, domMutationCounts, domBoldCounts } = plant;

  const totalFruits = Math.max(fruitCount, 0);
  if (totalFruits <= 0) {
    const emptyDetail: PlantDebugDetail = {
      strategy: 'fallback',
      fruitCount: totalFruits,
      frozenCount: 0,
      wetCount: 0,
      chilledCount: 0,
      dawnCount: 0,
      amberCount: 0,
      dawnBoundCount: 0,
      amberBoundCount: 0,
      rainbowCount: 0,
      goldCount: 0,
    };
    if (emitDebug) {
      debugPlantDecision(plant, weather, false, emptyDetail);
    }
    return {
      decision: false,
      pendingFruits: 0,
      totalFruits,
      needsSnow: 0,
      detail: emptyDetail,
    };
  }

  const clamp = (value: number): number => Math.max(0, Math.min(value, totalFruits));

  const frozenCount = clamp(domMutationCounts.F);
  const wetCount = clamp(domMutationCounts.W);
  const chilledCount = clamp(domMutationCounts.C);
  const dawnCount = clamp(domMutationCounts.D);
  const amberCount = clamp(domMutationCounts.A);
  const rainbowCount = clamp(domMutationCounts.R);
  const goldCount = clamp(domMutationCounts.G);
  const dawnBoundCount = clamp(domBoldCounts.D);
  const amberBoundCount = clamp(domBoldCounts.A);

  const detail: PlantDebugDetail = {
    strategy: 'fallback',
    fruitCount: totalFruits,
    frozenCount,
    wetCount,
    chilledCount,
    dawnCount,
    amberCount,
    dawnBoundCount,
    amberBoundCount,
    rainbowCount,
    goldCount,
  };

  let decision = false;
  let pendingFruits = 0;
  let needsSnow = Math.max(0, wetCount - frozenCount);

  switch (weather) {
    case 'rain': {
      const wetProgress = wetCount + frozenCount;
      if (wetProgress < totalFruits) {
        decision = true;
        pendingFruits = Math.max(0, totalFruits - wetProgress);
      } else {
        const chilledDeficit = chilledCount - frozenCount;
        decision = chilledDeficit > 0;
        pendingFruits = Math.max(0, chilledDeficit);
      }
      break;
    }
    case 'snow': {
      const chilledProgress = chilledCount + frozenCount;
      if (chilledProgress < totalFruits) {
        // Priority 1: Highlight unmutated crops for new "Chilled" mutations
        decision = true;
        pendingFruits = Math.max(0, totalFruits - chilledProgress);
      } else {
        // Priority 2: Highlight "Wet" crops to upgrade to "Frozen"
        const wetDeficit = wetCount - frozenCount;
        decision = wetDeficit > 0;
        pendingFruits = Math.max(0, wetDeficit);
      }
      // Update needsSnow for tracking (wet crops that need snow to freeze)
      needsSnow = Math.max(0, wetCount - frozenCount);
      break;
    }
    case 'dawn': {
      if (amberCount + amberBoundCount > 0) {
        decision = false;
        pendingFruits = 0;
        break;
      }
      const dawnProgress = dawnCount + dawnBoundCount;
      pendingFruits = Math.max(0, totalFruits - dawnProgress);
      decision = pendingFruits > 0;
      needsSnow = 0;
      break;
    }
    case 'amber': {
      if (dawnCount + dawnBoundCount > 0) {
        decision = false;
        pendingFruits = 0;
        break;
      }
      const amberProgress = amberCount + amberBoundCount;
      pendingFruits = Math.max(0, totalFruits - amberProgress);
      decision = pendingFruits > 0;
      needsSnow = 0;
      break;
    }
    default:
      decision = false;
      pendingFruits = 0;
      needsSnow = 0;
      break;
  }

  const evaluation: PlantMutationEvaluation = {
    decision,
    pendingFruits: Math.max(0, pendingFruits),
    totalFruits,
    needsSnow: Math.max(0, needsSnow),
    detail,
  };

  if (emitDebug) {
    debugPlantDecision(plant, weather, evaluation.decision, evaluation.detail);
  }

  return evaluation;
}
