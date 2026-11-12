import { describe, it, expect, vi } from 'vitest';

const provided = vi.hoisted((): Array<{ rive: unknown; label: string }> => []);
vi.mock('./helpers', () => ({ riveLog: () => {} }));
vi.mock('./loadWrapper', () => ({ getWrappedRuntimeCount: () => 0 }));
vi.mock('./runtimeCapture', () => ({
  provideRuntimeFromCapture: (rive: unknown, label: string) => { provided.push({ rive, label }); },
}));

import { initCanvasRuntimeTrap, getTrapAssignmentCounts } from './canvasRuntimeTrap';

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('rive runtime traps', () => {
  it('captures the module object on its decodeImage assignment, ignores prototypes, and uninstalls', async () => {
    const stop = initCanvasRuntimeTrap();
    const decode = (): void => {};

    // Game 1995: an embind Factory.prototype gets decodeImage first; it has no load.
    class Factory {}
    (Factory.prototype as unknown as Record<string, unknown>).decodeImage = decode;

    // Then the glue assigns it on the emscripten Module object, which already has load.
    const moduleObj: Record<string, unknown> = { load: () => null };
    moduleObj.decodeImage = decode;
    await flush();

    expect(Object.prototype.hasOwnProperty.call(Factory.prototype, 'decodeImage')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(moduleObj, 'decodeImage')).toBe(true);
    expect(moduleObj.decodeImage).toBe(decode);
    expect(provided).toHaveLength(1);
    expect(provided[0]!.rive).toBe(moduleObj);
    expect(provided[0]!.label).toMatch(/^decode-trap-/);
    expect(getTrapAssignmentCounts().matched).toBe(1);

    stop();
    stop();
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'decodeImage')).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(Object.prototype, 'runtime')).toBeUndefined();
    const later: Record<string, unknown> = {};
    later.decodeImage = decode;
    expect(provided).toHaveLength(1);
  });

  it('still captures a rive-shaped value assigned to .runtime (older builds)', async () => {
    provided.length = 0;
    const stop = initCanvasRuntimeTrap();
    const runtime = { load: () => null, decodeImage: () => {} };
    const riveFile: Record<string, unknown> = {};
    riveFile.runtime = runtime;
    await flush();
    expect(riveFile.runtime).toBe(runtime);
    expect(provided.map((p) => p.rive)).toEqual([runtime]);
    stop();
  });
});
