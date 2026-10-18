import { describe, expect, it, vi } from 'vitest';

vi.mock('../../diagnostics/featureDiagnostics', () => ({ createFeatureDiagnostics: () => ({}) }));

import { formatSpectatorLine, type SpectatorStatus } from './diagnostics';

const status = (o: Partial<SpectatorStatus> = {}): SpectatorStatus => ({
  enabled: true, active: false, mode: 'free', view: '2d', seat: 'seated', paused: null, director: false, waypoints: 0,
  fails: 0, frameMs: null, unavailable: [], ...o,
});

describe('formatSpectatorLine', () => {
  it('is null while the feature is disabled', () => {
    expect(formatSpectatorLine(status({ enabled: false }))).toBeNull();
  });

  it('reads off with the seat and failure count while enabled and not spectating', () => {
    expect(formatSpectatorLine(status())).toBe('Spectator: off seat=seated fails=0');
    expect(formatSpectatorLine(status({ seat: null, fails: 2 }))).toBe('Spectator: off seat=? fails=2');
  });

  it('names what the startup check found missing, within 120 characters', () => {
    expect(formatSpectatorLine(status({ unavailable: ['keyboardCaptureOwners', 'ticker'] })))
      .toBe('Spectator: off seat=seated fails=0 unavail=keyboardCaptureOwners,ticker');
    const long = formatSpectatorLine(status({ unavailable: Array.from({ length: 20 }, (_, i) => `handle${i}`) }))!;
    expect(long.length).toBeLessThanOrEqual(120);
    expect(long.endsWith('…')).toBe(true);
  });

  it('renders the S §11.4 on line', () => {
    const line = formatSpectatorLine(status({ active: true, mode: 'follow', director: true, waypoints: 4, frameMs: 0.123 }));
    expect(line).toBe('Spectator: on mode=follow view=2d seat=seated director=1 wp=4 fails=0 frame=0.12ms');
    expect(formatSpectatorLine(status({ active: true, paused: 'tram' }))).toBe('Spectator: on mode=free view=2d seat=seated director=0 wp=0 paused=tram fails=0');
  });
});
