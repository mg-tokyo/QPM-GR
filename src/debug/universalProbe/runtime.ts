import { pageWindow } from '../../core/pageContext';
import type { PixiBounds, ProbeBounds, ProbeRuntime } from './types';

type RecordLike = Record<string, unknown>;

function isObject(value: unknown): value is RecordLike {
  return !!value && (typeof value === 'object' || typeof value === 'function');
}

function toNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function parseBounds(value: unknown): PixiBounds | null {
  if (!isObject(value)) return null;
  const x = toNumber(value.x, NaN);
  const y = toNumber(value.y, NaN);
  const width = toNumber(value.width, NaN);
  const height = toNumber(value.height, NaN);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (width <= 0 || height <= 0) return null;
  return { x, y, width, height };
}

export function getLabel(node: unknown): string {
  if (!isObject(node)) return '';
  if (typeof node.label === 'string') return node.label;
  if (typeof node.name === 'string') return node.name;
  return '';
}

export function getNodeAssetHint(node: unknown): string {
  if (!isObject(node)) return '';
  const texture = isObject(node.texture) ? node.texture : null;
  const parts = new Set<string>();
  const push = (value: unknown): void => {
    if (typeof value !== 'string') return;
    const trimmed = value.trim();
    if (trimmed) parts.add(trimmed);
  };
  if (texture) {
    push(texture.label);
    if (Array.isArray(texture.textureCacheIds)) {
      for (const id of texture.textureCacheIds.slice(0, 4)) push(id);
    }
    const source = isObject(texture.source) ? texture.source : isObject(texture.baseTexture) ? texture.baseTexture : null;
    if (source) {
      push(source.label);
      push(source.cacheId);
      const resource = isObject(source.resource) ? source.resource : null;
      if (resource) {
        push(resource.url);
        push(resource.src);
        push(resource.name);
      }
    }
  }
  return Array.from(parts).join(' | ').slice(0, 160);
}

export function isNodeVisible(node: unknown): boolean {
  if (!isObject(node)) return false;
  if (node.visible === false || node.renderable === false || node.worldVisible === false) return false;
  if (typeof node.alpha === 'number' && node.alpha <= 0.001) return false;
  if (typeof node.worldAlpha === 'number' && node.worldAlpha <= 0.001) return false;
  return true;
}

export function getNodeBounds(node: unknown): PixiBounds | null {
  if (!isObject(node) || typeof node.getBounds !== 'function') return null;
  try {
    return parseBounds(node.getBounds());
  } catch {
    return null;
  }
}

export function resolveCanvas(renderer: unknown): HTMLCanvasElement | null {
  const preferred = document.querySelector('.QuinoaCanvas canvas');
  if (preferred instanceof HTMLCanvasElement) return preferred;
  if (isObject(renderer) && renderer.view instanceof HTMLCanvasElement) return renderer.view;
  if (isObject(renderer) && renderer.canvas instanceof HTMLCanvasElement) return renderer.canvas;
  const canvases = Array.from(document.querySelectorAll('canvas')).filter((el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement);
  let best: HTMLCanvasElement | null = null;
  let bestArea = 0;
  for (const canvas of canvases) {
    const rect = canvas.getBoundingClientRect();
    const area = Math.max(0, rect.width) * Math.max(0, rect.height);
    if (area > bestArea) {
      best = canvas;
      bestArea = area;
    }
  }
  return best;
}

export function getProbeRuntime(): ProbeRuntime {
  const root = pageWindow as Window & typeof globalThis & RecordLike;
  const captured = isObject(root.__QPM_PIXI_CAPTURED__) ? root.__QPM_PIXI_CAPTURED__ : null;
  const app = isObject(captured?.app) ? captured.app : isObject(root.__PIXI_APP__) ? root.__PIXI_APP__ : isObject(root.PIXI_APP) ? root.PIXI_APP : isObject(root.app) ? root.app : null;
  const renderer = isObject(captured?.renderer) ? captured.renderer : isObject((app as RecordLike | null)?.renderer) ? (app as RecordLike).renderer : isObject(root.__PIXI_RENDERER__) ? root.__PIXI_RENDERER__ : isObject(root.PIXI_RENDERER) ? root.PIXI_RENDERER : null;
  const stage = isObject((app as RecordLike | null)?.stage) ? (app as RecordLike).stage : null;
  const canvas = resolveCanvas(renderer);
  const version = typeof captured?.version === 'string' ? captured.version : typeof root.__PIXI_VERSION__ === 'string' ? root.__PIXI_VERSION__ : null;
  return { app, renderer, stage, canvas, version, ready: !!(app && renderer && stage && canvas) };
}

export function toCssRect(pixiBounds: PixiBounds, renderer: unknown, canvas: HTMLCanvasElement): ProbeBounds | null {
  const canvasRect = canvas.getBoundingClientRect();
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return null;
  const screen = isObject(renderer) && isObject(renderer.screen) ? renderer.screen : null;
  const screenW = toNumber(screen?.width, canvas.width || 0);
  const screenH = toNumber(screen?.height, canvas.height || 0);
  if (screenW <= 0 || screenH <= 0) return null;
  const scaleX = canvasRect.width / screenW;
  const scaleY = canvasRect.height / screenH;
  if (!Number.isFinite(scaleX) || !Number.isFinite(scaleY) || scaleX <= 0 || scaleY <= 0) return null;
  return {
    left: canvasRect.left + pixiBounds.x * scaleX,
    top: canvasRect.top + pixiBounds.y * scaleY,
    width: pixiBounds.width * scaleX,
    height: pixiBounds.height * scaleY,
  };
}

export function rectArea(rect: ProbeBounds | null): number {
  return rect ? Math.max(0, rect.width) * Math.max(0, rect.height) : 0;
}
