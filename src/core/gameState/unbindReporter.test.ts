import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createUnbindReporter } from './unbindReporter';

const SEAT_KEYS = ['petSlotInfos', 'riddenPetId', 'myData', 'myGarden', 'magicDustBalance', 'hutchPets'];

function setup(opts: { seat: boolean; spectating?: boolean }) {
  const state = { seat: opts.seat, spectating: opts.spectating ?? false };
  const warn = vi.fn();
  const reporter = createUnbindReporter({
    hasSeat: () => state.seat,
    isSpectating: () => state.spectating,
    warn,
    graceMs: 10_000,
    now: () => Date.now(),
  });
  return { state, warn, reporter };
}

describe('unbindReporter', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('warns immediately when a key unbinds while the player is seated', () => {
    const { warn, reporter } = setup({ seat: true });
    reporter.onUnbind('weather', 'stateTree:/child/data/weather');
    expect(warn).toHaveBeenCalledWith({ key: 'weather', from: 'stateTree:/child/data/weather' });
  });

  it('stays silent when the seat returns within the grace window (rejoin Welcome burst)', () => {
    const { state, warn, reporter } = setup({ seat: false });
    for (const k of SEAT_KEYS) reporter.onUnbind(k, `stateTree:/child/data/userSlots/{myIdx}/${k}`);
    expect(reporter.held()).toHaveLength(SEAT_KEYS.length);
    vi.advanceTimersByTime(250);
    state.seat = true;
    for (const k of SEAT_KEYS) reporter.onBound(k);
    vi.advanceTimersByTime(20_000);
    expect(warn).not.toHaveBeenCalled();
    expect(reporter.held()).toHaveLength(0);
  });

  it('reports keys still unbound after the grace window', () => {
    const { state, warn, reporter } = setup({ seat: false });
    reporter.onUnbind('myData', 'stateTree:/child/data/userSlots/{myIdx}/data');
    reporter.onUnbind('myGarden', 'stateTree:/child/data/userSlots/{myIdx}/data/garden');
    vi.advanceTimersByTime(250);
    state.seat = true;
    reporter.onBound('myData');
    vi.advanceTimersByTime(10_000);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({ key: 'myGarden', from: 'stateTree:/child/data/userSlots/{myIdx}/data/garden', seatlessMs: 10_000 });
  });

  it('does not report seat loss that ends in spectating', () => {
    const { state, warn, reporter } = setup({ seat: false });
    reporter.onUnbind('myData', 'stateTree:/child/data/userSlots/{myIdx}/data');
    state.spectating = true;
    vi.advanceTimersByTime(10_000);
    expect(warn).not.toHaveBeenCalled();
    expect(reporter.held()).toHaveLength(0);
  });

  it('dispose drops held keys and the pending timer', () => {
    const { warn, reporter } = setup({ seat: false });
    reporter.onUnbind('myData', 'stateTree:/child/data/userSlots/{myIdx}/data');
    reporter.dispose();
    vi.advanceTimersByTime(10_000);
    expect(warn).not.toHaveBeenCalled();
  });
});
