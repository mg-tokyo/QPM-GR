import { describe, expect, it } from 'vitest';
import { initialSelectorState, markServed, selectLine, type Candidate } from './selector';
import type { LineId, Speaker } from './types';

const reina: Speaker = { npcId: 'NPC_Reina', role: 'native', locationKey: 'weatherStation', voice: 'station' };
const comp: Speaker = { npcId: 'NPC_Wade', role: 'companion', locationKey: null, voice: 'neutral' };
const all = new Set<LineId>(['restock', 'weather', 'gardenValue', 'pity', 'abilityProc', 'inventoryFull']);
const c = (id: LineId, relevance: number, themes: string[] = [], companionOnly = false): Candidate => ({ id, themes, companionOnly, relevance });
const talkedOnce = (npcId: string, at = 0) => ({ ...initialSelectorState(), talks: { [npcId]: 1 }, lastTalkAt: { [npcId]: at } });

describe('selectLine', () => {
  it('never overrides the first Talk of the session', () => {
    const r = selectLine({ speaker: reina, companionActive: false, candidates: [c('weather', 1, ['weatherStation'])], enabled: all, state: initialSelectorState(), nowMs: 1000 });
    expect(r.lineId).toBeNull();
    expect(r.state.talks.NPC_Reina).toBe(1);
  });
  it('prefers the themed line over a more urgent unthemed one', () => {
    const r = selectLine({ speaker: reina, companionActive: false, candidates: [c('restock', 0.9), c('weather', 0.6, ['weatherStation'])], enabled: all, state: talkedOnce('NPC_Reina', -60000), nowMs: 1000 });
    expect(r.lineId).toBe('weather');
  });
  it('requires the relevance floor unless asking again', () => {
    const cand = [c('restock', 0.2)];
    expect(selectLine({ speaker: reina, companionActive: false, candidates: cand, enabled: all, state: talkedOnce('NPC_Reina', -60000), nowMs: 1000 }).lineId).toBeNull();
    expect(selectLine({ speaker: reina, companionActive: false, candidates: cand, enabled: all, state: talkedOnce('NPC_Reina', 0), nowMs: 5000 }).lineId).toBe('restock');
  });
  it('keeps an unthemed NPC native on a normal Talk and opens the pool on a quick re-Talk', () => {
    const crumb: Speaker = { npcId: 'NPC_Crumbworth', role: 'native', locationKey: null, voice: 'neutral' };
    const cand = [c('gardenValue', 0.6, ['preservationStation']), c('abilityProc', 0.6)];
    expect(selectLine({ speaker: crumb, companionActive: false, candidates: cand, enabled: all, state: talkedOnce('NPC_Crumbworth', -60000), nowMs: 1000 }).lineId).toBeNull();
    expect(selectLine({ speaker: crumb, companionActive: false, candidates: cand, enabled: all, state: talkedOnce('NPC_Crumbworth', 0), nowMs: 5000 }).lineId).not.toBeNull();
  });
  it('serves only the themed line on a normal Talk even when it was served most recently', () => {
    const state = markServed(talkedOnce('NPC_Reina', -60000), 'weather', 500);
    const r = selectLine({ speaker: reina, companionActive: false, candidates: [c('gardenValue', 0.6, ['preservationStation']), c('weather', 0.6, ['weatherStation'])], enabled: all, state, nowMs: 1000 });
    expect(r.lineId).toBe('weather');
  });
  it('restricts native NPCs to themed lines while the companion is active', () => {
    const r = selectLine({ speaker: reina, companionActive: true, candidates: [c('restock', 0.9)], enabled: all, state: talkedOnce('NPC_Reina', -60000), nowMs: 1000 });
    expect(r.lineId).toBeNull();
  });
  it('offers companion-only lines to the companion alone', () => {
    const cand = [c('inventoryFull', 0.9, [], true)];
    expect(selectLine({ speaker: comp, companionActive: true, candidates: cand, enabled: all, state: talkedOnce('NPC_Wade', -60000), nowMs: 1000 }).lineId).toBe('inventoryFull');
    expect(selectLine({ speaker: reina, companionActive: false, candidates: cand, enabled: all, state: talkedOnce('NPC_Reina', -60000), nowMs: 1000 }).lineId).toBeNull();
  });
  it('skips disabled lines', () => {
    const r = selectLine({ speaker: comp, companionActive: true, candidates: [c('restock', 0.9), c('pity', 0.6)], enabled: new Set<LineId>(['pity']), state: talkedOnce('NPC_Wade', -60000), nowMs: 1000 });
    expect(r.lineId).toBe('pity');
  });
  it('cycles least-recently-served lines first', () => {
    const seeded = markServed(talkedOnce('NPC_Wade', -60000), 'restock', 500);
    const r1 = selectLine({ speaker: comp, companionActive: true, candidates: [c('restock', 0.9), c('pity', 0.6)], enabled: all, state: seeded, nowMs: 1000 });
    expect(r1.lineId).toBe('pity');
    const after = markServed(r1.state, 'pity', 1000);
    const r2 = selectLine({ speaker: comp, companionActive: true, candidates: [c('restock', 0.9), c('pity', 0.6)], enabled: all, state: after, nowMs: 1500 });
    expect(r2.lineId).toBe('restock');
  });
  it('ranks the whole pool so a caller can fall back past a line that renders nothing', () => {
    const seeded = markServed(talkedOnce('NPC_Wade', -60000), 'restock', 500);
    const r = selectLine({ speaker: comp, companionActive: true, candidates: [c('restock', 0.9), c('pity', 0.6), c('weather', 0.8)], enabled: all, state: seeded, nowMs: 1000 });
    expect(r.ranked).toEqual(['weather', 'pity', 'restock']);
    expect(r.lineId).toBe('weather');
  });
  it('does not mutate the input state', () => {
    const state = talkedOnce('NPC_Reina', 0);
    selectLine({ speaker: reina, companionActive: false, candidates: [], enabled: all, state, nowMs: 1000 });
    expect(state.talks.NPC_Reina).toBe(1);
  });
});
