import { describe, expect, it } from 'vitest';
import { coinsTag, fillTemplate, mutationTag } from './bubbleTags';

describe('fillTemplate', () => {
  it('keeps tag slots as numbered markers', () => {
    const out = fillTemplate('Crops turn <0/> worth <1/>.', [mutationTag('Wet'), coinsTag(1200)]);
    expect(out.message).toBe('Crops turn <0/> worth <1/>.');
    expect(out.tags).toEqual({ 0: { mutation: 'Wet' }, 1: { currency: { kind: 'currencyAmount', currency: 'coins', amount: 1200 } } });
  });
  it('inlines string slots and renumbers the remaining tags', () => {
    const out = fillTemplate('<0/> restocks soon, worth <1/>.', ['Carrot Seed', coinsTag(5)]);
    expect(out.message).toBe('Carrot Seed restocks soon, worth <0/>.');
    expect(out.tags).toEqual({ 0: { currency: { kind: 'currencyAmount', currency: 'coins', amount: 5 } } });
  });
  it('omits tags entirely when every slot is text', () => {
    expect(fillTemplate('Hi <0/>.', ['Bob'])).toEqual({ message: 'Hi Bob.' });
  });
  it('drops a marker with no slot and tidies spacing', () => {
    expect(fillTemplate('A <0/> b <1/> .', ['x'])).toEqual({ message: 'A x b.' });
  });
});
