export { initAudio, stopAudio } from './lifecycle';
export {
  isAudioReady,
  waitForAudio,
  onAudioReady,
  getSfxNames,
  hasSfx,
  getRoute,
} from './catalog';
export {
  playSfx,
  startLoop,
  stopAllLoops,
  primeUnlock,
} from './player';
export { playSpatialSfx } from './spatial';
export {
  setMasterMultiplier,
  setFeatureMultiplier,
  getPrefsSnapshot,
} from './settings';
export { getAudioSnapshot } from './diagnostics';
export type {
  SfxName,
  PlaySfxOptions,
  SpatialSfxOptions,
  SfxLoopHandle,
  AudioCatalogSnapshot,
  AudioRoute,
} from './types';
