import { describe, it, expect, vi } from 'vitest';

const fakeWindow = vi.hoisted((): Record<string, unknown> => ({
  fetch: async () => new Response(new Uint8Array([1, 2, 3, 4])),
}));
vi.mock('../core/pageContext', () => ({ pageWindow: fakeWindow }));
vi.mock('./helpers', () => ({ riveLog: () => {} }));
vi.mock('./fileOverrides', () => ({ getFileOverride: () => null }));

import { initRivFetchInterceptor, listSeenRivUrls, onRivUrlSeen } from './fetchInterceptor';

describe('onRivUrlSeen', () => {
  it('notifies once per distinct .riv URL after the bytes are recorded', async () => {
    const stop = initRivFetchInterceptor();
    const seen: string[] = [];
    const off = onRivUrlSeen((url) => seen.push(url));
    const f = fakeWindow['fetch'] as typeof fetch;

    await f('https://game.test/runtime-assets/Turtle.abc.riv');
    await f('https://game.test/runtime-assets/Turtle.abc.riv');
    await f('https://game.test/version/1/assets/ui.json');
    await new Promise((r) => setTimeout(r, 0));

    expect(seen).toEqual(['https://game.test/runtime-assets/Turtle.abc.riv']);
    expect(listSeenRivUrls()).toContain('https://game.test/runtime-assets/Turtle.abc.riv');

    off();
    await f('https://game.test/runtime-assets/Bee.def.riv');
    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toHaveLength(1);
    stop();
  });
});
