import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LineId, LineProvider, BubbleLine } from './types';
import type { NpcChatBubble } from '../../types/gameAtoms';
import type { SelectorState } from './selector';
import { initialSelectorState, selectLine as realSelectLine } from './selector';

interface CompanionMock {
  isRunning?: () => unknown;
  getNpcId?: () => unknown;
  say?: (m: string, o?: unknown) => unknown;
}

const { mockRefs } = vi.hoisted(() => ({
  mockRefs: {
    providers: [] as LineProvider[],
    modal: null as string | null,
    bubbles: null as Record<string, NpcChatBubble> | null,
    companion: null as CompanionMock | null,
    settings: {
      enabled: true,
      companionInject: true,
      lines: {} as Record<LineId, boolean>,
    },
    sub: null as null | (() => void),
  },
}));

vi.mock('../../core/gameState', () => ({
  readSync: (key: string) => {
    if (key === 'activeModal') return mockRefs.modal;
    if (key === 'npcChatBubbles') return mockRefs.bubbles;
    return null;
  },
  subscribe: (_key: string, cb: () => void) => {
    mockRefs.sub = cb;
    return () => { mockRefs.sub = null; };
  },
}));

vi.mock('../../core/pageContext', () => ({
  pageWindow: new Proxy({}, {
    get(_t, prop) {
      if (prop === 'Companion') return mockRefs.companion;
      return undefined;
    },
  }),
}));

vi.mock('./settings', () => ({
  getNpcDialogueSettings: () => mockRefs.settings,
}));

vi.mock('./providers', () => ({
  get PROVIDERS() { return mockRefs.providers; },
}));

import {
  _resetForTests,
  getCompanionInjectorDiagnostics,
  startCompanionInjector,
  type CompanionInjectorDeps,
} from './companionInjector';

function makeProvider(id: LineId, opts: {
  themes?: readonly string[];
  companionOnly?: boolean;
  relevance?: number | null;
  line?: BubbleLine | null;
} = {}): LineProvider {
  return {
    id,
    themes: opts.themes ?? [],
    ...(opts.companionOnly === true ? { companionOnly: true } : {}),
    relevance: () => opts.relevance ?? 0.9,
    line: () => opts.line ?? { message: `line for ${id}` },
  };
}

function makeDeps(): { deps: CompanionInjectorDeps; ref: { state: SelectorState; lastLine: LineId | null } } {
  const ref = { state: initialSelectorState(), lastLine: null as LineId | null };
  const deps: CompanionInjectorDeps = {
    getSelectorState: () => ref.state,
    setSelectorState: (next) => { ref.state = next; },
    markLastLine: (id) => { ref.lastLine = id; },
  };
  return { deps, ref };
}

function runningCompanion(opts: { say?: (m: string, o?: unknown) => unknown } = {}): CompanionMock {
  return {
    isRunning: () => true,
    getNpcId: () => 'NPC_Ember',
    say: opts.say ?? vi.fn(() => Promise.resolve()),
  };
}

beforeEach(() => {
  _resetForTests();
  mockRefs.providers = [];
  mockRefs.modal = null;
  mockRefs.bubbles = null;
  mockRefs.companion = null;
  mockRefs.settings = {
    enabled: true,
    companionInject: true,
    lines: { restock: true, weather: true, gardenValue: true, pity: true, abilityProc: true, inventoryFull: true },
  };
  mockRefs.sub = null;
  vi.useFakeTimers();
});

afterEach(() => {
  _resetForTests();
  vi.useRealTimers();
});

describe('companionInjector', () => {
  it('no-ops when Companion.isRunning() !== true', async () => {
    const say = vi.fn();
    mockRefs.companion = { ...runningCompanion({ say }), isRunning: () => false };
    mockRefs.providers = [makeProvider('weather')];
    const { deps } = makeDeps();
    startCompanionInjector(deps);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(say).not.toHaveBeenCalled();
    expect(getCompanionInjectorDiagnostics().lastSkipReason).toBe('not-running');
  });

  it('no-ops when settings.companionInject is false', async () => {
    const say = vi.fn();
    mockRefs.settings.companionInject = false;
    mockRefs.companion = runningCompanion({ say });
    mockRefs.providers = [makeProvider('weather')];
    const { deps } = makeDeps();
    startCompanionInjector(deps);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(say).not.toHaveBeenCalled();
  });

  it('no-ops when settings.enabled is false (master toggle wins)', async () => {
    const say = vi.fn();
    mockRefs.settings.enabled = false;
    mockRefs.companion = runningCompanion({ say });
    mockRefs.providers = [makeProvider('weather')];
    const { deps } = makeDeps();
    startCompanionInjector(deps);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(say).not.toHaveBeenCalled();
  });

  it('resets the debounce when a bubble subscription fires', async () => {
    const say = vi.fn(() => Promise.resolve());
    mockRefs.companion = runningCompanion({ say });
    mockRefs.providers = [makeProvider('weather')];
    const { deps } = makeDeps();
    startCompanionInjector(deps);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(say).not.toHaveBeenCalled();
    mockRefs.sub!();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(say).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(say).toHaveBeenCalledTimes(1);
  });

  it('injects a line on silence expiry', async () => {
    const say = vi.fn(() => Promise.resolve());
    mockRefs.companion = runningCompanion({ say });
    mockRefs.providers = [makeProvider('weather', { line: { message: 'weather line' } })];
    const { deps, ref } = makeDeps();
    startCompanionInjector(deps);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(say).toHaveBeenCalledTimes(1);
    expect(say).toHaveBeenCalledWith('weather line', {});
    expect(getCompanionInjectorDiagnostics().injectCount).toBe(1);
    expect(ref.lastLine).toBe('weather');
  });

  it('falls back to the next ranked line when the first renders nothing', async () => {
    const say = vi.fn(() => Promise.resolve());
    mockRefs.companion = runningCompanion({ say });
    mockRefs.providers = [
      { ...makeProvider('weather'), line: () => null },
      makeProvider('pity', { line: { message: 'pity line' } }),
    ];
    const { deps, ref } = makeDeps();
    startCompanionInjector(deps);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(say).toHaveBeenCalledWith('pity line', {});
    expect(ref.lastLine).toBe('pity');
    expect(ref.state.lastServedAt.pity).toBeDefined();
    expect(ref.state.lastServedAt.weather).toBeUndefined();
  });

  it('shares selector cool-down with the Talk path (LRU rotation)', async () => {
    const say = vi.fn(() => Promise.resolve());
    mockRefs.companion = runningCompanion({ say });
    mockRefs.providers = [
      makeProvider('weather'),
      makeProvider('pity'),
    ];
    const { deps, ref } = makeDeps();
    startCompanionInjector(deps);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(say).toHaveBeenCalledTimes(1);
    const nextPick = realSelectLine({
      speaker: { npcId: 'NPC_Reina', role: 'native', locationKey: 'weatherStation', voice: 'station' },
      companionActive: false,
      candidates: [
        { id: 'weather', themes: ['weatherStation'], companionOnly: false, relevance: 0.9 },
        { id: 'pity', themes: ['weatherStation'], companionOnly: false, relevance: 0.9 },
      ],
      enabled: new Set<LineId>(['weather', 'pity']),
      state: { ...ref.state, talks: { ...ref.state.talks, NPC_Reina: 1 } },
      nowMs: Date.now() + 60_000,
    });
    expect(nextPick.lineId).toBe('pity');
  });

  it('skips when a modal is open', async () => {
    const say = vi.fn(() => Promise.resolve());
    mockRefs.modal = 'shopModal';
    mockRefs.companion = runningCompanion({ say });
    mockRefs.providers = [makeProvider('weather')];
    const { deps } = makeDeps();
    startCompanionInjector(deps);
    await vi.advanceTimersByTimeAsync(45_000);
    expect(say).not.toHaveBeenCalled();
    expect(getCompanionInjectorDiagnostics().lastSkipReason).toBe('modal-open');
  });

  it('skips when the Companion bubble is fresh (<10s)', async () => {
    const say = vi.fn(() => Promise.resolve());
    mockRefs.companion = runningCompanion({ say });
    mockRefs.providers = [makeProvider('weather')];
    const { deps } = makeDeps();
    startCompanionInjector(deps);
    await vi.advanceTimersByTimeAsync(40_000);
    mockRefs.bubbles = {
      NPC_Ember: { seq: 0, playerId: 'NPC_Ember', message: 'aries', timestamp: Date.now(), ariesAuthored: true },
    };
    await vi.advanceTimersByTimeAsync(5_000);
    expect(say).not.toHaveBeenCalled();
    expect(getCompanionInjectorDiagnostics().lastSkipReason).toBe('aries-recent');
  });

  it('defers the next inject to a full debounce after an Aries bubble with no subscription wake', async () => {
    const say = vi.fn(() => Promise.resolve());
    mockRefs.companion = runningCompanion({ say });
    mockRefs.providers = [makeProvider('weather')];
    const { deps } = makeDeps();
    startCompanionInjector(deps);
    await vi.advanceTimersByTimeAsync(30_000);
    mockRefs.bubbles = {
      NPC_Ember: { seq: 0, playerId: 'NPC_Ember', message: 'proposal', timestamp: Date.now(), ariesAuthored: true },
    };
    await vi.advanceTimersByTimeAsync(44_000);
    expect(say).not.toHaveBeenCalled();
    expect(getCompanionInjectorDiagnostics().lastSkipReason).toBe('aries-recent');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(say).toHaveBeenCalledTimes(1);
  });

  it('survives say() throwing', async () => {
    const say = vi.fn(() => Promise.reject(new Error('boom')));
    mockRefs.companion = runningCompanion({ say });
    mockRefs.providers = [makeProvider('weather')];
    const { deps } = makeDeps();
    startCompanionInjector(deps);
    await vi.advanceTimersByTimeAsync(45_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(say).toHaveBeenCalledTimes(1);
    expect(getCompanionInjectorDiagnostics().lastSkipReason).toBe('say-threw');
    expect(getCompanionInjectorDiagnostics().injectCount).toBe(0);
  });
});
