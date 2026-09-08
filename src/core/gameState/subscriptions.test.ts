import { describe, expect, it, vi } from 'vitest';
import { SubscriptionBook } from './subscriptions';
import type { SourceHandle } from './types';

interface FakeHandle<T> extends SourceHandle<T> {
  fire(v: T | null): void;
  subCalls: number;
  offCalls: number;
}

function makeHandle<T>(memoized: boolean): FakeHandle<T> {
  let deliver: ((v: T | null) => void) | null = null;
  const h: FakeHandle<T> = {
    kind: 'stateTree',
    index: 0,
    memoized,
    describe: () => 'fake',
    available: () => true,
    readSync: () => ({ ok: true, value: null }),
    read: () => Promise.resolve({ ok: true, value: null }),
    subscribe: (cb) => {
      h.subCalls += 1;
      deliver = cb;
      return () => { h.offCalls += 1; };
    },
    fire: (v) => { deliver?.(v); },
    subCalls: 0,
    offCalls: 0,
  };
  return h;
}

function makeBook<T>(defaultValue?: T): { book: SubscriptionBook<T>; errors: unknown[]; failures: string[] } {
  const errors: unknown[] = [];
  const failures: string[] = [];
  const book = new SubscriptionBook<T>(
    defaultValue,
    () => 1000,
    (err) => errors.push(err),
    (reason) => failures.push(reason),
  );
  return { book, errors, failures };
}

describe('SubscriptionBook', () => {
  it('subscribes upstream exactly once regardless of consumer count', () => {
    const { book } = makeBook<number>();
    const handle = makeHandle<number>(false);
    book.rebind(handle);
    const seenA: Array<number | null> = [];
    const seenB: Array<number | null> = [];
    book.add((v) => seenA.push(v));
    book.add((v) => seenB.push(v));
    handle.fire(1);
    expect(handle.subCalls).toBe(1);
    expect(seenA).toEqual([1]);
    expect(seenB).toEqual([1]);
  });

  it('a late consumer receives the last delivered value synchronously', () => {
    const { book } = makeBook<number>();
    const handle = makeHandle<number>(false);
    book.rebind(handle);
    // First consumer attaches the upstream; without it fake `fire` is inert.
    book.add(() => { /* keeps upstream alive */ });
    handle.fire(7);
    const late: Array<number | null> = [];
    book.add((v) => late.push(v));
    expect(late).toEqual([7]);
  });

  it('rebind(null) with consumers present forgets the last value; a late consumer gets nothing', () => {
    const { book } = makeBook<number>();
    const handle = makeHandle<number>(false);
    book.rebind(handle);
    book.add(() => { /* keeps upstream alive */ });
    handle.fire(7);
    book.rebind(null);
    expect(handle.offCalls).toBe(1);
    const late: Array<number | null> = [];
    book.add((v) => late.push(v));
    expect(late).toEqual([]);
    // A fresh rung delivers again once it produces a value.
    const next = makeHandle<number>(false);
    book.rebind(next);
    next.fire(7);
    expect(late).toEqual([7]);
  });

  it('memoized handle: same reference is not re-delivered, new equal-content reference IS delivered', () => {
    const { book } = makeBook<{ n: number }>();
    const handle = makeHandle<{ n: number }>(true);
    book.rebind(handle);
    const seen: Array<{ n: number } | null> = [];
    book.add((v) => seen.push(v));
    const first = { n: 1 };
    handle.fire(first);
    handle.fire(first);
    expect(seen).toEqual([{ n: 1 }]);
    const second = { n: 1 };
    handle.fire(second);
    expect(seen).toEqual([{ n: 1 }, { n: 1 }]);
    expect(seen[1]).toBe(second);
  });

  it('non-memoized handle: equal-content new reference is NOT delivered (deepEqual)', () => {
    const { book } = makeBook<{ n: number }>();
    const handle = makeHandle<{ n: number }>(false);
    book.rebind(handle);
    const seen: Array<{ n: number } | null> = [];
    book.add((v) => seen.push(v));
    handle.fire({ n: 1 });
    handle.fire({ n: 1 });
    expect(seen).toEqual([{ n: 1 }]);
    handle.fire({ n: 2 });
    expect(seen).toEqual([{ n: 1 }, { n: 2 }]);
  });

  it('rebind detaches the old upstream and ignores stale callbacks from it', () => {
    const { book } = makeBook<number>();
    const oldHandle = makeHandle<number>(false);
    const newHandle = makeHandle<number>(false);
    book.rebind(oldHandle);
    const seen: Array<number | null> = [];
    book.add((v) => seen.push(v));
    oldHandle.fire(1);
    expect(seen).toEqual([1]);
    book.rebind(newHandle);
    expect(oldHandle.offCalls).toBe(1);
    oldHandle.fire(99);
    expect(seen).toEqual([1]);
    newHandle.fire(2);
    expect(seen).toEqual([1, 2]);
  });

  it('rebind to an equal value (same content, memoized) does not re-deliver', () => {
    const { book } = makeBook<{ n: number }>();
    const oldHandle = makeHandle<{ n: number }>(true);
    const newHandle = makeHandle<{ n: number }>(true);
    book.rebind(oldHandle);
    const seen: Array<{ n: number } | null> = [];
    book.add((v) => seen.push(v));
    const v1 = { n: 1 };
    oldHandle.fire(v1);
    book.rebind(newHandle);
    newHandle.fire(v1);
    expect(seen).toEqual([{ n: 1 }]);
  });

  it('applies defaultValue when raw is null', () => {
    const { book } = makeBook<number>(42);
    const handle = makeHandle<number>(false);
    book.rebind(handle);
    const seen: Array<number | null> = [];
    book.add((v) => seen.push(v));
    handle.fire(null);
    expect(seen).toEqual([42]);
  });

  it('reports subscribe failure via onAttachFailure and delivers nothing', () => {
    const errors: unknown[] = [];
    const failures: string[] = [];
    const book = new SubscriptionBook<number>(undefined, () => 1, (e) => errors.push(e), (r) => failures.push(r));
    const handle: SourceHandle<number> = {
      kind: 'stateTree',
      index: 0,
      describe: () => 'thrower',
      available: () => true,
      readSync: () => ({ ok: false, reason: 'x' }),
      read: () => Promise.resolve({ ok: false, reason: 'x' }),
      subscribe: () => { throw new Error('boom'); },
    };
    const seen: Array<number | null> = [];
    book.add((v) => seen.push(v));
    book.rebind(handle);
    expect(failures).toEqual(['boom']);
    expect(seen).toEqual([]);
  });

  it('rebind with zero consumers does not attach the upstream', () => {
    const { book } = makeBook<number>();
    const handle = makeHandle<number>(false);
    book.rebind(handle);
    expect(handle.subCalls).toBe(0);
  });

  it('lazy attach: first add subscribes once, second add reuses the same upstream and gets the last value', () => {
    const { book } = makeBook<number>();
    const handle = makeHandle<number>(false);
    book.rebind(handle);
    const seenA: Array<number | null> = [];
    book.add((v) => seenA.push(v));
    expect(handle.subCalls).toBe(1);
    handle.fire(11);
    expect(seenA).toEqual([11]);
    const seenB: Array<number | null> = [];
    book.add((v) => seenB.push(v));
    expect(handle.subCalls).toBe(1);
    expect(seenB).toEqual([11]);
  });

  it('last consumer leaving detaches the upstream; a later consumer re-attaches and receives fresh values', () => {
    const { book } = makeBook<number>();
    const handle = makeHandle<number>(false);
    book.rebind(handle);
    const seenA: Array<number | null> = [];
    const offA = book.add((v) => seenA.push(v));
    expect(handle.subCalls).toBe(1);
    handle.fire(3);
    expect(seenA).toEqual([3]);
    offA();
    expect(handle.offCalls).toBe(1);
    const seenB: Array<number | null> = [];
    book.add((v) => seenB.push(v));
    expect(handle.subCalls).toBe(2);
    // hasValue was cleared when the last consumer left, so no stale replay.
    expect(seenB).toEqual([]);
    handle.fire(9);
    expect(seenB).toEqual([9]);
  });

  it('rebind while consumers exist keeps exactly one live upstream (old off called, new subscribe called)', () => {
    const { book } = makeBook<number>();
    const oldHandle = makeHandle<number>(false);
    const newHandle = makeHandle<number>(false);
    book.rebind(oldHandle);
    book.add(() => { /* consumer */ });
    expect(oldHandle.subCalls).toBe(1);
    book.rebind(newHandle);
    expect(oldHandle.offCalls).toBe(1);
    expect(newHandle.subCalls).toBe(1);
    expect(newHandle.offCalls).toBe(0);
  });

  it('routes consumer errors to onError and keeps delivering to siblings', () => {
    const { book, errors } = makeBook<number>();
    const handle = makeHandle<number>(false);
    book.rebind(handle);
    const seen: Array<number | null> = [];
    const spy = vi.fn(() => { throw new Error('bad'); });
    book.add(spy as (v: number | null) => void);
    book.add((v) => seen.push(v));
    handle.fire(3);
    expect(seen).toEqual([3]);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('bad');
  });
});
