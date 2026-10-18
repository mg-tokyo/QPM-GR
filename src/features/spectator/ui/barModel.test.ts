import { describe, expect, it } from 'vitest';

import { agoParts, barBottomPx, barVisible, chipState, humanizeAction, msUntilAgoChanges, switcherState } from './barModel';

const p = (id: string, online = true) => ({ id, name: id.toUpperCase(), seat: 2, online, colour: null, discordAvatarUrl: null, lastAction: null });

describe('chipState', () => {
  it('shows the mode and the view, or Paused while the game has the camera', () => {
    expect(chipState({ mode: 'free', view: '2d', paused: null })).toEqual({ kind: 'mode', mode: 'free', view: '2D' });
    expect(chipState({ mode: 'follow', view: '3d', paused: null })).toEqual({ kind: 'mode', mode: 'follow', view: '3D' });
    for (const r of ['cutscene', 'tram', 'foreign'] as const) {
      expect(chipState({ mode: 'follow', view: '2d', paused: r })).toEqual({ kind: 'paused' });
    }
  });

  it('a game window owning input is not a pause of the camera', () => {
    expect(chipState({ mode: 'free', view: '2d', paused: 'ui' })).toEqual({ kind: 'mode', mode: 'free', view: '2D' });
  });
});

describe('switcherState', () => {
  it('names the followed player, else asks for a pick, else says nobody is here', () => {
    expect(switcherState('b', [p('a'), p('b')])).toEqual({ kind: 'follow', player: p('b') });
    expect(switcherState(null, [p('a')])).toEqual({ kind: 'choose', canCycle: true });
    expect(switcherState(null, [])).toEqual({ kind: 'nobody' });
  });

  it('only online players can be cycled to; a target who left reads as a pick', () => {
    expect(switcherState(null, [p('a', false)])).toEqual({ kind: 'choose', canCycle: false });
    expect(switcherState('gone', [p('a')])).toEqual({ kind: 'choose', canCycle: true });
  });
});

describe('barVisible', () => {
  const s = { active: true, uiHidden: false, paused: null };
  it('shows while spectating unless H hid it or a game window owns input', () => {
    expect(barVisible(s)).toBe(true);
    expect(barVisible({ ...s, active: false })).toBe(false);
    expect(barVisible({ ...s, uiHidden: true })).toBe(false);
    expect(barVisible({ ...s, paused: 'ui' })).toBe(false);
    expect(barVisible({ ...s, paused: 'cutscene' })).toBe(true);
  });
});

describe('barBottomPx', () => {
  it('sits 8 px above the hotbar (live 1448: top 504 on a 632 px window)', () => {
    expect(barBottomPx(504, 632, 35)).toBe(136);
  });

  it('falls back when the hotbar is unreadable and always stays inside the window', () => {
    expect(barBottomPx(null, 632, 35)).toBe(128);
    expect(barBottomPx(20, 632, 35)).toBe(632 - 35 - 8);
    expect(barBottomPx(640, 632, 35)).toBe(8);
    expect(barBottomPx(Number.NaN, 632, 35)).toBe(128);
  });
});

describe('humanizeAction', () => {
  it('splits the game id into words, first letter capital', () => {
    expect(humanizeAction('teleport')).toBe('Teleport');
    expect(humanizeAction('plantSeed')).toBe('Plant seed');
    expect(humanizeAction('PurchaseDecor')).toBe('Purchase decor');
    expect(humanizeAction('harvest_crop')).toBe('Harvest crop');
    expect(humanizeAction('feedPetV2')).toBe('Feed pet v2');
    expect(humanizeAction('  ')).toBe('');
  });
});

describe('agoParts', () => {
  const now = 1_000_000_000;
  it('picks the largest whole unit, counted back from now', () => {
    expect(agoParts(now - 12_000, now)).toEqual({ value: -12, unit: 'second' });
    expect(agoParts(now - 59_999, now)).toEqual({ value: -59, unit: 'second' });
    expect(agoParts(now - 3 * 60_000 - 5_000, now)).toEqual({ value: -3, unit: 'minute' });
    expect(agoParts(now - 2 * 3_600_000, now)).toEqual({ value: -2, unit: 'hour' });
    expect(agoParts(now - 3 * 86_400_000, now)).toEqual({ value: -3, unit: 'day' });
  });

  it('a timestamp ahead of this clock (server skew) reads as now', () => {
    expect(agoParts(now + 5_000, now)).toEqual({ value: 0, unit: 'second' });
  });
});

describe('msUntilAgoChanges', () => {
  const now = 1_000_000_000;
  it('waits until the label agoParts gives would read differently', () => {
    expect(msUntilAgoChanges(now - 12_300, now)).toBe(700);
    expect(msUntilAgoChanges(now - 59_500, now)).toBe(500);
    expect(msUntilAgoChanges(now - 3 * 60_000 - 5_000, now)).toBe(55_000);
    expect(msUntilAgoChanges(now - 2 * 3_600_000, now)).toBe(3_600_000);
    expect(msUntilAgoChanges(now - 3 * 86_400_000 - 1, now)).toBe(86_399_999);
  });

  it('a timestamp ahead of this clock reads as now until it is a second old', () => {
    expect(msUntilAgoChanges(now + 5_000, now)).toBe(6_000);
  });
});
