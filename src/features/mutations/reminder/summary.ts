import type {
  MutationActiveWeather,
  MutationSummary,
  MutationWeatherSummary,
  MutationWeatherWindow,
} from '../../../store/mutationSummary';
import { MUTATION_WEATHERS } from './constants';
import { evaluatePlantForWeather, generatePlantId } from './evaluator';
import type { MutationSummaryCollector, PlantData, PlantMutationEvaluation, WeatherType } from './types';

export function buildMutationSummary(
  plants: PlantData[],
  activeWeather: WeatherType,
  weatherWindow: MutationWeatherWindow | null = null,
  collect?: MutationSummaryCollector,
): MutationSummary {
  const totals: Record<MutationActiveWeather, MutationWeatherSummary> = {
    rain: { weather: 'rain', plantCount: 0, pendingFruitCount: 0 },
    snow: { weather: 'snow', plantCount: 0, pendingFruitCount: 0, needsSnowFruitCount: 0 },
    dawn: { weather: 'dawn', plantCount: 0, pendingFruitCount: 0 },
    amber: { weather: 'amber', plantCount: 0, pendingFruitCount: 0 },
    thunderstorm: { weather: 'thunderstorm', plantCount: 0, pendingFruitCount: 0 },
  };

  const uniqueEligible = new Set<string>();
  const uniqueTracked = new Set<string>();
  const lunarTracked = new Set<string>();
  const lunarPending = new Set<string>();
  let lunarTotalFruitCount = 0;
  let lunarPendingFruitCount = 0;

  type EvaluationMap = Record<MutationActiveWeather, PlantMutationEvaluation>;

  const plantEvaluations: Array<{ plant: PlantData; evaluations: EvaluationMap; lunarTag: 'amber-preferred' | null }> = [];

  for (const plant of plants) {
    const evaluations = {
      rain: evaluatePlantForWeather(plant, 'rain', false),
      snow: evaluatePlantForWeather(plant, 'snow', false),
      dawn: evaluatePlantForWeather(plant, 'dawn', false),
      amber: evaluatePlantForWeather(plant, 'amber', false),
      thunderstorm: evaluatePlantForWeather(plant, 'thunderstorm', false),
    } satisfies EvaluationMap;

    // Multi-fruit plants can be eligible for both dawn and amber simultaneously; tag but keep both active
    let lunarTag: 'amber-preferred' | null = null;
    const dawnEval = evaluations.dawn;
    const amberEval = evaluations.amber;
    if (dawnEval.decision && amberEval.decision) {
      lunarTag = 'amber-preferred';
    }

    plantEvaluations.push({ plant, evaluations, lunarTag });
  }

  for (const { plant, evaluations, lunarTag } of plantEvaluations) {
    const plantId = generatePlantId(plant);
    uniqueTracked.add(plantId);

    const amberEval = evaluations.amber;
    const dawnEval = evaluations.dawn;
    const amberPendingRaw = Math.max(0, Math.round(amberEval.pendingFruits));
    const dawnPendingRaw = Math.max(0, Math.round(dawnEval.pendingFruits));
    const amberTotalRaw = Math.max(0, Math.round(amberEval.totalFruits ?? 0));
    const dawnTotalRaw = Math.max(0, Math.round(dawnEval.totalFruits ?? 0));

    if (amberTotalRaw > 0 || dawnTotalRaw > 0) {
      lunarTracked.add(plantId);
    }

    let chosenEvaluation: PlantMutationEvaluation | null = null;
    if (amberTotalRaw > 0 || amberPendingRaw > 0) {
      chosenEvaluation = amberEval;
    } else if (dawnTotalRaw > 0 || dawnPendingRaw > 0) {
      chosenEvaluation = dawnEval;
    }

    if (chosenEvaluation) {
      const totalFruits = Math.max(0, Math.round(chosenEvaluation.totalFruits ?? 0));
      const pendingFruits = Math.max(0, Math.round(chosenEvaluation.pendingFruits));
      if (totalFruits > 0) {
        lunarTotalFruitCount += totalFruits;
        lunarPendingFruitCount += pendingFruits;
        if (pendingFruits > 0) {
          lunarPending.add(plantId);
        }
      }
    }

    for (const weather of MUTATION_WEATHERS) {
      const evaluation = evaluations[weather];
      if (!evaluation.decision) {
        continue;
      }

      const pendingFruit = Math.max(0, Math.round(evaluation.pendingFruits));
      const needsSnowFruit = weather === 'snow' ? Math.max(0, Math.round(evaluation.needsSnow)) : 0;
      const tag = weather === 'amber' && lunarTag === 'amber-preferred' ? 'lunar-any' : undefined;

      totals[weather].plantCount += 1;
      totals[weather].pendingFruitCount += pendingFruit;
      if (weather === 'snow') {
        totals[weather].needsSnowFruitCount =
          (totals[weather].needsSnowFruitCount ?? 0) + needsSnowFruit;
      }

      const stats: { pendingFruit: number; needsSnowFruit: number; tag?: string } = {
        pendingFruit,
        needsSnowFruit,
      };
      if (tag) {
        stats.tag = tag;
      }
      collect?.(weather, plant, stats);

      uniqueEligible.add(plantId);
    }
  }

  const overallPendingFruitCount = MUTATION_WEATHERS.reduce(
    (sum, weather) => sum + totals[weather].pendingFruitCount,
    0,
  );

  const overallTrackedPlantCount = uniqueTracked.size;
  const lunarTrackedPlantCount = lunarTracked.size;
  const lunarPendingPlantCount = lunarPending.size;
  const lunarMutatedPlantCount = Math.max(0, lunarTrackedPlantCount - lunarPendingPlantCount);
  const lunarMutatedFruitCount = Math.max(0, lunarTotalFruitCount - lunarPendingFruitCount);

  const normalizedWindow = weatherWindow
    ? {
        ...weatherWindow,
        remainingMs:
          weatherWindow.expectedEndAt != null
            ? Math.max(0, weatherWindow.expectedEndAt - Date.now())
            : weatherWindow.remainingMs ?? null,
      }
    : null;

  return {
    timestamp: Date.now(),
    activeWeather,
    totals,
    overallEligiblePlantCount: uniqueEligible.size,
    overallPendingFruitCount,
    overallTrackedPlantCount,
    lunar: {
      trackedPlantCount: lunarTrackedPlantCount,
      pendingPlantCount: lunarPendingPlantCount,
      mutatedPlantCount: lunarMutatedPlantCount,
      totalFruitCount: lunarTotalFruitCount,
      pendingFruitCount: lunarPendingFruitCount,
      mutatedFruitCount: lunarMutatedFruitCount,
    },
    weatherWindow: normalizedWindow,
  };
}
