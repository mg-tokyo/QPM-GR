// Game 1973 split pets.riv into one .riv per species (manifest bundle `pets`,
// alias `rive/pets/<Species>.riv`); the pre-1973 shape was a single `rive/pets`.
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../rive-engine/fetchInterceptor', () => ({ listSeenRivUrls: () => [] }));
vi.mock('../manifest', () => ({
  getAssetManifest: async () => ({ bundles: [] }),
  getBlob: async () => new Blob(),
  joinPath: (base: string, path: string) => base.replace(/\/?$/, '/') + String(path || '').replace(/^\//, ''),
}));
vi.mock('../detector', () => ({ buildAssetsBaseUrl: () => 'https://game.test/version/1973/assets/' }));
vi.mock('../diagnostics', () => ({ spriteLog: () => {} }));

import { collectPetRiveSources, collectSeenSplitSources, speciesForSeenUrl } from './bundleLoader';

const BASE = 'https://game.test/version/1973/assets/';
const ORIGIN = 'https://game.test';

const splitManifest = {
  bundles: [
    {
      name: 'pets',
      assets: [
        { alias: ['rive/pets/Turtle.riv', 'rive/pets/Turtle'], src: [{ src: '/runtime-assets/Turtle.abc123.riv', progressSize: 1 }] },
        { alias: ['rive/pets/RedFox.riv', 'rive/pets/RedFox'], src: [{ src: '/runtime-assets/RedFox.def456.riv', progressSize: 1 }] },
      ],
    },
    {
      name: 'avatar.riv',
      assets: [{ alias: ['rive/avatar.riv'], src: [{ src: '/runtime-assets/avatar.0a0a.riv', progressSize: 1 }] }],
    },
  ],
};

const singleManifest = {
  bundles: [
    { assets: [{ alias: ['rive/pets'], src: ['rive/pets.9f9f.riv'] }] },
  ],
};

describe('collectPetRiveSources', () => {
  it('maps the 1973 split shape to species → absolute URL', () => {
    const out = collectPetRiveSources(splitManifest, BASE, ORIGIN);
    expect(out.kind).toBe('split');
    if (out.kind !== 'split') return;
    expect(out.bySpecies.get('Turtle')).toBe('https://game.test/runtime-assets/Turtle.abc123.riv');
    expect(out.bySpecies.get('RedFox')).toBe('https://game.test/runtime-assets/RedFox.def456.riv');
    expect(out.bySpecies.size).toBe(2);
    expect(out.otherRivNames.has('avatar')).toBe(true);
  });

  it('maps the old single-file shape to one base-relative URL', () => {
    const out = collectPetRiveSources(singleManifest, BASE, ORIGIN);
    expect(out).toEqual({ kind: 'single', url: 'https://game.test/version/1973/assets/rive/pets.9f9f.riv' });
  });

  it('prefers split when both shapes are present', () => {
    const both = { bundles: [...splitManifest.bundles, ...singleManifest.bundles] };
    const out = collectPetRiveSources(both, BASE, ORIGIN);
    expect(out.kind).toBe('split');
  });

  it('returns none when neither shape is present', () => {
    const out = collectPetRiveSources({ bundles: [{ assets: [{ alias: ['sprite/ui/Coin'], src: ['ui.json'] }] }] }, BASE, ORIGIN);
    expect(out.kind).toBe('none');
  });
});

describe('collectSeenSplitSources', () => {
  it('maps seen /runtime-assets/<Species>.<hash>.riv URLs to species and skips non-pet .riv bundles', () => {
    const seen = [
      'https://game.test/runtime-assets/Turtle.abc123.riv',
      'https://game.test/runtime-assets/avatar.0a0a.riv',
      'https://game.test/version/1973/assets/rive/currency.1b1b.riv',
    ];
    const out = collectSeenSplitSources(seen, new Set(['avatar', 'currency']));
    expect(Array.from(out.keys())).toEqual(['Turtle']);
    expect(out.get('Turtle')).toBe('https://game.test/runtime-assets/Turtle.abc123.riv');
  });
});

describe('speciesForSeenUrl', () => {
  it('maps a fetched per-species URL back to its species, ignoring other .riv files', () => {
    const sources = collectPetRiveSources(splitManifest, BASE, ORIGIN);
    expect(speciesForSeenUrl(sources, 'https://game.test/runtime-assets/Turtle.abc123.riv')).toBe('Turtle');
    expect(speciesForSeenUrl(sources, '/runtime-assets/RedFox.def456.riv')).toBe('RedFox');
    expect(speciesForSeenUrl(sources, 'https://game.test/runtime-assets/avatar.0a0a.riv')).toBeNull();
    expect(speciesForSeenUrl({ kind: 'none' }, 'https://game.test/runtime-assets/Turtle.abc123.riv')).toBeNull();
  });
});
