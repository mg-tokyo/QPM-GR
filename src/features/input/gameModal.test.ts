import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UI_KEYS } from '../../core/gameState/keys/ui';
import type { AtomSourceSpec } from '../../core/gameState/types';

const state: Record<string, unknown> = {};
const writes: Array<[string, unknown]> = [];
let failBagWrite = false;

vi.mock('../../core/gameState', () => ({
  read: vi.fn(async (key: string) => state[key] ?? null),
  readSync: vi.fn((key: string) => state[key] ?? null),
  write: vi.fn(async (key: string, value: unknown) => {
    if (key === 'inventoryModalIsActive' && failBagWrite) throw new Error('read-only');
    writes.push([key, value]);
    state[key] = value;
  }),
}));

const { nextModalState, openGameModal, toggleBag, toggleGameModal } = await import('./gameModal');

describe('nextModalState', () => {
  it('sets the modal and bumps openId', () => {
    expect(nextModalState({ modal: null, openId: 0 }, 'seedShop')).toEqual({ modal: 'seedShop', openId: 1 });
    expect(nextModalState({ modal: 'eggShop', openId: 7 }, 'eggShop')).toEqual({ modal: 'eggShop', openId: 8 });
  });
  it('starts at 1 without a previous state', () => {
    expect(nextModalState(null, 'toolShop')).toEqual({ modal: 'toolShop', openId: 1 });
  });
});

describe('openGameModal closes the bag (INP-1.4a, D6)', () => {
  beforeEach(() => {
    for (const key of Object.keys(state)) delete state[key];
    writes.length = 0;
    failBagWrite = false;
    state.activeModalState = { modal: null, openId: 4 };
  });

  it('opens the panel, then closes an open bag (game order)', async () => {
    state.inventoryModalIsActive = true;
    await openGameModal('seedShop');
    expect(writes).toEqual([
      ['activeModalState', { modal: 'seedShop', openId: 5 }],
      ['inventoryModalIsActive', false],
    ]);
  });

  it('leaves a closed bag alone', async () => {
    state.inventoryModalIsActive = false;
    await openGameModal('petHutch');
    expect(writes).toEqual([['activeModalState', { modal: 'petHutch', openId: 5 }]]);
  });

  it('still opens when the bag write throws', async () => {
    state.inventoryModalIsActive = true;
    failBagWrite = true;
    await expect(openGameModal('journal')).resolves.toBeUndefined();
    expect(state.activeModalState).toEqual({ modal: 'journal', openId: 5 });
  });
});

describe('toggleGameModal (INP-1.4b: the same key closes its panel)', () => {
  beforeEach(() => {
    for (const key of Object.keys(state)) delete state[key];
    writes.length = 0;
    failBagWrite = false;
  });

  it('closes the panel when it is the one open', async () => {
    state.activeModalState = { modal: 'seedSilo', openId: 3 };
    await toggleGameModal('seedSilo');
    expect(writes).toEqual([['activeModalState', { modal: null, openId: 4 }]]);
  });
  it('opens it over another panel and closes the bag', async () => {
    state.activeModalState = { modal: 'journal', openId: 3 };
    state.inventoryModalIsActive = true;
    await toggleGameModal('seedSilo');
    expect(writes).toEqual([
      ['activeModalState', { modal: 'seedSilo', openId: 4 }],
      ['inventoryModalIsActive', false],
    ]);
  });
});

describe('toggleBag (game E key, modalAtom.ts:455-476)', () => {
  beforeEach(() => {
    for (const key of Object.keys(state)) delete state[key];
    writes.length = 0;
    failBagWrite = false;
  });

  it('closes a bag in front', async () => {
    state.activeModalState = { modal: null, openId: 2 };
    state.inventoryModalIsActive = true;
    await toggleBag();
    expect(writes).toEqual([['inventoryModalIsActive', false]]);
  });
  it('brings a bag under a panel back by closing the panel', async () => {
    state.activeModalState = { modal: 'seedShop', openId: 2 };
    state.inventoryModalIsActive = true;
    await toggleBag();
    expect(writes).toEqual([
      ['activeModalState', { modal: null, openId: 3 }],
      ['inventoryModalIsActive', true],
    ]);
  });
  it('opens a closed bag', async () => {
    state.activeModalState = { modal: null, openId: 2 };
    state.inventoryModalIsActive = false;
    await toggleBag();
    expect(writes).toEqual([['inventoryModalIsActive', true]]);
  });
});

describe('activeModalState key', () => {
  const rung = UI_KEYS.activeModalState.sources[0] as AtomSourceSpec<unknown>;
  it('binds only the writable state atom', () => {
    expect(rung.label.test('activeModalStateAtom')).toBe(true);
    expect(rung.label.test('activeModalAtom')).toBe(false);
    expect(rung.writable).toBe(true);
  });
  it('projects the {modal, openId} shape and rejects others', () => {
    expect(rung.project!({ modal: null, openId: 0 })).toEqual({ modal: null, openId: 0 });
    expect(rung.project!({ modal: 'seedShop', openId: 3, extra: 1 })).toEqual({ modal: 'seedShop', openId: 3 });
    expect(rung.project!('seedShop')).toBeUndefined();
    expect(rung.project!({ modal: 4, openId: 0 })).toBeUndefined();
    expect(rung.project!(null)).toBeUndefined();
  });
});

describe('inventoryModalIsActive key', () => {
  const rung = UI_KEYS.inventoryModalIsActive.sources[0] as AtomSourceSpec<unknown>;
  it('binds the writable bag flag and keeps only booleans', () => {
    expect(rung.label.test('inventoryModalIsActiveAtom')).toBe(true);
    expect(rung.writable).toBe(true);
    expect(rung.project!(true)).toBe(true);
    expect(rung.project!(false)).toBe(false);
    expect(rung.project!(null)).toBeUndefined();
  });
});
