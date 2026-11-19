import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OpenResult } from './session';

const toggleStorages = vi.fn<() => Promise<OpenResult | { ok: true; closed: true }>>();
const disposeStorages = vi.fn(() => Promise.resolve());
const resetStorageLayout = vi.fn(() => true);
const closeStorages = vi.fn(() => Promise.resolve(true));
let enabled = true;
const setMultiStorageEnabled = vi.fn((v: boolean) => { enabled = v; });
const showToast = vi.fn();

vi.mock('./session', () => ({ toggleStorages, disposeStorages, resetStorageLayout, closeStorages }));
vi.mock('./settings', () => ({ isMultiStorageEnabled: () => enabled, setMultiStorageEnabled }));
vi.mock('../../ui/components', () => ({ showToast }));
vi.mock('../../i18n', () => ({ t: (key: string) => key }));

const { resetLayoutFromKey, setStoragesEnabled, startMultiStorage, stopMultiStorage, toggleStoragesFromKey } = await import('./control');

const UNAVAILABLE: OpenResult = { ok: false, reason: 'unavailable', missing: ['draw'] };

describe('multi-storage key actions', () => {
  beforeEach(() => {
    stopMultiStorage();
    vi.clearAllMocks();
    enabled = true;
    toggleStorages.mockResolvedValue({ ok: true, storageIds: ['SeedSilo'] });
    startMultiStorage();
  });

  it('does nothing before start or after stop', async () => {
    stopMultiStorage();
    await toggleStoragesFromKey();
    resetLayoutFromKey();
    expect(toggleStorages).not.toHaveBeenCalled();
    expect(resetStorageLayout).not.toHaveBeenCalled();
  });

  it('does nothing while switched off', async () => {
    enabled = false;
    await toggleStoragesFromKey();
    resetLayoutFromKey();
    expect(toggleStorages).not.toHaveBeenCalled();
    expect(resetStorageLayout).not.toHaveBeenCalled();
  });

  it('start is idempotent and stop closes an open session', () => {
    startMultiStorage();
    stopMultiStorage();
    stopMultiStorage();
    expect(disposeStorages).toHaveBeenCalledTimes(1);
  });

  it('tells the user once when the game changed, again after a good open', async () => {
    toggleStorages.mockResolvedValue(UNAVAILABLE);
    await toggleStoragesFromKey();
    await toggleStoragesFromKey();
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('feature.multiStorage.unavailable', { variant: 'error' });

    toggleStorages.mockResolvedValueOnce({ ok: true, storageIds: ['SeedSilo'] });
    await toggleStoragesFromKey();
    await toggleStoragesFromKey();
    expect(showToast).toHaveBeenCalledTimes(2);
  });

  it('a failed open is told like a missing capability', async () => {
    toggleStorages.mockResolvedValue({ ok: false, reason: 'failed' });
    await toggleStoragesFromKey();
    expect(showToast).toHaveBeenCalledWith('feature.multiStorage.unavailable', { variant: 'error' });
  });

  it('says so every time no storage is owned', async () => {
    toggleStorages.mockResolvedValue({ ok: false, reason: 'no-storages' });
    await toggleStoragesFromKey();
    await toggleStoragesFromKey();
    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith('feature.multiStorage.noStorages');
  });

  it('stays quiet on close, busy and already open', async () => {
    toggleStorages.mockResolvedValueOnce({ ok: true, closed: true });
    toggleStorages.mockResolvedValueOnce({ ok: false, reason: 'busy' });
    toggleStorages.mockResolvedValueOnce({ ok: false, reason: 'open' });
    for (let i = 0; i < 3; i += 1) await toggleStoragesFromKey();
    expect(showToast).not.toHaveBeenCalled();
  });

  it('reset confirms with a toast', () => {
    resetLayoutFromKey();
    expect(resetStorageLayout).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith('feature.multiStorage.layoutReset', { variant: 'success' });
  });

  it('closes open panels when switched off from the card, and only then', () => {
    setStoragesEnabled(true);
    expect(closeStorages).not.toHaveBeenCalled();
    setStoragesEnabled(false);
    expect(setMultiStorageEnabled).toHaveBeenLastCalledWith(false);
    expect(closeStorages).toHaveBeenCalledTimes(1);
  });
});
