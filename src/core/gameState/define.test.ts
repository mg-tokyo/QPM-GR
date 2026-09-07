import { describe, expect, it } from 'vitest';
import { assertLadderPolicy, atomSource, customSource, defineKey, stateSource } from './define';

const st = stateSource<number>('/x', () => 1);
const authAtom = atomSource<number>(/^aAtom$/, 'authoritative');
const predAtom = atomSource<number>(/^pAtom$/, 'predicted');
const custom = customSource<number>({ id: 'c', available: () => true, read: () => 1 });

describe('assertLadderPolicy', () => {
  it('accepts a valid authoritative ladder', () => {
    expect(assertLadderPolicy('k', defineKey({ sources: [st, authAtom], policy: 'authoritative', doc: '' }))).toEqual([]);
  });
  it('rejects authoritative ladders that do not start with stateTree', () => {
    expect(assertLadderPolicy('k', defineKey({ sources: [authAtom, st], policy: 'authoritative', doc: '' }))).toHaveLength(1);
  });
  it('requires predicted ladders to start with a predicted atom and include stateTree', () => {
    expect(assertLadderPolicy('k', defineKey({ sources: [predAtom, st], policy: 'predicted', doc: '' }))).toEqual([]);
    expect(assertLadderPolicy('k', defineKey({ sources: [predAtom], policy: 'predicted', doc: '' }))).toHaveLength(1);
    expect(assertLadderPolicy('k', defineKey({ sources: [authAtom, st], policy: 'predicted', doc: '' }))).toHaveLength(1);
  });
  it('forbids stateTree on client keys and flags empty ladders and duplicate labels', () => {
    expect(assertLadderPolicy('k', defineKey({ sources: [authAtom, custom], policy: 'client', doc: '' }))).toEqual([]);
    expect(assertLadderPolicy('k', defineKey({ sources: [st], policy: 'client', doc: '' }))).toHaveLength(1);
    expect(assertLadderPolicy('k', defineKey({ sources: [], policy: 'client', doc: '' }))).toEqual(['k: no sources']);
    expect(assertLadderPolicy('k', defineKey({ sources: [authAtom, authAtom], policy: 'client', doc: '' }))).toHaveLength(1);
  });
});
