import { beforeEach, describe, expect, it } from 'vitest';
import type { CaptureJob, CaptureSource } from './capture';
import { installPhoto, type PhotoDeps, type PhotoGame, type PhotoSession, type PhotoView, type StripActions } from './mode';

const blob = new Blob(['png'], { type: 'image/png' });

// The game's flag (cine) and the cutscene HUD hide (cut): the read is null while a cutscene hides the HUD (live 1448).
function fakeGame() {
  const g = {
    cine: false, cut: false, toggles: 0, railOk: true, readFollows: true,
    subs: new Set<() => void>(),
    fire() { for (const cb of [...g.subs]) cb(); },
    api: null as unknown as PhotoGame,
  };
  g.api = {
    cinematic: () => (g.cut ? null : g.cine),
    onCinematic: (cb) => { g.subs.add(cb); return () => { g.subs.delete(cb); }; },
    toggleCinematic: () => {
      if (!g.railOk) return false;
      g.toggles++;
      if (g.readFollows) { g.cine = !g.cine; g.fire(); }
      return true;
    },
    source: {} as CaptureSource,
  };
  return g;
}

function fakeDeps(game: ReturnType<typeof fakeGame>) {
  const r = {
    missing: null as string[] | null,
    unavailable: [] as string[][],
    blocked: [] as string[],
    uiHidden: false,
    strips: [] as Array<{ views: PhotoView[]; destroyed: boolean; actions: StripActions }>,
    jobs: [] as Array<{ cancelled: boolean; resolve(b: Blob | null): void }>,
    saved: 0, copyOk: true, copies: 0, downloads: true,
    previews: [] as Array<{ open: boolean }>,
    stripThrows: false,
  };
  const deps: PhotoDeps = {
    game: () => r.missing ?? game.api,
    capture: (): CaptureJob => {
      let resolve: (b: Blob | null) => void = () => {};
      const result = new Promise<Blob | null>((res) => { resolve = res; });
      const j = { cancelled: false, resolve: (b: Blob | null) => { resolve(b); } };
      r.jobs.push(j);
      return { result, cancel: () => { j.cancelled = true; resolve(null); } };
    },
    strip: (actions) => {
      if (r.stripThrows) throw new Error('dom');
      const s = { views: [] as PhotoView[], destroyed: false, actions };
      r.strips.push(s);
      return { update: (v) => { s.views.push({ ...v }); }, destroy: () => { s.destroyed = true; } };
    },
    pageUiHidden: (h) => { r.uiHidden = h; },
    output: {
      save: () => { r.saved++; },
      copy: async () => { r.copies++; return r.copyOk; },
      downloads: () => r.downloads,
      preview: (_b, onClose) => {
        const p = { open: true };
        r.previews.push(p);
        return () => { if (!p.open) return; p.open = false; onClose(); };
      },
    },
    unavailable: (m) => { r.unavailable.push([...m]); },
    blocked: (op) => { r.blocked.push(op); },
  };
  return { r, deps };
}

let game: ReturnType<typeof fakeGame>;
let r: ReturnType<typeof fakeDeps>['r'];
let photo: PhotoSession;
const lastView = (): PhotoView | undefined => r.strips.at(-1)?.views.at(-1);
const settle = async (): Promise<void> => { for (let i = 0; i < 4; i++) await Promise.resolve(); };

function expectRestored(cinematicWas: boolean): void {
  expect(photo.active()).toBe(false);
  expect(game.cine).toBe(cinematicWas);
  expect(r.uiHidden).toBe(false);
  expect(r.strips.every((s) => s.destroyed)).toBe(true);
  expect(game.subs.size).toBe(0);
  expect(r.previews.every((p) => !p.open)).toBe(true);
}

beforeEach(() => {
  game = fakeGame();
  const f = fakeDeps(game);
  r = f.r;
  photo = installPhoto(f.deps);
});

describe('photo mode: enter and every way out', () => {
  it('enter turns Cinematic Mode on, hides QPM UI and shows the strip with no shot', () => {
    expect(photo.enter()).toBe(true);
    expect(game.cine).toBe(true);
    expect(game.toggles).toBe(1);
    expect(r.uiHidden).toBe(true);
    expect(lastView()).toEqual({ status: 'none', shot: null });
    expect(photo.enter()).toBe(false);
  });

  const paths: Array<[string, () => void]> = [
    ['P', () => { photo.toggle(); }],
    ['Esc', () => { expect(photo.escape()).toBe(true); }],
    ['G (exit before flying home)', () => { photo.exit(); }],
    ['a forced exit or stopSpectator (uninstall)', () => { photo.uninstall(); }],
  ];
  for (const [name, leave] of paths) {
    it(`${name} restores Cinematic Mode and QPM UI, with a shot taken and its preview open`, async () => {
      photo.enter();
      void photo.capture();
      r.jobs[0]?.resolve(blob);
      await settle();
      r.downloads = false;
      r.strips[0]?.actions.save();
      expect(r.previews[0]?.open).toBe(true);
      // Esc closes the preview first, then leaves.
      if (name === 'Esc') photo.escape();
      leave();
      expectRestored(false);
      // exit and uninstall are idempotent; P again would enter again.
      if (name !== 'Esc' && name !== 'P') leave();
      expectRestored(false);
    });
  }

  it('Cinematic Mode already on stays on after photo mode', () => {
    game.cine = true;
    photo.enter();
    expect(game.toggles).toBe(0);
    photo.exit();
    expectRestored(true);
  });

  it('a click on the game\'s own camera icon leaves photo mode without toggling again', () => {
    photo.enter();
    game.cine = false;
    game.fire();
    expectRestored(false);
    expect(game.toggles).toBe(1);
  });

  it('a cutscene hiding the HUD keeps photo mode; at the exit QPM turns off what it turned on', () => {
    photo.enter();
    game.cut = true;
    game.fire();
    expect(photo.active()).toBe(true);
    photo.exit();
    expect(game.toggles).toBe(2);
    game.cut = false;
    expectRestored(false);
  });

  it('entered during a cutscene that hides the HUD, nothing is toggled while it lasts', () => {
    game.cut = true;
    photo.enter();
    photo.exit();
    expect(game.toggles).toBe(0);
  });

  it('entered during a cutscene, photo mode turns Cinematic Mode on when the cutscene ends, and off at the exit', () => {
    game.cut = true;
    photo.enter();
    game.cut = false;
    game.fire();
    expect(photo.active()).toBe(true);
    expect(game).toMatchObject({ cine: true, toggles: 1 });
    photo.exit();
    expectRestored(false);
    expect(game.toggles).toBe(2);
  });

  it('a drifted read at that point leaves photo mode with the flag flipped back, without looping', () => {
    game.cut = true;
    photo.enter();
    game.cut = false;
    game.readFollows = false;
    game.fire();
    expect(photo.active()).toBe(false);
    expect(game.toggles).toBe(2);
    expect(r.unavailable).toEqual([['photo:cinematic-state']]);
  });

  it('missing handles refuse with the list; a toggle the read does not follow is undone and reported', () => {
    r.missing = ['photo:toasts'];
    expect(photo.enter()).toBe(false);
    expect(r.unavailable).toEqual([['photo:toasts']]);
    r.missing = null;
    game.railOk = false;
    expect(photo.enter()).toBe(false);
    expect(r.unavailable[1]).toEqual(['photo:toggle']);
    game.railOk = true;
    game.readFollows = false;
    expect(photo.enter()).toBe(false);
    expect(game.toggles).toBe(2);
    expect(r.unavailable[2]).toEqual(['photo:cinematic-state']);
    expect(r.uiHidden).toBe(false);
    expect(r.strips).toEqual([]);
  });

  it('a piece that throws while entering unwinds the toggle', () => {
    r.stripThrows = true;
    expect(photo.enter()).toBe(false);
    expect(game.cine).toBe(false);
    expect(r.unavailable).toEqual([['photo:strip']]);
    expect(r.uiHidden).toBe(false);
  });

  it('after uninstall nothing enters', () => {
    photo.uninstall();
    expect(photo.enter()).toBe(false);
    expect(game.toggles).toBe(0);
  });
});

describe('photo mode: capture, copy, save', () => {
  it('Capture shows capturing, then the shot; a failed capture says so', async () => {
    photo.enter();
    const p = photo.capture();
    expect(lastView()?.status).toBe('capturing');
    expect(photo.capture()).toBeNull();
    r.jobs[0]?.resolve(blob);
    await expect(p).resolves.toBe(blob);
    expect(lastView()).toEqual({ status: 'ready', shot: blob });
    void photo.capture();
    r.jobs[1]?.resolve(null);
    await settle();
    expect(lastView()).toMatchObject({ status: 'failed', shot: blob });
  });

  it('Copy and Save do nothing before a shot; then act on the last shot', async () => {
    photo.enter();
    const strip = r.strips[0]!;
    strip.actions.copy();
    strip.actions.save();
    expect(r.copies + r.saved).toBe(0);
    void photo.capture();
    r.jobs[0]?.resolve(blob);
    await settle();
    strip.actions.copy();
    await settle();
    expect(lastView()?.status).toBe('copied');
    strip.actions.save();
    expect(r.saved).toBe(1);
    expect(lastView()?.status).toBe('saved');
    expect(r.blocked).toEqual([]);
  });

  it('a refused copy on the web says use Save; with downloads blocked too it opens the preview (QPM-SPEC-005)', async () => {
    photo.enter();
    void photo.capture();
    r.jobs[0]?.resolve(blob);
    await settle();
    r.copyOk = false;
    r.strips[0]?.actions.copy();
    await settle();
    expect(lastView()?.status).toBe('copyBlocked');
    expect(r.previews).toEqual([]);
    r.downloads = false;
    r.strips[0]?.actions.copy();
    await settle();
    expect(r.previews).toEqual([{ open: true }]);
    r.strips[0]?.actions.save();
    expect(r.saved).toBe(0);
    expect(r.previews.map((p) => p.open)).toEqual([false, true]);
    expect(r.blocked).toEqual(['copy', 'copy', 'save']);
  });

  it('Esc closes the preview before it leaves photo mode', async () => {
    photo.enter();
    void photo.capture();
    r.jobs[0]?.resolve(blob);
    await settle();
    r.downloads = false;
    r.strips[0]?.actions.save();
    expect(photo.escape()).toBe(true);
    expect(photo.active()).toBe(true);
    expect(r.previews[0]?.open).toBe(false);
    expect(photo.escape()).toBe(true);
    expect(photo.escape()).toBe(false);
    expectRestored(false);
  });

  it('a new capture closes the preview of the old shot', async () => {
    photo.enter();
    void photo.capture();
    r.jobs[0]?.resolve(blob);
    await settle();
    r.downloads = false;
    r.strips[0]?.actions.save();
    expect(r.previews[0]?.open).toBe(true);
    void photo.capture();
    expect(r.previews[0]?.open).toBe(false);
  });

  it('a capture still running at the exit is cancelled and its result ignored', async () => {
    photo.enter();
    void photo.capture();
    photo.exit();
    r.jobs[0]?.resolve(blob);
    await settle();
    expect(r.jobs[0]?.cancelled).toBe(true);
    expect(lastView()?.status).toBe('capturing');
  });

  it('Enter/Space belong to photo mode only while it is on; a held key captures once', () => {
    expect(photo.captureKey(false)).toBe(false);
    photo.enter();
    expect(photo.captureKey(false)).toBe(true);
    expect(photo.captureKey(true)).toBe(true);
    expect(r.jobs).toHaveLength(1);
  });

  it('each photo mode starts with no shot', async () => {
    photo.enter();
    void photo.capture();
    r.jobs[0]?.resolve(blob);
    await settle();
    photo.exit();
    photo.enter();
    expect(lastView()).toEqual({ status: 'none', shot: null });
  });

  it('the strip Exit leaves photo mode', () => {
    photo.enter();
    r.strips[0]?.actions.exit();
    expectRestored(false);
  });
});
