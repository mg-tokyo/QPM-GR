import { loadRiveRules } from './store';
import { startRiveBridge, reapplyAllRiveRules } from './bridge';

export {
  getRiveRules, addRiveRule, updateRiveRule, deleteRiveRule,
  clearAllRiveRules, onRiveRulesChanged,
} from './store';
export type { RiveRule, RiveRuleTarget } from './types';
export { reapplyAllRiveRules, findInstancesForTarget } from './bridge';

let disposer: (() => void) | null = null;

export function initRiveControl(): () => void {
  if (disposer) return disposer;
  loadRiveRules();
  const stop = startRiveBridge();
  disposer = () => { stop(); disposer = null; };
  return disposer;
}
