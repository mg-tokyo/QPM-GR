import { resolveMutation } from './game/cropMultipliers';

const BASE_WATER_MUTS = new Set(['wet', 'chilled']);
const UPGRADED_WATER_MUTS = new Set(['frozen']);
const UPGRADED_DAWN_MUTS = new Set(['dawncharged']);
const UPGRADED_AMBER_MUTS = new Set(['ambercharged']);

export function normalizeCanonicalMutation(input: string): string {
  return resolveMutation(input)?.name.toLowerCase() ?? input.trim().toLowerCase();
}

export function canApplyMutation(
  mutationName: string,
  existingMutations: readonly string[],
): boolean {
  const canonicalMutation = normalizeCanonicalMutation(mutationName);
  const existingCanonical = existingMutations.map(normalizeCanonicalMutation);

  if (existingCanonical.includes(canonicalMutation)) return false;

  switch (canonicalMutation) {
    case 'wet':
    case 'chilled':
      return !existingCanonical.includes('frozen') && !existingCanonical.includes('thunderstruck');
    case 'frozen':
      return !existingCanonical.includes('thunderstruck') && !existingCanonical.includes('frozen');
    case 'thunderstruck':
      return !existingCanonical.some((mutation) => (
        BASE_WATER_MUTS.has(mutation) || UPGRADED_WATER_MUTS.has(mutation)
      ));
    case 'dawnlit':
    case 'ambershine':
      return !existingCanonical.some((mutation) => (
        mutation === 'dawnlit'
        || mutation === 'ambershine'
        || UPGRADED_DAWN_MUTS.has(mutation)
        || UPGRADED_AMBER_MUTS.has(mutation)
      ));
    case 'dawncharged':
      return (
        !existingCanonical.some((mutation) => (
          UPGRADED_DAWN_MUTS.has(mutation) || UPGRADED_AMBER_MUTS.has(mutation)
        ))
        && !existingCanonical.includes('ambershine')
      );
    case 'ambercharged':
      return (
        !existingCanonical.some((mutation) => (
          UPGRADED_DAWN_MUTS.has(mutation) || UPGRADED_AMBER_MUTS.has(mutation)
        ))
        && !existingCanonical.includes('dawnlit')
      );
    case 'rainbow':
    case 'gold':
      return !existingCanonical.some((mutation) => mutation === 'rainbow' || mutation === 'gold');
    default:
      return true;
  }
}

export function simulateMutationsAfterApplying(
  existingMutations: readonly string[],
  mutationsToAdd: readonly string[],
): string[] {
  let state = existingMutations.map(normalizeCanonicalMutation);

  for (const mutationName of mutationsToAdd) {
    const canonicalMutation = normalizeCanonicalMutation(mutationName);
    if (!canApplyMutation(canonicalMutation, state)) continue;

    switch (canonicalMutation) {
      case 'wet':
        state = state.includes('chilled')
          ? [...state.filter((entry) => entry !== 'chilled'), 'frozen']
          : [...state, 'wet'];
        break;
      case 'chilled':
        state = state.includes('wet')
          ? [...state.filter((entry) => entry !== 'wet'), 'frozen']
          : [...state, 'chilled'];
        break;
      case 'frozen':
        state = [...state.filter((entry) => !BASE_WATER_MUTS.has(entry)), 'frozen'];
        break;
      case 'dawncharged':
        state = [...state.filter((entry) => entry !== 'dawnlit'), 'dawncharged'];
        break;
      case 'ambercharged':
        state = [...state.filter((entry) => entry !== 'ambershine'), 'ambercharged'];
        break;
      default:
        state = [...state, canonicalMutation];
        break;
    }
  }

  return state;
}

export function getMutationApplicationResult(
  existingMutations: readonly string[],
  mutationToAdd: string,
): string[] | null {
  if (!canApplyMutation(mutationToAdd, existingMutations)) return null;
  return simulateMutationsAfterApplying(existingMutations, [mutationToAdd]);
}
