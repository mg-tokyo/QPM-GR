import type { BubbleLine, BubbleTag, CurrencyTag, MutationTag, Slot } from './types';

export const mutationTag = (mutationId: string): MutationTag => ({ mutation: mutationId });
export const coinsTag = (amount: number): CurrencyTag => ({ currency: { kind: 'currencyAmount', currency: 'coins', amount } });

const tidy = (s: string): string => s.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,!?])/g, '$1').trim();

// The game switches to its tagged renderer when `tags` is present at all, even
// if empty — so `tags` is omitted unless at least one marker survives.
export function fillTemplate(template: string, slots: readonly Slot[]): BubbleLine {
  const tags: Record<number, BubbleTag> = {};
  let next = 0;
  const message = template.replace(/<(\d+)\/>/g, (_m, raw: string) => {
    const slot = slots[Number(raw)];
    if (slot === undefined) return '';
    if (typeof slot === 'string') return slot;
    tags[next] = slot;
    return `<${next++}/>`;
  });
  return next === 0 ? { message: tidy(message) } : { message: tidy(message), tags };
}
