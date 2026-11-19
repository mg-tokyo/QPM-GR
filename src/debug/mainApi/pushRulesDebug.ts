import { getPushRulesStatus, loadPushRules } from '../../catalogs/logic/pushRulesCatalog';
import { runPhonePushSync } from '../../features/shop/phonePushSync';
import type { PhonePushOptions } from '../../features/shop/phonePushSync';

/** QPM_DEBUG_API.pushRules: the game's phone-push rules (ALR-8.2a), read from the bundle on call. */
export const pushRulesDebugApi = {
  pushRules: async () => ({ rules: await loadPushRules(), status: getPushRulesStatus() }),
  // ALR-8.2b: plan() = one GET, nothing sent; sync() sends to the game server.
  phonePush: {
    plan: (opts: Omit<PhonePushOptions, 'dryRun'> = {}) => runPhonePushSync({ ...opts, dryRun: true }),
    sync: (opts: Omit<PhonePushOptions, 'dryRun'> = {}) => runPhonePushSync({ ...opts, dryRun: false }),
  },
};
