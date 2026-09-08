import { describe, expect, it } from 'vitest';
import { DEFAULT_COPY_OPTIONS, groupErrors, MAX_TOTAL_CHARS, renderReport } from './copyRender';
import type { ReportInput } from './copyRender';
import type { ErrorBufferEntry, ErrorCodeDefinition } from './types';

const T0 = Date.UTC(2026, 8, 7, 8, 0, 0);
const MIN = 60_000;

const FEATURE_004: ErrorCodeDefinition = {
  code: 'QPM-FEATURE-004',
  subsystem: 'feature',
  category: 'feature',
  severity: 'warn',
  title: 'Feature helper failed',
  description: 'A migrated feature\'s runtime helper threw without crashing the feature — '.repeat(5),
};

const WS_008: ErrorCodeDefinition = {
  code: 'QPM-WS-008',
  subsystem: 'websocket',
  category: 'core',
  severity: 'warn',
  title: 'Foreign send wrapper',
  description: 'Could not wrap the room connection send functions; QPM falls back to legacy flat sends.',
};

const CODES: Record<string, ErrorCodeDefinition> = { [FEATURE_004.code]: FEATURE_004, [WS_008.code]: WS_008 };

function entry(partial: Partial<ErrorBufferEntry> & { code: ErrorBufferEntry['code']; at: number }): ErrorBufferEntry {
  const { at, ...rest } = partial;
  const def = CODES[partial.code];
  return {
    subsystem: 'x',
    severity: 'warn',
    message: def?.description ?? 'custom message',
    count: 1,
    firstSeen: at,
    lastSeen: at,
    ...rest,
    code: partial.code,
  };
}

function input(overrides: Partial<ReportInput> = {}): ReportInput {
  return {
    now: T0 + 30 * MIN,
    qpmVersion: '3.3.42',
    gameVersion: '1099',
    browser: 'Chrome 152',
    os: 'Windows 11',
    environmentLine: 'Env: Tampermonkey 5.3  web  up 30m',
    modsLine: null,
    flagsLine: null,
    perfLine: null,
    subsystems: [],
    aggregate: 'ok',
    gameStateProblemLines: [],
    errors: [],
    sessionStartedAt: T0,
    lookupCode: (code) => CODES[code],
    ...overrides,
  };
}

describe('renderReport header', () => {
  it('prints env, mods and flags lines only when present and enabled', () => {
    const withAll = renderReport(input({ modsLine: 'Mods: AriesMod 2.4', flagsLine: 'Flags: envelope=off' }));
    expect(withAll).toContain('QPM 3.3.42  Game 1099  Chrome 152  Win 11');
    expect(withAll).toContain('\nEnv: Tampermonkey 5.3  web  up 30m\nMods: AriesMod 2.4\nFlags: envelope=off\nOverall: ok');

    const none = renderReport(input());
    expect(none).not.toContain('Mods:');
    expect(none).not.toContain('Flags:');

    const optedOut = renderReport(
      input({ modsLine: 'Mods: AriesMod', flagsLine: 'Flags: dev=on' }),
      { ...DEFAULT_COPY_OPTIONS, environment: false, otherMods: false, flags: false },
    );
    expect(optedOut).not.toContain('Env:');
    expect(optedOut).not.toContain('Mods:');
    expect(optedOut).not.toContain('Flags:');
  });

  it('prints the perf line when present and opts.perf is on; omits it when off', () => {
    const perfLine = 'Perf: longtasks 0/15s (max 0ms)  anchor.tick p95 0.9ms  anchor walk 24/38 nodes';
    const on = renderReport(input({ perfLine }));
    expect(on).toContain(perfLine);

    const off = renderReport(input({ perfLine }), { ...DEFAULT_COPY_OPTIONS, perf: false });
    expect(off).not.toContain('Perf:');

    const absent = renderReport(input({ perfLine: null }));
    expect(absent).not.toContain('Perf:');
  });
});

describe('renderReport errors', () => {
  it('uses the code title instead of the paragraph description', () => {
    const out = renderReport(input({ errors: [entry({ code: 'QPM-FEATURE-004', at: T0 + MIN, context: { feature: 'gardenBridge' } })] }));
    expect(out).toContain('QPM-FEATURE-004  Feature helper failed {"feature":"gardenBridge"}');
    expect(out).not.toContain('runtime helper threw');
  });

  it('keeps custom messages that are not the description, capped', () => {
    const long = 'x'.repeat(200);
    const out = renderReport(input({ errors: [entry({ code: 'QPM-WS-008', at: T0 + MIN, message: long })] }));
    expect(out).toContain('QPM-WS-008  ' + 'x'.repeat(87) + '…');
  });

  it('tags entries recorded by a different QPM version', () => {
    const errors = [
      entry({ code: 'QPM-WS-008', at: T0 + MIN, qpmVersion: '3.3.39' }),
      entry({ code: 'QPM-FEATURE-004', at: T0 + 2 * MIN, qpmVersion: '3.3.42' }),
    ];
    const out = renderReport(input({ errors }));
    expect(out).toContain('QPM-WS-008@3.3.39  ');
    expect(out).toContain('QPM-FEATURE-004  ');
    expect(out).not.toContain('QPM-FEATURE-004@');
  });

  it('collapses alternating code+context storms into one line per pattern', () => {
    const a = { phase: 'layering', foreignTry: true };
    const b = { phase: 'layering', foreignTry: false };
    const errors = [
      entry({ code: 'QPM-WS-008', at: T0 + 1 * MIN, context: a, count: 38 }),
      entry({ code: 'QPM-WS-008', at: T0 + 2 * MIN, context: b, count: 2 }),
      entry({ code: 'QPM-WS-008', at: T0 + 3 * MIN, context: a, count: 160 }),
      entry({ code: 'QPM-WS-008', at: T0 + 4 * MIN, context: b, count: 2 }),
      entry({ code: 'QPM-WS-008', at: T0 + 5 * MIN, context: a, count: 125 }),
    ];
    const groups = groupErrors(errors);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.total).toBe(323);
    expect(groups[0]?.entries).toBe(3);
    expect(groups[1]?.total).toBe(4);

    const out = renderReport(input({ errors }));
    expect(out).toContain('== Errors (2 patterns from 5 entries) ==');
    expect(out).toContain('×323 since 09-07 08:01:00');
    expect(out).toContain('×4 since 09-07 08:02:00');
    expect(out.split('QPM-WS-008').length - 1).toBe(2);
  });

  it('ignores volatile counters like seq when grouping', () => {
    const errors = [
      entry({ code: 'QPM-WS-008', at: T0 + 1 * MIN, context: { type: 'PurchaseShopItem', code: 'rejected', seq: 118 } }),
      entry({ code: 'QPM-WS-008', at: T0 + 1 * MIN, context: { type: 'PurchaseShopItem', code: 'rejected', seq: 119 } }),
      entry({ code: 'QPM-WS-008', at: T0 + 2 * MIN, context: { type: 'PutItemInStorage', code: 'rejected', seq: 120 } }),
    ];
    const groups = groupErrors(errors);
    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.total === 2)?.latest.context).toEqual({ type: 'PurchaseShopItem', code: 'rejected', seq: 119 });
  });

  it('places a session divider between live errors and pre-reload residue', () => {
    const errors = [
      entry({ code: 'QPM-WS-008', at: T0 - 60 * MIN }),
      entry({ code: 'QPM-FEATURE-004', at: T0 + 5 * MIN }),
    ];
    const out = renderReport(input({ errors }));
    const lines = out.split('\n');
    const live = lines.findIndex((l) => l.includes('QPM-FEATURE-004'));
    const divider = lines.findIndex((l) => l.startsWith('--- session start 09-07 08:00:00 ---'));
    const stale = lines.findIndex((l) => l.includes('QPM-WS-008'));
    expect(live).toBeGreaterThan(-1);
    expect(divider).toBeGreaterThan(live);
    expect(stale).toBeGreaterThan(divider);
  });

  it('says so when every error predates this session', () => {
    const out = renderReport(input({ errors: [entry({ code: 'QPM-WS-008', at: T0 - 60 * MIN })] }));
    expect(out).toContain('--- session start 09-07 08:00:00 (no errors this session) ---');
  });

  it('omits the divider when everything is from this session', () => {
    const out = renderReport(input({ errors: [entry({ code: 'QPM-WS-008', at: T0 + MIN })] }));
    expect(out).not.toContain('--- session start');
  });

  it('stays within the Discord budget and counts dropped patterns', () => {
    const errors: ErrorBufferEntry[] = [];
    for (let i = 0; i < 80; i++) {
      errors.push(entry({ code: 'QPM-FEATURE-004', at: T0 + i * MIN, context: { feature: `f${i}`, what: 'anchor:resolve' } }));
    }
    const out = renderReport(input({ errors }));
    expect(out.length).toBeLessThanOrEqual(MAX_TOTAL_CHARS + 8);
    expect(out).toMatch(/== Errors \(\d+ patterns from last 50 of 80 entries\) ==/);
    expect(out).toMatch(/… \d+ more truncated/);
  });
});
