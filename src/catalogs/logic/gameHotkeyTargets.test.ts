import { describe, expect, it } from 'vitest';
import { BAG_ATOM_MARKER, BAG_ATOM_TARGET, functionBody, parseBagExports, parseHotkeyCallees, resolveHotkeyTargets } from './gameHotkeyTargets';

// Excerpts of beta pr-4669-gke-2911 (2026-11-18); import/export lists trimmed to the relevant names.
const TABLE = 'DB=new Map([[`Space`,()=>Uu()],[`Shift+Space`,()=>bc(`Shift+Space`)],[`Escape`,()=>NB()],[`e`,()=>dn()],[`t`,()=>jB()],[`Shift+1`,()=>void Qb(`seedShop`)],[`1`,()=>PB(0)]]),OB=class{};';
const HOTKEY_CHUNK = 'import{Tn as Tn,Un as dn,hr as hr}from"./sessionNoticeLifecycle-Ca2LdKZY.js";'
  + 'function jB(){TB(Tn)===`petTeams`?hr(null):TB(yr)!==null&&TB(Xr)&&zt(()=>hr(`petTeams`))}'
  + 'function NB(){rr.handleEscape()||(TB(ir.activeAtom)===null?hr(null):ir.close())}' + TABLE;
const BAG_CHUNK = 'var W=globalThis.jotaiAtomCache.get(`client/src/games/Quinoa/atoms/modalAtom.ts/inventoryModalIsActiveAtom`,b(!1));W.debugLabel=`inventoryModalIsActiveAtom`;'
  + 'function El(){V(Qt)||(Cl(),H(W,!0))}function Dl(){return V(W)&&V(U)===null}var Ol=()=>{Dl()?H(W,!1):V(An)&&El()},kl=1;'
  + 'function Zz(){return 1}export{El as kn,Ol as Un,Zz as Zq};';
const BAG_FILE = 'https://magicgarden.gg/version/x/assets/sessionNoticeLifecycle-Ca2LdKZY.js';

describe('functionBody', () => {
  it('reads function declarations and arrow assignments, not member writes', () => {
    expect(functionBody(BAG_CHUNK, 'El')).toBe('{V(Qt)||(Cl(),H(W,!0))}');
    expect(functionBody(BAG_CHUNK, 'Ol')).toBe('{Dl()?H(W,!1):V(An)&&El()}');
    expect(functionBody('a.Ol=()=>{x()};', 'Ol')).toBeNull();
    expect(functionBody(BAG_CHUNK, 'Nope')).toBeNull();
  });
});

describe('parseHotkeyCallees (INP-1.6b)', () => {
  const callees = parseHotkeyCallees(HOTKEY_CHUNK);

  it('same-chunk function: literals in its body are its targets', () => {
    expect(callees?.local).toContainEqual({ combo: 't', targets: ['petTeams'] });
  });

  it('imported function: chunk file and export name', () => {
    expect(callees?.imported).toContainEqual({ combo: 'e', file: 'sessionNoticeLifecycle-Ca2LdKZY.js', name: 'Un' });
  });

  it('entries that pass a value, and bodies with no target, are left out', () => {
    const combos = [...(callees?.local ?? []), ...(callees?.imported ?? [])].map(e => e.combo);
    expect(combos).not.toContain('shift+1');
    expect(combos).not.toContain('1');
    expect(combos).not.toContain('escape');
  });

  it('no table → null', () => {
    expect(parseHotkeyCallees('function jB(){}')).toBeNull();
  });
});

describe('parseBagExports', () => {
  it('lists the exports whose function names the bag atom', () => {
    expect(BAG_ATOM_MARKER.test(BAG_CHUNK)).toBe(true);
    const exports = parseBagExports(BAG_CHUNK);
    expect(exports?.get('Un')).toEqual([BAG_ATOM_TARGET]);
    expect(exports?.has('kn')).toBe(true);
    expect(exports?.has('Zq')).toBe(false);
  });

  it('no bag atom, or no export using it → null', () => {
    expect(parseBagExports('function El(){}export{El as kn};')).toBeNull();
    expect(parseBagExports('var W=1;W.debugLabel=`inventoryModalIsActiveAtom`;function Zz(){}export{Zz as Zq};')).toBeNull();
  });
});

describe('resolveHotkeyTargets', () => {
  const callees = parseHotkeyCallees(HOTKEY_CHUNK)!;
  const exports = parseBagExports(BAG_CHUNK)!;

  it('E → the bag through the import, T → petTeams', () => {
    const map = resolveHotkeyTargets(callees, { file: BAG_FILE, exports });
    expect(map.get(BAG_ATOM_TARGET)).toEqual(['e']);
    expect(map.get('petTeams')).toEqual(['t']);
    expect(map.has('seedShop')).toBe(false);
  });

  it('bag chunk unread or a different file → only same-chunk targets', () => {
    expect(resolveHotkeyTargets(callees, null).has(BAG_ATOM_TARGET)).toBe(false);
    expect(resolveHotkeyTargets(callees, { file: 'other-X.js', exports }).has(BAG_ATOM_TARGET)).toBe(false);
  });
});
