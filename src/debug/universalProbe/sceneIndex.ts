import { getLabel, getNodeAssetHint, getNodeBounds, isNodeVisible, rectArea, toCssRect } from './runtime';
import type { ProbeRuntime, ProbeSceneIndex, ProbeSceneNode } from './types';

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && (typeof value === 'object' || typeof value === 'function');
}

function isInteractive(node: Record<string, unknown>): boolean {
  return node.interactive === true || node.eventMode === 'dynamic' || node.eventMode === 'static' || !!node.hitArea;
}

export function buildSceneIndex(runtime: ProbeRuntime): ProbeSceneIndex {
  const viewportArea = window.innerWidth * window.innerHeight;
  const nodes: ProbeSceneNode[] = [];
  const nodeById = new Map<number, ProbeSceneNode>();
  const childrenByParent = new Map<number, ProbeSceneNode[]>();
  if (!runtime.stage || !runtime.renderer || !runtime.canvas) {
    return { nodes, nodeById, childrenByParent, viewportArea };
  }

  const seen = new WeakSet<object>();
  const stack: Array<{ node: unknown; depth: number; parentId: number }> = [{ node: runtime.stage, depth: 0, parentId: -1 }];

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item || !isObject(item.node)) continue;
    if (seen.has(item.node)) continue;
    seen.add(item.node);
    if (!isNodeVisible(item.node)) continue;

    const childArray = Array.isArray(item.node.children) ? item.node.children : [];
    for (let i = childArray.length - 1; i >= 0; i -= 1) {
      stack.push({ node: childArray[i], depth: item.depth + 1, parentId: nodes.length });
    }

    const pixiBounds = getNodeBounds(item.node);
    if (!pixiBounds || pixiBounds.width * pixiBounds.height < 64) continue;
    const cssRect = toCssRect(pixiBounds, runtime.renderer, runtime.canvas);
    if (!cssRect || rectArea(cssRect) <= 0) continue;

    const id = nodes.length;
    const entry: ProbeSceneNode = {
      id,
      node: item.node,
      depth: item.depth,
      parentId: item.parentId,
      type: typeof item.node.constructor === 'function' && typeof item.node.constructor.name === 'string' ? item.node.constructor.name : 'Unknown',
      label: getLabel(item.node),
      assetHint: getNodeAssetHint(item.node),
      pixiBounds,
      cssRect,
      interactive: isInteractive(item.node),
      childCount: childArray.length,
    };
    nodes.push(entry);
    nodeById.set(id, entry);
    if (!childrenByParent.has(item.parentId)) childrenByParent.set(item.parentId, []);
    childrenByParent.get(item.parentId)?.push(entry);
  }

  return { nodes, nodeById, childrenByParent, viewportArea };
}
