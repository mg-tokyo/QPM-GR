// The game's charged-ability rules as a catalog part (REL-8.1). Null until parsed; consumers treat null
// as "rules unknown" and never fall back to a literal or a name guess (REL-8 D1, D4).

import { createBundlePartSource } from './bundlePartSource';
import type { BundlePartStatus } from './bundlePartSource';
import { CHARGED_ABILITY_RULES_MARKER, parseChargedAbilityRules } from './chargedAbilityRulesParsing';
import type { ChargedAbilityRules } from './chargedAbilityRulesParsing';

export type { CaptureRule, ChargerRule, ChargedAbilityRules } from './chargedAbilityRulesParsing';

export interface ChargedAbilityRulesStatus extends BundlePartStatus {
  rules: ChargedAbilityRules | null;
}

const source = createBundlePartSource('charged-ability-rules', CHARGED_ABILITY_RULES_MARKER, parseChargedAbilityRules);

export function startChargedAbilityRulesSource(): void {
  source.start();
}

export function stopChargedAbilityRulesSource(): void {
  source.stop();
}

export function getChargedAbilityRules(): ChargedAbilityRules | null {
  return source.get();
}

/** Fires when the rules resolve and once when the first load finishes, so "unreadable" can be shown (REL-8 D3). */
export function onChargedAbilityRulesChange(cb: () => void): () => void {
  const offChange = source.onChange(cb);
  const offSettled = source.onSettled(cb);
  return () => { offChange(); offSettled(); };
}

/** The first load finished without rules; false while loading and once a later chunk resolves them. */
export function areChargedAbilityRulesUnreadable(): boolean {
  const status = source.status();
  return status.settled && !status.resolved;
}

export function getChargedAbilityRulesStatus(): ChargedAbilityRulesStatus {
  return { ...source.status(), rules: source.get() };
}
