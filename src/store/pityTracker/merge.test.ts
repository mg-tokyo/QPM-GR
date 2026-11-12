import { describe, expect, it } from 'vitest';
import { mergePityCopies, type PityCopy } from './merge';
import { applyRoll } from './rolls';
import { CURRENT_VERSION, defaultState, normalizeSaved, type PityCounter, type PityHit } from './state';
import type { PullLogEntry } from './log';

const BUCKET = 'Carrot';

function roll(n: number, opts: { hit?: boolean; s?: boolean } = {}): PullLogEntry {
  const entry: PullLogEntry = { t: 1_000 + n * 10, k: 'seed', i: BUCKET, r: 'mutation', h: opts.hit ? 'Gold' : null, g: 0 };
  if (opts.s !== false) entry.s = `${1_000 + n * 10}|harvest|#0`;
  return entry;
}

function rolls(from: number, to: number, opts: { s?: boolean } = {}): PullLogEntry[] {
  const out: PullLogEntry[] = [];
  for (let n = from; n < to; n++) out.push(roll(n, { hit: n === 7, ...opts }));
  return out;
}

function replay(checkpoint: Record<string, PityCounter>, log: PullLogEntry[]): Record<string, PityCounter> {
  const target = { counters: structuredClone(checkpoint), hits: [] as PityHit[], account: null };
  for (const e of log) applyRoll(target, e.k, e.i, e.r, e.h, e.t, e.g);
  return target.counters;
}

function copy(log: PullLogEntry[], checkpointLog: PullLogEntry[] = [], since = 0): PityCopy {
  const state = defaultState();
  state.observedSince = 0;
  state.checkpoint = { counters: replay({}, checkpointLog), since };
  state.counters = replay(state.checkpoint.counters, log);
  return { state, log, rebuild: null };
}

function hits(ats: number[]): PityHit[] {
  return ats.map((at) => ({ key: 'seed:Carrot:Gold', at, observedMisses: 0, estimate: 0, thresholdPulls: 200 }));
}

describe('mergePityCopies', () => {
  const single = replay({}, rolls(0, 20));

  it('unions logs with source keys; replay equals a single-copy run', () => {
    const merged = mergePityCopies(copy(rolls(0, 15)), copy(rolls(5, 20)));
    expect(merged.log).toHaveLength(20);
    expect(replay(merged.state.checkpoint.counters, merged.log)).toEqual(single);
    expect(merged.rebuild).toEqual({ dropped: 0 });
  });

  it('keeps two rolls that share a tuple but not a source key', () => {
    const crop0 = { ...roll(1), s: 'h#0' };
    const crop1 = { ...roll(1), s: 'h#1' };
    const merged = mergePityCopies(copy([crop0]), copy([crop0, crop1]));
    expect(merged.log.map((e) => e.s)).toEqual(['h#0', 'h#1']);
  });

  it('unions entries without a source key by the larger count of each tuple', () => {
    const twice = copy([roll(1, { s: false }), roll(1, { s: false })]);
    expect(mergePityCopies(twice, copy([roll(1, { s: false })]))).toBe(twice);
    const thrice = copy([roll(1, { s: false }), roll(1, { s: false }), roll(1, { s: false })]);
    expect(mergePityCopies(twice, thrice).log).toHaveLength(3);
    const merged = mergePityCopies(copy(rolls(0, 15, { s: false })), copy(rolls(5, 20, { s: false })));
    expect(replay(merged.state.checkpoint.counters, merged.log)).toEqual(single);
  });

  it('PD1: the bigger checkpoint is the base; the other copy loses unmatched entries before its since', () => {
    const folded = copy(rolls(10, 20, { s: false }), rolls(0, 10), roll(10).t);
    const legacy = copy(rolls(0, 15, { s: false }));
    const fromLegacy = mergePityCopies(legacy, folded);
    expect(fromLegacy.state.checkpoint).toBe(folded.state.checkpoint);
    expect(replay(fromLegacy.state.checkpoint.counters, fromLegacy.log)).toEqual(single);
    expect(fromLegacy.rebuild).toEqual({ dropped: 10 });
    expect(mergePityCopies(folded, legacy)).toBe(folded);
  });

  it('on equal checkpoints the earlier since is the base, so an unfolded log loses nothing', () => {
    const lateSite = copy(rolls(10, 20), [], roll(10).t);
    const earlySite = copy(rolls(0, 15), [], 0);
    const merged = mergePityCopies(lateSite, earlySite);
    expect(merged.state.checkpoint).toBe(earlySite.state.checkpoint);
    expect(merged.rebuild).toEqual({ dropped: 0 });
    expect(replay(merged.state.checkpoint.counters, merged.log)).toEqual(single);
    expect(mergePityCopies(merged, lateSite)).toBe(merged);
  });

  it('returns a itself when b adds nothing, and a re-merge is a no-op', () => {
    const a = copy(rolls(0, 15));
    expect(mergePityCopies(a, copy(rolls(3, 9)))).toBe(a);
    const b = copy(rolls(10, 20), rolls(0, 10), roll(10).t);
    a.state.hits = hits(Array.from({ length: 50 }, (_, n) => n * 2 + 1));
    b.state.hits = hits(Array.from({ length: 50 }, (_, n) => n * 2));
    const merged = mergePityCopies(a, b);
    expect(merged.state.hits.map((h) => h.at)).toEqual(Array.from({ length: 50 }, (_, n) => n + 50));
    expect(mergePityCopies(merged, b)).toBe(merged);
    expect(mergePityCopies(merged, a)).toBe(merged);
  });

  it('merges account, lifetime and seen keys without touching counters', () => {
    const a = copy([]);
    const b = copy([]);
    a.state.account = { createdAt: null, fetchedAt: 5 };
    b.state.account = { createdAt: 100, fetchedAt: 1 };
    a.state.lifetime = { eggs: 10, crops: null, capsules: { DawnCapsule: 3 } };
    b.state.lifetime = { eggs: 8, crops: 40, capsules: { DawnCapsule: 4, AmberCapsule: 1 } };
    b.state.seenKeys = ['2000|harvest|'];
    const merged = mergePityCopies(a, b);
    expect(merged.state.account).toEqual({ createdAt: 100, fetchedAt: 1 });
    expect(merged.state.lifetime).toEqual({ eggs: 10, crops: 40, capsules: { DawnCapsule: 4, AmberCapsule: 1 } });
    expect(merged.state.seenKeys).toEqual(['2000|harvest|']);
    expect(merged.rebuild).toBeNull();
  });
});

describe('normalizeSaved', () => {
  it('turns pre-v6 counters into the checkpoint and resets the log', () => {
    const counters = replay({}, rolls(0, 3));
    const out = normalizeSaved({ counters, meta: { version: 5, updatedAt: 1 } }, { version: 1, entries: rolls(0, 3) });
    expect(out.logReset).toBe(true);
    expect(out.log).toEqual([]);
    expect(out.state.checkpoint.counters).toEqual(counters);
  });

  it('keeps a current log, including entries without a source key', () => {
    const entries = [roll(2), roll(1, { s: false })];
    const out = normalizeSaved({ counters: {}, meta: { version: CURRENT_VERSION, updatedAt: 1 } }, { version: 1, entries });
    expect(out.logReset).toBe(false);
    expect(out.log.map((e) => e.t)).toEqual([roll(1).t, roll(2).t]);
  });

  it('starts fresh from an unreadable value', () => {
    expect(normalizeSaved('garbage', null).logReset).toBe(true);
  });
});
