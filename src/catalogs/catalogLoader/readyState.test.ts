import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { onPetAbilitiesCaptured, notifyPetAbilitiesCaptured } from './readyState';
import { capturedCatalogs, petAbilitiesCallbacks } from './state';
import type { GameCatalogs } from '../types';

const FAKE_CATALOG = { TestAbility: { name: 'Test' } } as unknown as GameCatalogs['petAbilities'];

function setCaptured(captured: boolean): void {
  capturedCatalogs.petAbilities = captured ? FAKE_CATALOG : null;
}

describe('onPetAbilitiesCaptured', () => {
  beforeEach(() => {
    petAbilitiesCallbacks.length = 0;
    setCaptured(false);
  });

  afterEach(() => {
    petAbilitiesCallbacks.length = 0;
    setCaptured(false);
  });

  it('fires a pre-capture listener on every notify (persistent, not one-shot)', () => {
    let calls = 0;
    onPetAbilitiesCaptured(() => { calls++; });

    setCaptured(true);
    notifyPetAbilitiesCaptured();
    expect(calls).toBe(1);

    // Upgrade / bundle-text top-up re-notifies — listener must still be wired.
    notifyPetAbilitiesCaptured();
    expect(calls).toBe(2);
  });

  it('invokes a post-capture subscriber immediately AND keeps it registered', () => {
    setCaptured(true);
    let calls = 0;
    onPetAbilitiesCaptured(() => { calls++; });
    expect(calls).toBe(1);

    notifyPetAbilitiesCaptured();
    expect(calls).toBe(2);
  });

  it('honors unsubscribe', () => {
    let calls = 0;
    const unsub = onPetAbilitiesCaptured(() => { calls++; });
    setCaptured(true);
    notifyPetAbilitiesCaptured();
    unsub();
    notifyPetAbilitiesCaptured();
    expect(calls).toBe(1);
  });

  it('defers a subscription made during notify to the next fire', () => {
    let innerCalls = 0;
    onPetAbilitiesCaptured(() => {
      onPetAbilitiesCaptured(() => { innerCalls++; });
    });

    setCaptured(true);
    notifyPetAbilitiesCaptured();
    expect(innerCalls).toBe(0);

    notifyPetAbilitiesCaptured();
    expect(innerCalls).toBe(1);
  });

  it('does not recurse when a post-capture callback re-subscribes itself (QPM-CATALOG-004 regression)', () => {
    setCaptured(true);
    let calls = 0;
    const rewire = (): void => {
      calls++;
      onPetAbilitiesCaptured(rewire);
    };
    // Old semantics: sync immediate invoke on an already-captured catalog made
    // this mutually recursive until "Maximum call stack size exceeded" /
    // "too much recursion".
    onPetAbilitiesCaptured(rewire);
    expect(calls).toBe(1);
  });

  it('does not recurse when a notify listener re-subscribes itself post-capture', () => {
    let calls = 0;
    const onCapture = (): void => {
      calls++;
      onPetAbilitiesCaptured(onCapture);
    };
    onPetAbilitiesCaptured(onCapture);
    setCaptured(true);
    notifyPetAbilitiesCaptured();
    expect(calls).toBe(1);
  });
});
