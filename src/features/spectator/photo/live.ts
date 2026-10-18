import { readSync, subscribe } from '../../../core/gameState';
import { getPixiRefs } from '../../../core/pixiCapture';
import { getEngineSystem } from '../../../utils/quinoaEngine';
import { isRecord } from '../../../utils/typeGuards';
import type { SpecHandles } from '../handles';
import { mountPhotoStrip } from '../ui/photoStrip';
import { PHOTO_PAGE_CLASS } from '../ui/styles';
import { captureFrame, type AlphaNode } from './capture';
import type { PhotoDeps, PhotoGame } from './mode';
import { copyPhoto, downloadsAvailable, photoFileName, previewPhoto, savePhoto } from './output';

export interface LivePhotoOptions {
  /** The photo key as the player reads it, e.g. "P". */
  photoKey(): string;
  unavailable(missing: readonly string[]): void;
  blocked(op: 'copy' | 'save'): void;
}

const isAlphaNode = (n: unknown): n is AlphaNode => isRecord(n) && typeof n.alpha === 'number';

// Resolved from the engine running now on every use: an engine swap replaces the rail and the toasts system.
function railOf(): Record<string, unknown> | null {
  const rail = getEngineSystem(readSync('quinoaEngine'), 'rightSideRail');
  return isRecord(rail) && typeof rail.toggleCinematic === 'function' ? rail : null;
}

function cameraButtonOf(rail: Record<string, unknown> | null): AlphaNode | null {
  const button = rail?.cameraButton;
  const view: unknown = isRecord(button) ? button.viewContainer : null;
  return isAlphaNode(view) ? view : null;
}

// The game's toast layer (live 1448: getSystem('toasts').root, labelled Toasts under UI).
function toastsOf(): AlphaNode | null {
  const sys = getEngineSystem(readSync('quinoaEngine'), 'toasts');
  const root: unknown = isRecord(sys) ? sys.root : null;
  return isAlphaNode(root) ? root : null;
}

// Cinematic Mode's flag has no label: isChromeHidden = it || cutsceneChromeHidden (live 1448), so a cutscene hiding the
// HUD makes it unreadable.
function cinematic(): boolean | null {
  const hud = readSync('hudChromeHidden');
  const cut = readSync('cutsceneChromeHidden');
  if (typeof hud !== 'boolean' || typeof cut !== 'boolean' || cut) return null;
  return hud;
}

// Name tags need nothing: Cinematic Mode hides every one (AvatarView.draw shows a tag only while the HUD isn't hidden,
// live 1448), so the shot has none, as on screen.
function hiddenNodes(): AlphaNode[] {
  return [toastsOf(), cameraButtonOf(railOf())].filter((n): n is AlphaNode => n !== null);
}

/** Everything photo mode needs from the game, or what is missing (S §13: never half-working). */
function resolvePhotoGame(hs: SpecHandles): PhotoGame | string[] {
  const rail = railOf();
  const missing: string[] = [];
  if (!rail) missing.push('photo:rail');
  else if (!cameraButtonOf(rail)) missing.push('photo:camera-button');
  if (!toastsOf()) missing.push('photo:toasts');
  if (typeof readSync('hudChromeHidden') !== 'boolean' || typeof readSync('cutsceneChromeHidden') !== 'boolean') missing.push('photo:cinematic');
  if (!getPixiRefs()?.canvas) missing.push('photo:canvas');
  if (missing.length > 0 || !rail) return missing;
  return {
    cinematic,
    onCinematic(cb) {
      const offs = [subscribe('hudChromeHidden', cb), subscribe('cutsceneChromeHidden', cb)];
      return () => { for (const off of offs) off(); };
    },
    toggleCinematic() {
      // toggleCinematic flips the store's flag and never reads `this` (live 1448), so the rail photo mode began with
      // still turns it off when an engine swap has left no rail to ask.
      const r = railOf() ?? rail;
      (r.toggleCinematic as () => void).call(r);
      return true;
    },
    source: { ticker: hs.ticker, canvas: () => getPixiRefs()?.canvas ?? null, hidden: hiddenNodes },
  };
}

export function livePhotoDeps(hs: SpecHandles, o: LivePhotoOptions): PhotoDeps {
  return {
    game: () => resolvePhotoGame(hs),
    capture: (src) => captureFrame(src),
    strip: (actions) => mountPhotoStrip(actions, { photo: o.photoKey }),
    pageUiHidden: (hidden) => { document.documentElement.classList.toggle(PHOTO_PAGE_CLASS, hidden); },
    output: {
      save: (blob) => { savePhoto(blob, photoFileName(new Date())); },
      copy: copyPhoto,
      downloads: downloadsAvailable,
      preview: previewPhoto,
    },
    unavailable: o.unavailable,
    blocked: o.blocked,
  };
}
