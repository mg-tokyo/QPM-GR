import { RewrapBudget } from './rewrap';

// renderer.render wrapper. Stage renders go to the 3D frame handler; everything else (offscreen targets,
// generateTexture, our own probes and bakes) passes through. A wrapper that is displaced or uninstalled is retired,
// not removed (another mod may hold it in its chain), so at most one QPM wrapper is ever active.
type RenderFn = (this: unknown, ...args: unknown[]) => unknown;
type Wrapper = RenderFn & { __qpmWrapped?: true; __qpmLabel?: string; __qpmRetired?: boolean };
export type StageHandler = (callOriginal: () => unknown) => unknown;

interface Host { render: unknown }

let host: Host | null = null;
let hadOwn = false;
let original: RenderFn | null = null;
let wrapper: Wrapper | null = null;
let stageRef: object | null = null;
let handler: StageHandler | null = null;
let inStage = false;
let budget = new RewrapBudget();

const isStage = (t: unknown): boolean =>
  t === stageRef || (typeof t === 'object' && t !== null && (t as { container?: unknown }).container === stageRef);

function makeWrapper(inner: RenderFn): Wrapper {
  const w: Wrapper = function (this: unknown, ...args: unknown[]) {
    if (w.__qpmRetired || inStage || !handler || !isStage(args[0])) return inner.apply(this, args);
    inStage = true;
    try { return handler(() => inner.apply(this, args)); } finally { inStage = false; }
  };
  w.__qpmWrapped = true;
  w.__qpmLabel = 'camera3d.render';
  return w;
}

export function installRenderHook(renderer: Host, stage: object, onStage: StageHandler): boolean {
  if (typeof renderer.render !== 'function') return false;
  if (host && host !== renderer) uninstallRenderHook();
  stageRef = stage;
  handler = onStage;
  if (host === renderer && wrapper && renderer.render === wrapper) return true;
  host = renderer;
  hadOwn = Object.prototype.hasOwnProperty.call(renderer, 'render');
  original = renderer.render as RenderFn;
  wrapper = makeWrapper(original);
  renderer.render = wrapper;
  budget = new RewrapBudget();
  return true;
}

export function getRenderHookState(): 'absent' | 'installed' | 'displaced' {
  if (!host || !wrapper) return 'absent';
  return host.render === wrapper ? 'installed' : 'displaced';
}

/** Another script replaced renderer.render: retire ours wherever it is and wrap whatever is current, within the
 * re-wrap budget ('capped' once, then 'denied': a fight, A R7). */
export function ensureRenderHook(now: number): 'ok' | 'rewrapped' | 'absent' | 'capped' | 'denied' {
  if (!host || !wrapper || !handler) return 'absent';
  if (host.render === wrapper) return 'ok';
  const b = budget.take(now);
  if (b !== 'ok') return b;
  wrapper.__qpmRetired = true;
  hadOwn = Object.prototype.hasOwnProperty.call(host, 'render');
  original = host.render as RenderFn;
  wrapper = makeWrapper(original);
  host.render = wrapper;
  return 'rewrapped';
}

export function uninstallRenderHook(): void {
  if (host && wrapper && original) {
    if (host.render === wrapper) {
      if (hadOwn) host.render = original;
      else delete (host as unknown as Record<string, unknown>).render;
    } else {
      wrapper.__qpmRetired = true;
    }
  }
  host = null; original = null; wrapper = null; handler = null; stageRef = null;
}
