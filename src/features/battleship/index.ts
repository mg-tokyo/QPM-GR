export {
  initBattleship,
  stopBattleship,
  getMatchSnapshot,
  onMatchChange,
  startSoloMatch,
  beginPlacement,
  fireAt,
  resignMatch,
  endMatch,
  type MatchSnapshot,
  type PlacementController,
} from './state';
export {
  sendChallenge,
  acceptChallenge,
  declineChallenge,
  claimTimeoutWin,
} from './mpBridge';
export { getRecordSnapshot, type MatchRecordEntry } from './record';
export type { Coord, EndReason, MatchMode, MatchPhase } from './types';
export type { GridSide } from './gardenStage';
export { FLEET_SPECS } from './constants.ts';
