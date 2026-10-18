import { InstallStack } from '../../../utils/installStack';
import type { CaptureJob, CaptureSource } from './capture';

export type PhotoStatus = 'none' | 'capturing' | 'ready' | 'copied' | 'saved' | 'failed' | 'copyBlocked';
export interface PhotoView { status: PhotoStatus; shot: Blob | null }

export interface StripActions { capture(): void; copy(): void; save(): void; exit(): void }
export interface PhotoStrip { update(v: Readonly<PhotoView>): void; destroy(): void }

export interface PhotoGame {
  /** null while a cutscene hides the HUD: Cinematic Mode can't be told apart then (live 1448). */
  cinematic(): boolean | null;
  onCinematic(cb: () => void): () => void;
  /** The game's own toggle (its sound and toast); false when the rail is gone. */
  toggleCinematic(): boolean;
  source: CaptureSource;
}

export interface PhotoDeps {
  /** The game handles, or what is missing. */
  game(): PhotoGame | readonly string[];
  capture(src: CaptureSource): CaptureJob;
  strip(actions: StripActions): PhotoStrip;
  pageUiHidden(hidden: boolean): void;
  output: {
    save(blob: Blob): void;
    copy(blob: Blob): Promise<boolean>;
    downloads(): boolean;
    preview(blob: Blob, onClose: () => void): () => void;
  };
  /** QPM-SPEC-001 with what is missing. */
  unavailable(missing: readonly string[]): void;
  /** QPM-SPEC-005. */
  blocked(op: 'copy' | 'save'): void;
}

export interface PhotoSession {
  active(): boolean;
  /** P and the bar's Photo button. */
  toggle(): void;
  enter(): boolean;
  /** Idempotent; G calls it before flying home. */
  exit(): void;
  /** Esc: the preview first, then photo mode; false when neither is open. */
  escape(): boolean;
  /** Enter or Space: true while photo mode owns the key. A held key captures once. */
  captureKey(repeat: boolean): boolean;
  /** null when photo mode is off or a capture is running. */
  capture(): Promise<Blob | null> | null;
  uninstall(): void;
}

class MissingError extends Error {}

const isMissing = (g: PhotoGame | readonly string[]): g is readonly string[] => Array.isArray(g);

/** Photo mode for one spectating session (S §9, PS3). Enter installs each piece with its undo; every way out unwinds
 * them: QPM turns Cinematic Mode off only if it turned it on and the game doesn't already read off. */
export function installPhoto(deps: PhotoDeps): PhotoSession {
  let installed = true;
  let on: { tx: InstallStack; game: PhotoGame; strip: PhotoStrip } | null = null;
  let view: PhotoView = { status: 'none', shot: null };
  let job: CaptureJob | null = null;
  let closePreview: (() => void) | null = null;
  // mine: QPM turned Cinematic Mode on. wasOn: it read on since photo mode began (a cutscene hiding the HUD reads null).
  let mine = false;
  let wasOn = false;
  let turning = false;

  const set = (p: Partial<PhotoView>): void => {
    view = { ...view, ...p };
    on?.strip.update(view);
  };

  const openPreview = (shot: Blob): void => {
    closePreview?.();
    closePreview = deps.output.preview(shot, () => { closePreview = null; });
  };

  const turnOn = (g: PhotoGame): void => {
    turning = true;
    try {
      if (!g.toggleCinematic()) throw new MissingError('photo:toggle');
      if (g.cinematic() !== true) {
        // The read no longer follows the flag: flip it back rather than leave the game in a state QPM can't see.
        g.toggleCinematic();
        throw new MissingError('photo:cinematic-state');
      }
      mine = true;
      wasOn = true;
    } finally { turning = false; }
  };

  // The game's own icon stays clickable in Cinematic Mode: on → off while photo mode is on is the player leaving, and
  // photo mode follows. Off after a cutscene that hid the HUD at entry means Cinematic Mode was never on: turn it on now.
  const onCinematic = (): void => {
    const s = on;
    const c = s?.game.cinematic() ?? null;
    if (!s || turning || c === null) return;
    if (c) { wasOn = true; return; }
    if (wasOn) { api.exit(); return; }
    try { turnOn(s.game); } catch (e) {
      api.exit();
      deps.unavailable([e instanceof MissingError ? e.message : 'photo:cinematic']);
    }
  };

  const api: PhotoSession = {
    active: () => on !== null,
    toggle() { if (on) api.exit(); else api.enter(); },
    enter() {
      if (!installed || on) return false;
      const g = deps.game();
      if (isMissing(g)) { deps.unavailable(g); return false; }
      const tx = new InstallStack();
      try {
        tx.add('cinematic', () => {
          mine = false;
          const c = g.cinematic();
          wasOn = c === true;
          if (c === false) turnOn(g);
        }, () => {
          if (mine && g.cinematic() !== false) g.toggleCinematic();
          mine = false;
        });
        view = { status: 'none', shot: null };
        const strip = tx.add('strip', () => deps.strip(actions), (s) => { s.destroy(); });
        tx.add('page-ui', () => { deps.pageUiHidden(true); }, () => { deps.pageUiHidden(false); });
        on = { tx, game: g, strip };
        tx.add('watch', () => g.onCinematic(onCinematic), (off) => { off(); });
        strip.update(view);
      } catch (e) {
        on = null;
        tx.unwind();
        deps.unavailable([e instanceof MissingError ? e.message : `photo:${tx.step}`]);
        return false;
      }
      return true;
    },
    exit() {
      const s = on;
      if (!s) return;
      on = null;
      job?.cancel();
      job = null;
      closePreview?.();
      s.tx.unwind();
      view = { status: 'none', shot: null };
    },
    escape() {
      if (closePreview) { closePreview(); return true; }
      if (!on) return false;
      api.exit();
      return true;
    },
    captureKey(repeat) {
      if (!on) return false;
      if (!repeat) void api.capture();
      return true;
    },
    capture() {
      if (!on || job) return null;
      closePreview?.();
      const j = deps.capture(on.game.source);
      job = j;
      set({ status: 'capturing' });
      return j.result.then((b) => {
        if (job !== j) return b;
        job = null;
        set(b ? { status: 'ready', shot: b } : { status: 'failed' });
        return b;
      });
    },
    uninstall() {
      api.exit();
      installed = false;
    },
  };

  const actions: StripActions = {
    capture: () => { void api.capture(); },
    copy() {
      const shot = view.shot;
      if (!on || !shot || job) return;
      void deps.output.copy(shot).then((ok) => {
        if (!on || view.shot !== shot) return;
        if (ok) { set({ status: 'copied' }); return; }
        deps.blocked('copy');
        if (deps.output.downloads()) set({ status: 'copyBlocked' });
        else openPreview(shot);
      });
    },
    save() {
      const shot = view.shot;
      if (!on || !shot || job) return;
      if (!deps.output.downloads()) { deps.blocked('save'); openPreview(shot); return; }
      deps.output.save(shot);
      set({ status: 'saved' });
    },
    exit: () => { api.exit(); },
  };

  return api;
}
