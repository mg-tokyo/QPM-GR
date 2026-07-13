export {
  startMutationReminder,
  setMutationReminderEnabled,
  setStatusCallback,
  getConfig,
  getCurrentWeather,
  simulateWeather,
  checkForMutations,
  manualCheckMutations,
} from './controller';
export { resolveWeatherDurationMs, deriveWeatherWindowFromSnapshot } from './weather';
export { computeSlotStateFromMutationNames } from './parsing';
export { createMutationCountMap, combineMutationSources } from './domScan';
export { buildMutationSummary } from './summary';
export type {
  MutationConfig,
  MutationLetter,
  MutationStage,
  MutationStageProgress,
  MutationSummaryCollector,
  PlantSlotState,
  PlantData,
  WeatherType,
} from './types';
