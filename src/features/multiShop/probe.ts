// How a failed open is reported, and what a panel needs from the surface a shop view was built on.
import { createFeatureDiagnostics } from '../../diagnostics/featureDiagnostics';
import { isRecord } from '../../utils/typeGuards';

export type ShopOpenResult =
  | { ok: true; shops: string[]; skipped: Record<string, string> }
  | { ok: false; reason: 'busy' | 'open' | 'no-shops' | 'unavailable' | 'failed' | 'cancelled'; missing?: string[]; skipped?: Record<string, string> };

/** A key press, Escape, a tap outside, another modal, stop or a renderer rebuild ended the open while it was building. */
export const CANCELLED: ShopOpenResult = { ok: false, reason: 'cancelled' };

export const diagnostics = createFeatureDiagnostics('feature:multiShop', 'multiShop');

let lastMissingKey = '';

const isFn = (v: unknown): boolean => typeof v === 'function';
const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);

/** The UI container and renderer a shop view was built with; empty when hosts and cell renderers can be made from them. */
export function checkSurface(ui: unknown, renderer: unknown): string[] {
  const missing: string[] = [];
  if (!isRecord(ui) || !Array.isArray(ui.children) || !isFn(ui.addChild) || !isFn(ui.constructor) || ui.constructor === Object) missing.push('ui');
  if (!isRecord(renderer) || !finite(renderer.width) || !finite(renderer.height)) missing.push('renderer');
  return missing;
}

/** Logged once per distinct set of missing handles, until an open succeeds. */
export function reportMissing(missing: string[]): ShopOpenResult {
  const key = missing.join(',');
  if (key !== lastMissingKey) {
    lastMissingKey = key;
    diagnostics.warnFeature('QPM-MSHOP-001', { missing });
  }
  return { ok: false, reason: 'unavailable', missing };
}

export function clearMissingReport(): void {
  lastMissingKey = '';
}

export function failOpen(stage: string, error?: unknown): ShopOpenResult {
  diagnostics.warnFeature('QPM-MSHOP-002', { stage }, error);
  return { ok: false, reason: 'failed' };
}
