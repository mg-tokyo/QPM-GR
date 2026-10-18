import type { SpecTicker } from '../handles';

// Live 1448 ticker order: engine onTick 0, app render −25, onPresented −26. Between the engine frame and the render the
// game has set this frame's alphas; after the present, the drawing buffer still holds the frame (preserveDrawingBuffer is
// false, so it is only readable in the same task).
export const PRE_RENDER = -1;
export const POST_PRESENT = -27;
const TIMEOUT_MS = 3000;

export interface AlphaNode { alpha: number }

export interface CaptureSource {
  ticker: SpecTicker;
  /** Read on the captured frame: the game re-creates its renderer after a lost WebGL context. */
  canvas(): HTMLCanvasElement | null;
  /** What stays out of the shot, resolved on the captured frame: the toasts and the camera icon (PS3). */
  hidden(): readonly AlphaNode[];
}

export interface CaptureIo {
  copy(src: HTMLCanvasElement): HTMLCanvasElement | null;
  encode(c: HTMLCanvasElement): Promise<Blob | null>;
}

export interface CaptureJob { result: Promise<Blob | null>; cancel(): void }

const canvasIo: CaptureIo = {
  copy(src) {
    const c = document.createElement('canvas');
    c.width = src.width;
    c.height = src.height;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(src, 0, 0);
    return c;
  },
  encode: (c) => new Promise((resolve) => { c.toBlob((b) => { resolve(b); }, 'image/png'); }),
};

/** One frame of the game canvas at its native size (S §9, F11). Alpha, not visible: a visible flip rebuilds the render
 * group. Every way out (done, cancel, timeout, a throw) restores the saved alphas and removes both listeners. */
export function captureFrame(src: CaptureSource, opts: { timeoutMs?: number } = {}, io: CaptureIo = canvasIo): CaptureJob {
  const { ticker } = src;
  let saved: Array<[AlphaNode, number]> = [];
  // Something meant to stay out of the shot could not be hidden: no image rather than one that shows it.
  let spoiled = false;
  let settled = false;
  let finish: (b: Blob | null) => void = () => {};
  const result = new Promise<Blob | null>((resolve) => { finish = resolve; });

  const restore = (): void => {
    for (const [node, alpha] of saved) {
      try { node.alpha = alpha; } catch { /* a node destroyed mid-frame */ }
    }
    saved = [];
  };
  const detach = (): void => {
    clearTimeout(timer);
    try { ticker.remove(pre, null); } catch { /* the ticker is gone with its app */ }
    try { ticker.remove(post, null); } catch { /* the ticker is gone with its app */ }
    restore();
  };
  const settle = (b: Blob | null): void => {
    if (settled) return;
    settled = true;
    finish(b);
  };

  function pre(): void {
    try {
      for (const node of src.hidden()) {
        saved.push([node, node.alpha]);
        node.alpha = 0;
      }
    } catch {
      restore();
      spoiled = true;
    }
  }
  function post(): void {
    let copy: HTMLCanvasElement | null = null;
    try {
      const canvas = spoiled ? null : src.canvas();
      copy = canvas ? io.copy(canvas) : null;
    } catch { copy = null; }
    detach();
    if (!copy) { settle(null); return; }
    io.encode(copy).then((b) => { settle(b); }, () => { settle(null); });
  }

  const timer = setTimeout(() => { detach(); settle(null); }, opts.timeoutMs ?? TIMEOUT_MS);
  try {
    ticker.add(pre, null, PRE_RENDER);
    ticker.add(post, null, POST_PRESENT);
  } catch {
    detach();
    settle(null);
  }
  return {
    result,
    cancel() {
      if (settled) return;
      detach();
      settle(null);
    },
  };
}
