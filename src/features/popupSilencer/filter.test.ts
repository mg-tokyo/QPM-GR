import { describe, expect, it } from 'vitest';
import { createAtomWriteInterceptor } from '../../utils/game/atomWriteInterceptor';
import { classifyToast, filterToastList, silenceUpdate, type DropKind, type SilenceRules } from './filter';

type Toast = Record<string, unknown> & { id: string };

// Mirrors the game's add (beta toastAtoms.ts:250-257): other non-stackables leave, same id replaces in place.
const gameAdd = (toast: Toast) => (current: Toast[]): Toast[] => {
  const kept = current.filter((e) => e.id === toast.id || toast.isStackable === true || e.isStackable === true);
  const i = kept.findIndex((e) => e.id === toast.id);
  return i === -1 ? [...kept, toast] : kept.map((e, j) => (j === i ? toast : e));
};

const ability = (title: string, extra: Record<string, unknown> = {}): Toast => ({ id: 'quinoa-game-toast', title, description: 'd', ...extra });
const levelUpTitle = (sprite: string) => ({ kind: 'rich', content: '<0/>', tags: { 0: { gameThing: { name: 'x', sprite } } } });
const levelUp = (petId: string, sprite: string): Toast => ({ id: `pet-level-up-${petId}`, isStackable: true, variant: 'success', title: levelUpTitle(sprite) });
const RULES: SilenceRules = { abilityNames: new Set(['Coin Finder I']), levelUps: true };

function apply(current: Toast[], toast: Toast, rules = RULES): { list: unknown; drops: DropKind[] } {
  const drops: DropKind[] = [];
  const wrapped = silenceUpdate(gameAdd(toast), () => current, rules, (k) => drops.push(k)) as (c: Toast[]) => unknown;
  return { list: wrapped(current), drops };
}

describe('popupSilencer filter', () => {
  it('drops a silenced ability popup and keeps others', () => {
    expect(apply([], ability('Coin Finder I')).list).toEqual([]);
    expect(apply([], ability('Coin Finder I')).drops).toEqual(['ability']);
    const kept = apply([], ability('Seed Finder I'));
    expect(kept.list).toEqual([ability('Seed Finder I')]);
    expect(kept.drops).toEqual([]);
  });

  it('a dropped add leaves the previous toast in place, same list reference', () => {
    const prev = [ability('Seed Finder I')];
    expect(apply(prev, ability('Coin Finder I')).list).toBe(prev);
  });

  it('keeps error, stackable and non-default toasts with a silenced name', () => {
    for (const t of [
      ability('Coin Finder I', { variant: 'error' }),
      ability('Coin Finder I', { isStackable: true, id: 'quinoa-stackable-1' }),
      ability('Coin Finder I', { toastType: 'questProgress' }),
    ]) expect(classifyToast(t, RULES)).toBeNull();
  });

  it('drops "Level up!" (ProgressStar) and keeps "Fully grown!" (StrengthStar)', () => {
    const shown = ability('Seed Finder I');
    const up = apply([shown], levelUp('p1', 'sprite/ui/ProgressStar'));
    expect(up.list).toEqual([shown]);
    expect(up.drops).toEqual(['levelUp']);
    const grown = levelUp('p1', 'sprite/ui/StrengthStar');
    expect(apply([shown], grown).list).toEqual([shown, grown]);
  });

  it('keeps a level-up toast whose title shape has no sprite, and all level-ups when the toggle is off', () => {
    expect(classifyToast({ id: 'pet-level-up-p1', title: 'Level up!' }, RULES)).toBeNull();
    expect(classifyToast(levelUp('p1', 'sprite/ui/ProgressStar'), { ...RULES, levelUps: false })).toBeNull();
  });

  it('only drops the silenced entries when one update adds several', () => {
    const a = ability('Coin Finder I');
    const b = levelUp('p2', 'sprite/ui/StrengthStar');
    const out = filterToastList([], [a, b], RULES, () => {});
    expect(out).toEqual([b]);
  });

  it('filters plain array updates against the previous value', () => {
    const prev: Toast[] = [];
    const drops: DropKind[] = [];
    expect(silenceUpdate([ability('Coin Finder I')], () => prev, RULES, (k) => drops.push(k))).toBe(prev);
    expect(drops).toEqual(['ability']);
  });

  it('works under the shared write interceptor, chained inside another wrapper', () => {
    let value: Toast[] = [];
    const atom = {
      write(this: unknown, _g: unknown, _s: unknown, update: unknown) {
        value = typeof update === 'function' ? (update as (c: Toast[]) => Toast[])(value) : (update as Toast[]);
      },
    };
    createAtomWriteInterceptor('popupSilencer.test').install(atom, (u, readPrev) => silenceUpdate(u, readPrev, RULES, () => {}));
    const inner = atom.write;
    let outerCalls = 0;
    atom.write = function (this: unknown, g: unknown, s: unknown, u: unknown) { outerCalls += 1; return inner.call(this, g, s, u); };
    const send = (t: Toast) => atom.write.call(atom, () => value, null, gameAdd(t));
    send(ability('Seed Finder I'));
    send(ability('Coin Finder I'));
    send(levelUp('p1', 'sprite/ui/ProgressStar'));
    expect(value).toEqual([ability('Seed Finder I')]);
    expect(outerCalls).toBe(3);
  });
});
