import { describe, expect, it } from 'vitest';
import { findDefinition, findExportLocal, findImport, parseListBody, parsePushRulesChunk } from './pushRulesParsing';
import { INVENTORY, RULES, SUBSCRIBE, TOOLS } from './__fixtures__/pushRules';

describe('parsePushRulesChunk (ALR-8.2a)', () => {
  it('reads the live 2082 rules chunk', () => {
    const raw = parsePushRulesChunk(RULES);
    expect(raw?.toolList).toEqual({ literals: ['ChilledPotion', 'FrozenPotion', 'ReplenishPotion', 'XPPotion'], spreads: ['at'] });
    expect(raw?.silentShops).toEqual([{ ref: 've', member: 'Spooky' }]);
    expect(raw?.listTopics).toEqual([{ subject: 'QuinoaWeatherActive', ref: 'ge' }, { subject: 'QuinoaDayNightPhase', ref: 'vt' }]);
    const bySubject = Object.fromEntries((raw?.shopTopics ?? []).map((t) => [t.subject, t]));
    expect(Object.keys(bySubject)).toEqual(['QuinoaSeedInStock', 'QuinoaEggInStock', 'QuinoaToolInStock', 'QuinoaDecorInStock']);
    expect(bySubject.QuinoaSeedInStock).toMatchObject({ itemType: 'Seed', usesToolList: false, usesSilentShops: true, excludeRef: null, unknownGate: false });
    expect(bySubject.QuinoaToolInStock).toMatchObject({ itemType: 'Tool', usesToolList: true, usesSilentShops: true, excludeRef: null, unknownGate: false });
    expect(bySubject.QuinoaDecorInStock).toMatchObject({ itemType: 'Decor', usesToolList: false, usesSilentShops: true, excludeRef: 'nt', unknownGate: false });
  });

  it('a gate on another set is unknown, not ignored', () => {
    const text = RULES.replace('l(w,e)&&pt.has(e)&&', 'l(w,e)&&zz.has(e)&&');
    const tool = parsePushRulesChunk(text)?.shopTopics.find((t) => t.subject === 'QuinoaToolInStock');
    expect(tool).toMatchObject({ usesToolList: false, unknownGate: true });
  });

  it('a literal silent shop and several silent shops parse', () => {
    const text = RULES.replace('e!==ve.Spooky', 'e!==`spooky`&&e!==ve.Night');
    expect(parsePushRulesChunk(text)?.silentShops).toEqual(['spooky', { ref: 've', member: 'Night' }]);
  });

  it('missing tool rule or no shop subjects → null', () => {
    expect(parsePushRulesChunk(RULES.replace('pt=new Set(ft)', 'pt=new Map(ft)'))).toBeNull();
    expect(parsePushRulesChunk(RULES.split('var P=')[0] ?? '')).toBeNull();
    expect(parsePushRulesChunk('var a=1;')).toBeNull();
  });
});

describe('definitions and bindings (ALR-8.2a)', () => {
  it('lists, enum IIFEs and fn(ref) calls', () => {
    expect(findDefinition(INVENTORY, 'at')).toEqual({ kind: 'list', list: { literals: ['RainWardShard', 'SnowWardShard', 'ThunderWardShard', 'HungerShard', 'XPShard', 'StrengthShard'], spreads: [] } });
    expect(findDefinition(TOOLS, 'Ke')).toMatchObject({ kind: 'list' });
    expect(findDefinition(SUBSCRIBE, 'Qe')).toMatchObject({ kind: 'enum', members: { Spooky: 'spooky', Seed: 'seed' } });
    expect(findDefinition(SUBSCRIBE, 'Se')).toEqual({ kind: 'call', inner: 'M' });
    expect(findDefinition(RULES, 'vt')).toEqual({ kind: 'call', inner: 'F' });
    expect(findDefinition(RULES, 'F')).toEqual({ kind: 'list', list: { literals: ['sunset', 'midnight', 'sunrise'], spreads: [] } });
  });

  it('a non-matching shape and a missing name → null', () => {
    expect(findDefinition(INVENTORY, 'nt')).toBeNull();
    expect(findDefinition(INVENTORY, 'nope')).toBeNull();
    expect(findDefinition(INVENTORY, 'a.b')).toBeNull();
  });

  it('imports and exports follow the alias', () => {
    expect(findImport(RULES, 'at')).toEqual({ exported: 'Xr', from: './inventoryAtoms-k-dI6XBq.js' });
    expect(findImport(RULES, 'nt')).toEqual({ exported: 'o', from: './tools-QPJJ44nY.js' });
    expect(findImport(RULES, 'pt')).toBeNull();
    expect(findExportLocal(SUBSCRIBE, 'sr')).toBe('Qe');
    expect(findExportLocal(INVENTORY, 'Xr')).toBe('at');
    expect(findExportLocal(INVENTORY, 'zz')).toBeNull();
  });

  it('list bodies reject anything but literals and spreads', () => {
    expect(parseListBody('`a`,...b')).toEqual({ literals: ['a'], spreads: ['b'] });
    expect(parseListBody('`a`,b')).toBeNull();
    expect(parseListBody('')).toBeNull();
  });
});
