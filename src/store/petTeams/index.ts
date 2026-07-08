// Public re-exports only — no logic here.

// config.ts
export {
  initPetTeamsStore,
  stopPetTeamsStore,
  getTeamsConfig,
  getTeamById,
  onTeamsChange,
  createTeam,
  renameTeam,
  deleteTeam,
  reorderTeams,
  saveCurrentTeamSlots,
  setTeamSlot,
  clearTeamSlot,
  purgeGonePets,
  detectCurrentTeam,
  setKeybind,
  clearKeybind,
  getKeybinds,
} from './config';

// apply.ts
export { applyTeam } from './apply';

// pool.ts
export { getAllPooledPets } from './pool';
export type { PooledPetsResult } from './pool';

// feedPolicy.ts
export { getFeedPolicy, setFeedPolicyOverride, clearFeedPolicyOverride } from './feedPolicy';

// state.ts
export { PET_FEED_POLICY_CHANGED_EVENT } from './state';

// types.ts
export type { ApplyErrorReason, ApplyTeamResult } from './types';
