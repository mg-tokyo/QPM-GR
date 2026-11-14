// Stats Hub garden counting on the shared mutation rule engine (src/utils/mutationCompatibility.ts).

import { resolveMutation } from '../../../utils/game/cropMultipliers';

export { canApplyMutation, filterCompatibleMutations, simulateMutationsAfterApplying } from '../../../utils/mutationCompatibility';
export {
  countActionableFruits,
  countMaxSizeRemainingFruits,
  isTileActionable,
  mutsMatch,
} from '../../../features/garden/gardenTiles';

/** Resolve any display name or alias to its canonical lowercase name. */
export const normalizeCanonical = (m: string): string =>
  resolveMutation(m)?.name.toLowerCase() ?? m.toLowerCase();
