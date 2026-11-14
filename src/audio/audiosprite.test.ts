// Game 2036 manifest shape (manifest.bc7.json): the sfx mp3 is origin-rooted under /runtime-assets,
// the atlas JSON is relative to the version's assets base.
import { describe, it, expect } from 'vitest';
import { audiospriteUrlsFromManifest } from './audiosprite';

const BASE = 'https://game.test/version/2036/assets/';
const ORIGIN = 'https://game.test';

const manifest2036 = {
  bundles: [
    {
      name: 'audio',
      assets: [
        { alias: ['audio/music/Thunderstorm.wav', 'audio/music/Thunderstorm'], src: [{ src: '/runtime-assets/Thunderstorm.cbf35ee7a5ec28bccc6c.mp3' }] },
        { alias: ['audio/sfx/sfx'], src: [{ src: '/runtime-assets/sfx.fdc2d19124b87b787296.mp3' }] },
        { alias: ['audio/sfx/sfx-atlas'], src: [{ src: 'audio/sfx/sfx.json' }] },
      ],
    },
  ],
};

describe('audiospriteUrlsFromManifest', () => {
  it('resolves the sfx mp3 and atlas from the manifest aliases', () => {
    expect(audiospriteUrlsFromManifest(manifest2036, BASE, ORIGIN)).toEqual({
      mp3: 'https://game.test/runtime-assets/sfx.fdc2d19124b87b787296.mp3',
      json: 'https://game.test/version/2036/assets/audio/sfx/sfx.json',
    });
  });

  it('returns null when either alias is missing', () => {
    const noAtlas = { bundles: [{ assets: manifest2036.bundles[0]!.assets.slice(0, 2) }] };
    expect(audiospriteUrlsFromManifest(noAtlas, BASE, ORIGIN)).toBeNull();
    expect(audiospriteUrlsFromManifest({ bundles: [] }, BASE, ORIGIN)).toBeNull();
  });
});
