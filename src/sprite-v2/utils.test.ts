import { describe, expect, it } from 'vitest';
import { getCtors, hasOwnTextureAccessor, resolveBaseSpriteCtor } from './utils';

class FakeRect { x = 0; y = 0; width = 1; height = 1; }
class FakeTexture { frame = new FakeRect(); }
class FakeContainer { children: unknown[] = []; }
class FakeSprite extends FakeContainer {
  private _tex: unknown;
  constructor(tex: unknown = null) { super(); this._tex = tex; }
  get texture(): unknown { return this._tex; }
  set texture(v: unknown) { this._tex = v; }
}
// Mirrors the game's Rive sprite: destructures its second argument in the ctor.
class FakeRiveSprite extends FakeSprite {
  constructor(_res: unknown, opts: { riveFileSrc: string }) {
    const { riveFileSrc } = opts;
    super(new FakeTexture());
    void riveFileSrc;
  }
}

describe('resolveBaseSpriteCtor', () => {
  it('walks a game subclass up to the class that owns the texture accessor', () => {
    expect(resolveBaseSpriteCtor(FakeRiveSprite)).toBe(FakeSprite);
  });
  it('returns the class itself when it already owns texture', () => {
    expect(resolveBaseSpriteCtor(FakeSprite)).toBe(FakeSprite);
  });
  it('returns the input unchanged when no class in the chain owns texture', () => {
    expect(resolveBaseSpriteCtor(FakeContainer)).toBe(FakeContainer);
    expect(resolveBaseSpriteCtor(null)).toBeNull();
  });
  it('hasOwnTextureAccessor distinguishes the two', () => {
    expect(hasOwnTextureAccessor(FakeSprite)).toBe(true);
    expect(hasOwnTextureAccessor(FakeRiveSprite)).toBe(false);
  });
});

describe('getCtors', () => {
  it('yields a Sprite that accepts a bare texture even when the stage leads with a Rive subclass', () => {
    const stage = new FakeContainer();
    stage.children = [new FakeRiveSprite(null, { riveFileSrc: 'weather.riv' })];
    const ctors = getCtors({ stage }, null);
    expect(ctors.Sprite).toBe(FakeSprite);
    expect(() => new (ctors.Sprite as new (t: unknown) => unknown)(new FakeTexture())).not.toThrow();
    expect(ctors.Container).toBe(FakeContainer);
    expect(ctors.Texture).toBe(FakeTexture);
    expect(ctors.Rectangle).toBe(FakeRect);
  });
});
