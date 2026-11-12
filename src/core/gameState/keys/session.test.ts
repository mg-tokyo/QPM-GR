import { describe, expect, it } from 'vitest';
import type { AtomSourceSpec, SourceSpec } from '../types';
import { SESSION_KEYS } from './session';
import { GAME_STATE_KEYS, validateKeyTable } from './index';

const rung = (key: keyof typeof SESSION_KEYS): AtomSourceSpec<unknown> =>
  (SESSION_KEYS[key].sources as readonly SourceSpec<unknown>[])[0] as AtomSourceSpec<unknown>;
const accepts = (key: keyof typeof SESSION_KEYS, v: unknown): boolean => rung(key).structure?.(v) ?? true;

describe('session keys', () => {
  it('are merged into the key table and pass the ladder policy', () => {
    for (const k of Object.keys(SESSION_KEYS)) expect(GAME_STATE_KEYS[k as keyof typeof GAME_STATE_KEYS]).toBeDefined();
    expect(validateKeyTable()).toEqual([]);
  });
  it('binds the exact label and stays read-only', () => {
    expect(rung('permanentlyDisconnectedReason').label.test('permanentlyDisconnectedReasonAtom')).toBe(true);
    expect(rung('permanentlyDisconnectedReason').label.test('isPermanentlyDisconnectedAtom')).toBe(false);
    expect(rung('permanentlyDisconnectedReason').writable).not.toBe(true);
    expect(SESSION_KEYS.permanentlyDisconnectedReason.defaultValue).toBeNull();
  });
  it('accepts a close code or null only', () => {
    expect(accepts('permanentlyDisconnectedReason', null)).toBe(true);
    expect(accepts('permanentlyDisconnectedReason', 4710)).toBe(true);
    expect(accepts('permanentlyDisconnectedReason', 'VersionExpired')).toBe(false);
    expect(accepts('permanentlyDisconnectedReason', 4710.5)).toBe(false);
    expect(accepts('permanentlyDisconnectedReason', undefined)).toBe(false);
  });
});
