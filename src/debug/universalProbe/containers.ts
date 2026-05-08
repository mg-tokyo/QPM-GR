import { buildDomIndex } from './domIndex';
import type { ProbeContainerCandidate, ProbeSceneIndex } from './types';

export function detectContainers(scene: ProbeSceneIndex | null, includeDomContainers = true): ProbeContainerCandidate[] {
  const out: ProbeContainerCandidate[] = [];
  if (scene) {
    for (const node of scene.nodes) {
      if (node.childCount < 2) continue;
      const area = node.cssRect.width * node.cssRect.height;
      if (area < 1800) continue;
      out.push({
        source: 'pixi',
        kind: 'container',
        kindGuess: node.interactive ? 'interactive-container' : 'scene-container',
        type: node.type,
        label: node.label,
        assetHint: node.assetHint,
        boundsCss: node.cssRect,
        confidence: Math.min(98, 45 + Math.min(30, node.childCount * 3) + (node.label ? 10 : 0)),
        childCount: node.childCount,
        node: node.node,
      });
    }
  }
  if (includeDomContainers) {
    for (const entry of buildDomIndex()) {
      if (entry.childCount < 2) continue;
      const area = entry.boundsCss.width * entry.boundsCss.height;
      if (area < 700) continue;
      out.push({
        source: 'dom',
        kind: 'container',
        kindGuess: entry.role || entry.layout.pattern || 'dom-container',
        type: entry.type,
        label: entry.label,
        boundsCss: entry.boundsCss,
        confidence: Math.min(95, 42 + Math.min(24, entry.childCount * 2) + (entry.interactive ? 8 : 0) + (entry.label ? 8 : 0)),
        childCount: entry.childCount,
        layout: entry.layout,
        element: entry.element,
      });
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, 120);
}
