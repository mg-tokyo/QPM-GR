import { describe, expect, it } from 'vitest';
import { gameKeyToCombo, isGameKeyCombo, parseGameHotkeys, parseMovementKeys } from './gameHotkeysParsing';

// Exact excerpts of beta pr-4669-gke-2911 `installPlayerSystems-CWjoH9In.js` (2026-11-17).
const HOTKEYS = 'ar)}var{get:TB,set:EB}=C(),DB=new Map([[`Space`,()=>Uu()],[`Shift+Space`,()=>bc(`Shift+Space`)],[`Alt+Space`,()=>bc(`Alt+Space`)],[`Escape`,()=>NB()],[`/`,()=>MB()],[`e`,()=>dn()],[`x`,()=>IF(-1)],[`c`,()=>IF(1)],[`t`,()=>jB()],[`q`,()=>kx(`keyboard`)],[`r`,()=>iL()],[`Shift+r`,()=>aL()],[`f`,()=>oL()],[`=`,()=>vn(1)],[`-`,()=>vn(-1)],[`Shift+1`,()=>void Qb(`seedShop`)],[`Shift+2`,()=>void Qb(`myGarden`)],[`Shift+3`,()=>void Qb(`sellCropsShop`)],[`1`,()=>PB(0)],[`2`,()=>PB(1)],[`3`,()=>PB(2)],[`4`,()=>PB(3)],[`5`,()=>PB(4)],[`6`,()=>PB(5)],[`7`,()=>PB(6)],[`8`,()=>PB(7)],[`9`,()=>PB(8)]]),OB=class{name=`hotkey`;isKeyPressed=!1;';
const MOVEMENT = 'let t=JM.exec(e.code)?.[1];return t?t.toLowerCase():null}var QM=new Map([[`KeyW`,`up`],[`KeyA`,`left`],[`KeyS`,`down`],[`KeyD`,`right`],[`ArrowUp`,`up`],[`ArrowLeft`,`left`],[`ArrowDown`,`down`],[`ArrowRight`,`right`]]),$M=new Set([`ArrowUp`,`ArrowDown`,`ArrowLeft`,`ArrowRight`]);';
// The other Shift+Space use in the same build (`seededShuffle-*.js`) must not count as the table.
const DECOY = '3).map((e,n)=>n===0?`Space`:Gu.has(e)||t?`Alt+Space`:(t=!0,`Shift+Space`))}';

const SPEC_F7 = ['space', 'shift+space', 'alt+space', 'escape', '/', 'e', 'x', 'c', 't', 'q', 'r', 'shift+r', 'f', '=', '-', 'shift+1', 'shift+2', 'shift+3', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

describe('parseGameHotkeys (INP-1.3)', () => {
  it('reads the beta table as QPM combos', () => {
    expect(parseGameHotkeys(HOTKEYS)?.sort()).toEqual([...SPEC_F7].sort());
  });

  it('accepts double quotes', () => {
    const quoted = HOTKEYS.replace(/`/g, '"');
    expect(parseGameHotkeys(quoted)?.length).toBe(27);
  });

  it('no table, a decoy, or a table without Escape → null', () => {
    expect(parseGameHotkeys('var a=1;')).toBeNull();
    expect(parseGameHotkeys(DECOY)).toBeNull();
    expect(parseGameHotkeys('new Map([[`Shift+Space`,()=>a()],[`e`,()=>b()]])')).toBeNull();
  });

  it('an unclosed Map → null', () => {
    expect(parseGameHotkeys('new Map([[`Shift+Space`,()=>a()],[`Escape`,()=>b()]')).toBeNull();
  });
});

describe('parseMovementKeys (INP-1.3)', () => {
  it('reads WASD and the arrows', () => {
    expect(parseMovementKeys(MOVEMENT)?.sort()).toEqual(['a', 'arrowdown', 'arrowleft', 'arrowright', 'arrowup', 'd', 's', 'w']);
  });

  it('missing direction or no table → null', () => {
    expect(parseMovementKeys('new Map([[`KeyW`,`up`],[`KeyA`,`left`],[`KeyS`,`down`]])')).toBeNull();
    expect(parseMovementKeys(HOTKEYS)).toBeNull();
  });
});

describe('gameKeyToCombo', () => {
  it('maps names and modifier order', () => {
    expect(gameKeyToCombo('Shift+r')).toBe('shift+r');
    expect(gameKeyToCombo('Escape')).toBe('escape');
    expect(gameKeyToCombo('Shift+Alt+Space')).toBe('alt+shift+space');
    expect(gameKeyToCombo('Meta+k')).toBe('ctrl+k');
    expect(gameKeyToCombo('Hyper+k')).toBeNull();
  });
});

describe('isGameKeyCombo', () => {
  const keys = {
    hotkeys: new Set(parseGameHotkeys(HOTKEYS) ?? []),
    movement: new Set(parseMovementKeys(MOVEMENT) ?? []),
  };

  it('exact table entries', () => {
    for (const combo of ['r', 'shift+r', 'escape', 'space', 'shift+1', '/', '9', 'alt+space']) {
      expect(isGameKeyCombo(keys, combo)).toBe(true);
    }
  });

  it('Shift on a letter folds to the letter; on other keys it is exact', () => {
    expect(isGameKeyCombo(keys, 'shift+e')).toBe(true);
    expect(isGameKeyCombo(keys, 'shift+g')).toBe(false);
    expect(isGameKeyCombo(keys, 'shift+4')).toBe(false);
    expect(isGameKeyCombo(keys, 'shift+=')).toBe(false);
  });

  it('movement keys with or without Shift', () => {
    expect(isGameKeyCombo(keys, 'w')).toBe(true);
    expect(isGameKeyCombo(keys, 'shift+arrowup')).toBe(true);
  });

  it('Ctrl never, Alt only Alt+Space (Shift ignored under Alt)', () => {
    expect(isGameKeyCombo(keys, 'ctrl+e')).toBe(false);
    expect(isGameKeyCombo(keys, 'ctrl+space')).toBe(false);
    expect(isGameKeyCombo(keys, 'alt+e')).toBe(false);
    expect(isGameKeyCombo(keys, 'alt+w')).toBe(false);
    expect(isGameKeyCombo(keys, 'alt+shift+space')).toBe(true);
  });

  it('free keys', () => {
    for (const combo of ['g', 'k', '0', 'enter', 'f1', 'alt+q']) {
      expect(isGameKeyCombo(keys, combo)).toBe(false);
    }
  });
});
