// One mutation rule engine for all of QPM (ALR-5 Task 2), modelled on the game's updateMutationList.
// Exclusivity comes from the catalog `group`; replace / combine / clear cases from the rules parsed out
// of the bundle (catalogs/logic/mutationRulesCatalog.ts). A mutation without a parsed rule gets the
// group-only rule (ALR-5 PD1): blocked by any other mutation of its group, then appended.

import { getMutation } from '../catalogs/gameCatalogs';
import { getMutationRule } from '../catalogs/logic/mutationRulesCatalog';
import { resolveMutation } from './game/cropMultipliers';

/** Catalog id for a mutation name or alias ('Amberlit' → 'Ambershine'); unknown names come back trimmed. */
export function normalizeCanonicalMutation(input: string): string {
  return resolveMutation(input)?.name ?? input.trim();
}

function groupOf(id: string): string | null {
  const group = getMutation(id)?.group;
  return typeof group === 'string' ? group : null;
}

function canApplyCanonical(add: string, existing: readonly string[]): boolean {
  if (existing.includes(add)) return false;
  const group = groupOf(add);
  // No group known (catalog absent or a new id): nothing to check against, as the game's group test.
  if (group === null) return true;
  const mayReplace = getMutationRule(add)?.mayReplace ?? [];
  return !existing.some((m) => m !== add && groupOf(m) === group && !mayReplace.includes(m));
}

function applyCanonical(add: string, existing: readonly string[]): string[] {
  const rule = getMutationRule(add);
  if (!rule) return [...existing, add];
  if (rule.combine && existing.includes(rule.combine.with)) {
    const combineWith = rule.combine.with;
    return [...existing.filter((m) => m !== combineWith), rule.combine.into];
  }
  let next = [...existing];
  const cleared = rule.clearsGroup;
  if (cleared !== null) next = next.filter((m) => groupOf(m) !== cleared);
  next = next.filter((m) => !rule.removes.includes(m));
  next.push(rule.adds);
  return next;
}

export function canApplyMutation(mutationName: string, existingMutations: readonly string[]): boolean {
  return canApplyCanonical(normalizeCanonicalMutation(mutationName), existingMutations.map(normalizeCanonicalMutation));
}

/** The crop's mutations after applying each of `mutationsToAdd` in order; refused ones are skipped. Catalog ids. */
export function simulateMutationsAfterApplying(
  existingMutations: readonly string[],
  mutationsToAdd: readonly string[],
): string[] {
  let state = existingMutations.map(normalizeCanonicalMutation);
  for (const name of mutationsToAdd) {
    const add = normalizeCanonicalMutation(name);
    if (canApplyCanonical(add, state)) state = applyCanonical(add, state);
  }
  return state;
}

/** The crop's mutations after `mutationToAdd`, or null when the game would refuse it. */
export function getMutationApplicationResult(
  existingMutations: readonly string[],
  mutationToAdd: string,
): string[] | null {
  const existing = existingMutations.map(normalizeCanonicalMutation);
  const add = normalizeCanonicalMutation(mutationToAdd);
  return canApplyCanonical(add, existing) ? applyCanonical(add, existing) : null;
}

/** The subset of `toAdd` that lands, applied in order (an earlier one can block a later one). Input names kept. */
export function filterCompatibleMutations(existing: readonly string[], toAdd: readonly string[]): string[] {
  let state = existing.map(normalizeCanonicalMutation);
  const result: string[] = [];
  for (const name of toAdd) {
    const add = normalizeCanonicalMutation(name);
    if (!canApplyCanonical(add, state)) continue;
    result.push(name);
    state = applyCanonical(add, state);
  }
  return result;
}
