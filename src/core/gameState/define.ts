// Key/source constructors + the policy assertion.
import type {
  AtomSemantics, AtomSourceSpec, CustomSourceSpec, IdentityContext, KeyDefinition,
  Selected, SourceSpec, StateTreeSourceSpec,
} from './types';
import type { PatchPath } from '../reactive/types';
import type { QuinoaStateSnapshot } from '../../types/gameAtoms';

export function defineKey<T>(def: KeyDefinition<T>): KeyDefinition<T> {
  return def;
}

// Pet upkeep the server patches every frame (hunger + xp per pet once a
// second, motion every couple of seconds). Whole-slot keys ignore them: their
// consumers read gardens, inventories, shops and logs, while pet features read
// `activePetSlots` / `petSlotInfos`, which still wake on every tick. A trailing
// '/' means "path contains this segment", otherwise the path must end with it.
export const PET_TICK_PATCH_PATHS: readonly string[] = ['/hunger', '/xp', '/motion/'];
// Root keys additionally skip the server clock (patched every frame) — their
// consumers ingest shops/user slots, never the clock.
export const ROOT_TICK_PATCH_PATHS: readonly string[] = [...PET_TICK_PATCH_PATHS, '/currentTime', '/secondsUntilRestock'];

export function stateSource<T>(
  statePath: PatchPath,
  select: (state: QuinoaStateSnapshot, identity: IdentityContext) => Selected<T>,
  opts: { trustPatches?: boolean; ignorePatchSuffixes?: readonly string[] } = {},
): StateTreeSourceSpec<T> {
  return {
    kind: 'stateTree',
    statePath,
    select,
    ...(opts.trustPatches === undefined ? {} : { trustPatches: opts.trustPatches }),
    ...(opts.ignorePatchSuffixes === undefined ? {} : { ignorePatchSuffixes: opts.ignorePatchSuffixes }),
  };
}

export function atomSource<T>(
  label: RegExp,
  semantics: AtomSemantics,
  extras: Omit<AtomSourceSpec<T>, 'kind' | 'label' | 'semantics'> = {},
): AtomSourceSpec<T> {
  return { kind: 'atom', label, semantics, ...extras };
}

export function customSource<T>(spec: Omit<CustomSourceSpec<T>, 'kind'>): CustomSourceSpec<T> {
  return { kind: 'custom', ...spec };
}

/**
 * Returns human-readable violations (empty = valid). Enforced at module load
 * by keys/index.ts so a mis-ordered ladder fails fast in dev and in tests.
 */
export function assertLadderPolicy(name: string, def: KeyDefinition<unknown>): string[] {
  const out: string[] = [];
  const first: SourceSpec<unknown> | undefined = def.sources[0];
  if (!first) {
    out.push(`${name}: no sources`);
    return out;
  }
  const hasState = def.sources.some((s) => s.kind === 'stateTree');
  switch (def.policy) {
    case 'authoritative':
      if (first.kind !== 'stateTree') out.push(`${name}: authoritative keys list the stateTree source first`);
      break;
    case 'predicted':
      if (first.kind !== 'atom' || first.semantics !== 'predicted') {
        out.push(`${name}: predicted keys list a predicted atom first`);
      }
      if (!hasState) out.push(`${name}: predicted keys need a stateTree fallback`);
      break;
    case 'client':
      if (hasState) out.push(`${name}: client keys cannot have a stateTree source`);
      break;
  }
  const labels = def.sources.filter((s): s is AtomSourceSpec<unknown> => s.kind === 'atom').map((s) => s.label.source);
  if (new Set(labels).size !== labels.length) out.push(`${name}: duplicate atom label`);
  return out;
}
