// src/core/pixiSceneEvents.ts
// One-time monkey-patch of PIXI Container.prototype.addChild / removeChild
// to expose a push-based API for label-matched scene-graph events. Replaces
// per-invalidation stage walks with true event-driven cache updates.
//
// Rationale: MG destroys and rebuilds labeled containers (GardenInfoObjectCard,
// GardenInfoCardSystem, etc.) on every tile focus change and slot cycle.
// The previous approach re-walked the stage on each invalidation; this hook
// notifies subscribers the moment a node is added or removed. Idempotent —
// safe to call ensurePatched() from multiple modules; only patches once.

import { pageWindow } from './pageContext';

interface PixiNode {
  label?: unknown;
  children?: PixiNode[];
  destroyed?: unknown;
  parent?: unknown;
}

interface PixiCapture {
  app?: { stage?: PixiNode };
}

type NodeListener = (node: PixiNode) => void;

const addListeners = new Map<string, Set<NodeListener>>();
const removeListeners = new Map<string, Set<NodeListener>>();
let patched = false;

function getStage(): PixiNode | null {
  const root = pageWindow as Window & typeof globalThis & { __QPM_PIXI_CAPTURED__?: PixiCapture };
  return root.__QPM_PIXI_CAPTURED__?.app?.stage ?? null;
}

/**
 * Monkey-patch Container.prototype.addChild / removeChild. Reached via the
 * stage instance's prototype chain — PIXI internally re-uses one Container
 * class, so patching its prototype covers every container in the scene.
 * Returns true on successful patch, false if the stage isn't captured yet.
 */
function ensurePatched(): boolean {
  if (patched) return true;
  const stage = getStage();
  if (!stage) return false;
  const proto = Object.getPrototypeOf(stage) as {
    addChild?: (...children: PixiNode[]) => PixiNode;
    removeChild?: (...children: PixiNode[]) => PixiNode;
  } | null;
  if (!proto || typeof proto.addChild !== 'function' || typeof proto.removeChild !== 'function') {
    return false;
  }

  const originalAddChild = proto.addChild;
  const originalRemoveChild = proto.removeChild;

  proto.addChild = function patchedAddChild(this: PixiNode, ...children: PixiNode[]) {
    const result = originalAddChild.apply(this, children);
    for (const child of children) {
      const label = child?.label;
      if (typeof label !== 'string' || label.length === 0) continue;
      const set = addListeners.get(label);
      if (!set) continue;
      for (const cb of set) {
        try { cb(child); } catch { /* isolate listener failures */ }
      }
    }
    return result;
  };

  proto.removeChild = function patchedRemoveChild(this: PixiNode, ...children: PixiNode[]) {
    for (const child of children) {
      const label = child?.label;
      if (typeof label !== 'string' || label.length === 0) continue;
      const set = removeListeners.get(label);
      if (!set) continue;
      for (const cb of set) {
        try { cb(child); } catch { /* isolate listener failures */ }
      }
    }
    return originalRemoveChild.apply(this, children);
  };

  patched = true;
  return true;
}

const _scanStack: PixiNode[] = [];

function scanExistingByLabel(root: PixiNode, label: string): PixiNode[] {
  const stack = _scanStack;
  stack.length = 0;
  stack.push(root);
  const seen = new WeakSet<object>();
  const out: PixiNode[] = [];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    if (seen.has(node as object)) continue;
    seen.add(node as object);
    if (typeof node.label === 'string' && node.label === label) out.push(node);
    if (Array.isArray(node.children)) {
      for (let i = node.children.length - 1; i >= 0; i--) {
        const c = node.children[i];
        if (c) stack.push(c);
      }
    }
  }
  return out;
}

/**
 * Register a listener called synchronously whenever a container with the
 * exact `label` is added anywhere in the scene graph. Also fires immediately
 * for any already-present matching nodes so late subscribers catch up without
 * a race. Returns an unsubscribe function.
 *
 * If PIXI isn't captured yet, the listener is still registered; the patch
 * attaches lazily on the next call once the stage is available. Late listeners
 * always get the initial scan when they register.
 */
export function onPixiNodeAdded(label: string, cb: NodeListener): () => void {
  const wasPatchable = ensurePatched();

  let set = addListeners.get(label);
  if (!set) {
    set = new Set();
    addListeners.set(label, set);
  }
  set.add(cb);

  // Initial scan — fire cb for any pre-existing matching nodes.
  if (wasPatchable) {
    const stage = getStage();
    if (stage) {
      const existing = scanExistingByLabel(stage, label);
      for (const node of existing) {
        try { cb(node); } catch { /* ignore */ }
      }
    }
  }

  return () => {
    const s = addListeners.get(label);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) addListeners.delete(label);
  };
}

/**
 * Register a listener called synchronously whenever a container with the
 * exact `label` is removed from any parent. Returns an unsubscribe function.
 * Note: this does not fire on `.destroy()` without an accompanying
 * `.removeChild()`; consumers should still guard reads on `node.destroyed`.
 */
export function onPixiNodeRemoved(label: string, cb: NodeListener): () => void {
  ensurePatched();
  let set = removeListeners.get(label);
  if (!set) {
    set = new Set();
    removeListeners.set(label, set);
  }
  set.add(cb);
  return () => {
    const s = removeListeners.get(label);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) removeListeners.delete(label);
  };
}
