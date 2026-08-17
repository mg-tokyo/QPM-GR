import { getPixiRuntime, walkScene } from '../../../core/pixiScene';
import { createNamedLogger } from '../../../diagnostics/logger';

const log = createNamedLogger('td');

// Hides every player/NPC pet in the world while TD is running. Pets are
// Jotai-driven (renderedPetInfosAtom), so the patch-stage state doctor used
// for garden tiles cannot suppress them — the atom is written after patch
// subscribers fire (beta RoomConnection.ts:825-829). We hide at the PIXI
// layer instead by matching PetView container labels.
//
// Every PetView wraps its RiveSprite in a Container labeled `Pet: <species>`
// (beta PetView.ts:328-332). We toggle `visible = false` on those wrappers
// per frame — matches garden-painter's re-assertion pattern in
// rivePetOverlay.ts:112-115 (game render code may flip the flag back).
// Balloons are unrelated PIXI Sprites without any label, so they're unaffected.

const PET_LABEL_PREFIX = 'Pet: ';

interface PixiNode {
  label?: unknown;
  visible?: boolean;
  children?: unknown;
}

type TickerNode = {
  add?: (cb: () => void) => void;
  remove?: (cb: () => void) => void;
};

interface HiderState {
  rafId: number | null;
  tickerCb: (() => void) | null;
  ticker: TickerNode | null;
  hidden: WeakSet<object>;
  restoreList: PixiNode[];
}

let state: HiderState | null = null;

function isNode(v: unknown): v is PixiNode {
  return !!v && typeof v === 'object';
}

function getLabel(node: PixiNode): string {
  const l = node.label;
  return typeof l === 'string' ? l : '';
}

function sweep(): void {
  const s = state;
  if (!s) return;
  const rt = getPixiRuntime();
  if (!rt.ready || !rt.stage) return;
  try {
    walkScene(rt.stage, (node): void => {
      if (!isNode(node)) return;
      if (!getLabel(node).startsWith(PET_LABEL_PREFIX)) return;
      if (node.visible !== false) node.visible = false;
      if (!s.hidden.has(node)) {
        s.hidden.add(node);
        s.restoreList.push(node);
      }
    }, { maxNodes: 20_000 });
  } catch (err) {
    log.warn('QPM-TD-PETHIDE-001', { reason: 'sweep_threw' }, err);
  }
}

function frame(): void {
  const s = state;
  if (!s) return;
  sweep();
  s.rafId = requestAnimationFrame(frame);
}

export function initPetHider(): void {
  if (state) return;
  state = {
    rafId: null,
    tickerCb: null,
    ticker: null,
    hidden: new WeakSet<object>(),
    restoreList: [],
  };
  const rt = getPixiRuntime();
  const app = rt.app as { ticker?: TickerNode } | null;
  const ticker = app?.ticker;
  if (ticker && typeof ticker.add === 'function') {
    const cb = () => sweep();
    ticker.add(cb);
    state.ticker = ticker;
    state.tickerCb = cb;
    sweep();
    return;
  }
  state.rafId = requestAnimationFrame(frame);
}

export function stopPetHider(): void {
  const s = state;
  if (!s) return;
  state = null;
  if (s.tickerCb && s.ticker && typeof s.ticker.remove === 'function') {
    try { s.ticker.remove(s.tickerCb); } catch { /* ignore */ }
  }
  if (s.rafId !== null) {
    try { cancelAnimationFrame(s.rafId); } catch { /* ignore */ }
  }
  for (const node of s.restoreList) {
    try {
      node.visible = true;
    } catch { /* ignore */ }
  }
  s.restoreList.length = 0;
}
