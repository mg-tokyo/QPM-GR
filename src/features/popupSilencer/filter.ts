import { isRecord } from '../../utils/typeGuards';

export type DropKind = 'ability' | 'levelUp';

export interface SilenceRules {
  abilityNames: ReadonlySet<string>;
  levelUps: boolean;
}

// Beta petLevelUpToast.ts:79-86: "Level up!" and "Fully grown!" share the id `pet-level-up-<petId>` and differ
// only by the title sprite (ProgressStar vs StrengthStar).
const LEVEL_UP_ID_PREFIX = 'pet-level-up-';
const LEVEL_UP_SPRITE = /(?:^|\/)ProgressStar$/;
const MAX_TITLE_DEPTH = 5;

function findSprite(value: unknown, depth: number): string | null {
  if (depth > MAX_TITLE_DEPTH || !isRecord(value)) return null;
  if (typeof value.sprite === 'string') return value.sprite;
  for (const child of Object.values(value)) {
    const found = findSprite(child, depth + 1);
    if (found !== null) return found;
  }
  return null;
}

export function classifyToast(toast: unknown, rules: SilenceRules): DropKind | null {
  if (!isRecord(toast)) return null;
  if (typeof toast.id === 'string' && toast.id.startsWith(LEVEL_UP_ID_PREFIX)) {
    if (!rules.levelUps) return null;
    // No sprite found means an unknown title shape: keep the toast rather than risk hiding "Fully grown!".
    const sprite = findSprite(toast.title, 0);
    return sprite !== null && LEVEL_UP_SPRITE.test(sprite) ? 'levelUp' : null;
  }
  if (rules.abilityNames.size === 0) return null;
  // Ability popups: default toast, plain dex name as title, no id (beta installPetEffects.ts:259-268).
  // "Couldn't activate X" is variant 'error' (:244-249) and stays.
  if (toast.toastType !== undefined && toast.toastType !== 'default') return null;
  if (toast.variant === 'error' || toast.isStackable === true) return null;
  return typeof toast.title === 'string' && rules.abilityNames.has(toast.title) ? 'ability' : null;
}

/** Drops silenced toasts that `next` adds over `prev`; when every added toast is silenced, `prev` comes back untouched. */
export function filterToastList(prev: unknown, next: unknown, rules: SilenceRules, onDrop: (kind: DropKind) => void): unknown {
  if (!Array.isArray(next)) return next;
  const before: readonly unknown[] = Array.isArray(prev) ? prev : [];
  const added = next.filter((t) => !before.includes(t));
  if (added.length === 0) return next;
  const dropped = new Set<unknown>();
  for (const t of added) {
    const kind = classifyToast(t, rules);
    if (kind) { dropped.add(t); onDrop(kind); }
  }
  if (dropped.size === 0) return next;
  // The game's add also clears other non-stackable toasts (toastAtoms.ts:250-257); returning prev undoes that too.
  if (dropped.size === added.length && Array.isArray(prev)) return prev;
  return next.filter((t) => !dropped.has(t));
}

export function silenceUpdate(
  update: unknown,
  readPrev: () => unknown,
  rules: SilenceRules,
  onDrop: (kind: DropKind) => void,
): unknown {
  if (typeof update === 'function') {
    const fn = update as (current: unknown) => unknown;
    return (current: unknown) => filterToastList(current, fn(current), rules, onDrop);
  }
  return filterToastList(readPrev(), update, rules, onDrop);
}
