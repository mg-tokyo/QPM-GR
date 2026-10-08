import { describe, expect, it } from 'vitest';
import { InstallStack } from './installStack';

const STEPS = ['passes', 'runtime', 'render', 'zoom', 'picker', 'remap', 'look', 'movement'];

/** Installs STEPS in order on `tx`, throwing inside the install named `throwAt`; returns the undo log. */
function run(tx: InstallStack, throwAt: string | null): { log: string[]; threw: boolean } {
  const log: string[] = [];
  let threw = false;
  try {
    for (const name of STEPS) {
      tx.add(name, () => { if (name === throwAt) throw new Error(name); log.push(`+${name}`); return name; }, (v) => { log.push(`-${v}`); });
    }
  } catch {
    threw = true;
    tx.unwind();
  }
  return { log, threw };
}

describe('InstallStack', () => {
  it('unwinds in reverse install order', () => {
    const tx = new InstallStack();
    const log: string[] = [];
    for (const name of STEPS) tx.add(name, () => name, (v) => { log.push(v); });
    expect(tx.size).toBe(STEPS.length);
    tx.unwind();
    expect(log).toEqual([...STEPS].reverse());
    expect(tx.size).toBe(0);
  });

  it('a throw at any step undoes exactly the steps before it, and names the step', () => {
    for (let k = 0; k < STEPS.length; k++) {
      const tx = new InstallStack();
      const { log, threw } = run(tx, STEPS[k]!);
      expect(threw).toBe(true);
      expect(tx.step).toBe(STEPS[k]);
      expect(tx.size).toBe(0);
      const before = STEPS.slice(0, k);
      expect(log).toEqual([...before.map((s) => `+${s}`), ...[...before].reverse().map((s) => `-${s}`)]);
    }
  });

  it('an undo that throws does not stop the others', () => {
    const tx = new InstallStack();
    const log: string[] = [];
    tx.add('a', () => 'a', () => { log.push('a'); });
    tx.add('b', () => 'b', () => { throw new Error('b'); });
    tx.add('c', () => 'c', () => { log.push('c'); });
    tx.unwind();
    expect(log).toEqual(['c', 'a']);
  });

  it('an injected fault throws at that step before its install runs', () => {
    for (const fault of STEPS) {
      const tx = new InstallStack(fault);
      const { log, threw } = run(tx, null);
      expect(threw).toBe(true);
      expect(tx.step).toBe(fault);
      expect(log.includes(`+${fault}`)).toBe(false);
      expect(tx.size).toBe(0);
    }
    const tx = new InstallStack('nope');
    expect(run(tx, null).threw).toBe(false);
    expect(tx.size).toBe(STEPS.length);
  });

  it('unwind is idempotent', () => {
    const tx = new InstallStack();
    let n = 0;
    tx.add('a', () => 1, () => { n++; });
    tx.unwind();
    tx.unwind();
    expect(n).toBe(1);
  });
});
