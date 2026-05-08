import { buildDomIndex } from './domIndex';
import type { ProbeSceneIndex, ProbeTargetCandidate, ProbeTargetMode } from './types';

const ACTION_KEYWORDS = ['button', 'action', 'feed', 'pickup', 'pick up', 'sell', 'shop', 'garden', 'settings', 'close', 'open', 'menu'];
const SCENE_KEYWORDS = ['pet', 'card', 'shop', 'building', 'house', 'store', 'asset', 'npc', 'inventory', 'modal', 'panel', 'egg', 'flower', 'plant', 'crop', 'decor'];

function keywordScore(value: string, keywords: string[]): number {
  const text = value.toLowerCase();
  let score = 0;
  for (const keyword of keywords) {
    if (text.includes(keyword)) score += keyword.length >= 5 ? 12 : 8;
  }
  return score;
}

export function detectTargets(scene: ProbeSceneIndex | null, mode: ProbeTargetMode = 'action', onlyInteractive = false, topN = 120): ProbeTargetCandidate[] {
  const out: ProbeTargetCandidate[] = [];
  if (scene) {
    for (const node of scene.nodes) {
      const area = node.cssRect.width * node.cssRect.height;
      if (area < 80 || area > 500000) continue;
      if (onlyInteractive && !node.interactive) continue;
      const labelText = `${node.label} ${node.type} ${node.assetHint}`;
      const actionScore = keywordScore(labelText, ACTION_KEYWORDS) + (node.interactive ? 22 : 0);
      const sceneScore = keywordScore(labelText, SCENE_KEYWORDS) + Math.min(18, node.childCount * 2);
      const kind = actionScore >= sceneScore ? 'action-target' : 'scene-object';
      if (mode === 'action' && kind !== 'action-target') continue;
      if (mode === 'scene' && kind !== 'scene-object') continue;
      out.push({
        source: 'pixi',
        kind,
        type: node.type,
        label: node.label,
        assetHint: node.assetHint,
        boundsCss: node.cssRect,
        confidence: Math.min(99, 35 + Math.max(actionScore, sceneScore)),
        interactive: node.interactive,
        childCount: node.childCount,
        node: node.node,
      });
    }
  }
  for (const entry of buildDomIndex()) {
    if (onlyInteractive && !entry.interactive) continue;
    const text = `${entry.label} ${entry.type} ${entry.role}`;
    const actionScore = keywordScore(text, ACTION_KEYWORDS) + (entry.interactive ? 28 : 0);
    const sceneScore = keywordScore(text, SCENE_KEYWORDS) + Math.min(12, entry.childCount);
    const kind = actionScore >= sceneScore ? 'action-target' : 'scene-object';
    if (mode === 'action' && kind !== 'action-target') continue;
    if (mode === 'scene' && kind !== 'scene-object') continue;
    const roleBoost = entry.role === 'dialog' ? 28 : entry.role ? 8 : 0;
    const canvasBoost = entry.type === 'canvas' ? 38 : 0;
    out.push({
      source: 'dom',
      kind,
      type: entry.role ? `${entry.type}[role=${entry.role}]` : entry.type,
      label: entry.label,
      boundsCss: entry.boundsCss,
      confidence: Math.min(98, 32 + Math.max(actionScore, sceneScore) + roleBoost + canvasBoost),
      interactive: entry.interactive,
      role: entry.role,
      childCount: entry.childCount,
      layout: entry.layout,
      element: entry.element,
    });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, topN);
}
