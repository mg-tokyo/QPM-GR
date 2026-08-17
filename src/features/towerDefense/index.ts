export type {
  TowerId,
  BalloonId,
  MatchSnapshot,
  Phase,
  Speed,
  TargetPriority,
} from './types';

export {
  initMatchState,
  stopMatchState,
  getMatchSnapshot,
  onMatchChange,
} from './state';

export {
  loadHighScore,
  loadSettings,
  saveSettings,
  loadSavedGame,
  clearSavedGame,
  hasSavedGame,
  type HighScore,
  type TdSettings,
} from './persistence';

export {
  initTowerDefense,
  launchTowerDefense,
  quitTowerDefense,
} from './launch';

export { initTdDebugBridge } from './debug';
