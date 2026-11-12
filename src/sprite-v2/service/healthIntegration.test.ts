// tri-2026-10-31-011: the SPRITE-001 row lost the PIXI probe text because the
// logger's bus fan-out overwrote the detailed message with the code title.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../core/notifications', () => ({ notify: () => {} }));
vi.mock('../diagnostics', () => ({ spriteLog: () => {} }));

import { healthBus } from '../../diagnostics/healthBus';
import {
  reportPetRiveDiscovery,
  reportSpriteV2InitFailed,
  startSpriteV2Diagnostics,
  stopSpriteV2Diagnostics,
} from './healthIntegration';

beforeEach(() => {
  stopSpriteV2Diagnostics();
  healthBus.teardown();
});

describe('reportSpriteV2InitFailed', () => {
  it('keeps the init error detail on the spriteV2 bus row', () => {
    startSpriteV2Diagnostics();
    reportSpriteV2InitFailed(new Error('PIXI app timeout (hook=undefined engine=0)'));

    const row = healthBus.read('spriteV2');
    expect(row?.status).toBe('failed');
    expect(row?.message).toContain('PIXI app timeout');
  });

  it('keeps the detail when a late retry fails with the same error', () => {
    startSpriteV2Diagnostics();
    reportSpriteV2InitFailed(new Error('PIXI app timeout (hook=undefined engine=0)'));
    reportSpriteV2InitFailed(new Error('PIXI app timeout (hook=undefined engine=0)'));

    expect(healthBus.read('spriteV2')?.message).toContain('PIXI app timeout');
  });
});

describe('reportPetRiveDiscovery', () => {
  it('degrades the spriteV2 row with a petRive metric when nothing was discovered', () => {
    startSpriteV2Diagnostics();
    reportPetRiveDiscovery(0);

    const row = healthBus.read('spriteV2');
    expect(row?.status).toBe('degraded');
    expect(row?.message).toContain('Pet Rive');
    expect(row?.metrics?.['petRive']).toBe('0/0');
  });

  it('publishes nothing for a positive count', () => {
    startSpriteV2Diagnostics();
    const before = healthBus.read('spriteV2');
    reportPetRiveDiscovery(32);
    const after = healthBus.read('spriteV2');
    expect(after?.status).toBe(before?.status);
    expect(after?.message).toBe(before?.message);
  });
});
