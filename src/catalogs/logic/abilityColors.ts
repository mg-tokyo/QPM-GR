// src/catalogs/logic/abilityColors.ts
// Ability color extraction from game bundle (Gemini-style).

import { fetchBundleContaining, findAllIndices, extractBalancedBlock } from './bundleParser';
import { readSharedGlobal } from '../../core/pageContext';

export interface RuntimeAbilityColor {
  bg: string;
  hover: string;
}

export const DEFAULT_ABILITY_COLOR: RuntimeAbilityColor = {
  bg: 'rgba(100, 100, 100, 0.9)',
  hover: 'rgba(150, 150, 150, 1)',
};

const ABILITY_COLOR_ANCHOR = 'ProduceScaleBoost';

let abilityColorMapCache: Record<string, RuntimeAbilityColor> | null = null;
let abilityColorMapInFlight: Promise<Record<string, RuntimeAbilityColor> | null> | null = null;

function shouldDebug(): boolean {
  try {
    return readSharedGlobal('__QPM_DEBUG_ABILITY_COLORS') === true;
  } catch {
    return false;
  }
}

/**
 * Extract the switch block containing ability colors.
 */
function findAbilityColorSwitchBlock(bundleText: string): string | null {
  const indices = findAllIndices(bundleText, ABILITY_COLOR_ANCHOR);
  if (!indices.length) return null;

  for (const pos of indices) {
    const winStart = Math.max(0, pos - 4000);
    const winEnd = Math.min(bundleText.length, pos + 4000);
    const windowText = bundleText.slice(winStart, winEnd);
    const relSwitches = findAllIndices(windowText, 'switch(');
    if (!relSwitches.length) continue;

    // Check closest switches first. Newer bundles may have multiple nearby switches
    // and the last one in the window is not always the color source.
    relSwitches.sort((a, b) => {
      const distA = Math.abs((winStart + a) - pos);
      const distB = Math.abs((winStart + b) - pos);
      return distA - distB;
    });

    for (const relSwitch of relSwitches) {
      const absSwitch = winStart + relSwitch;
      const braceAfterSwitch = bundleText.indexOf('{', absSwitch);
      if (braceAfterSwitch === -1) continue;

      const block = extractBalancedBlock(bundleText, braceAfterSwitch);
      if (!block) continue;

      const hasLegacyColorObjects = block.includes('bg:"') || block.includes("bg:'") || block.includes('bg:\x60');
      const hasDirectColorReturns = /return\s*(['"\x60])(#|rgb\(|rgba\(|hsl\(|linear-gradient\()/i.test(block);

      if (block.includes(ABILITY_COLOR_ANCHOR) && (hasLegacyColorObjects || hasDirectColorReturns)) {
        return block;
      }
    }
  }

  return null;
}

/**
 * Parse switch cases to build ability color map.
 */
function parseAbilityColorsFromSwitch(switchBlock: string): Record<string, RuntimeAbilityColor> | null {
  const colors: Record<string, RuntimeAbilityColor> = {};
  const pending: string[] = [];
  const tokenRe = /case\s*(['"\x60])([^'"\x60]+)\1\s*:|default\s*:|return\s*\{/g;

  const findProp = (segment: string, prop: 'bg' | 'hover'): string | null => {
    const propRe = new RegExp(`${prop}\\s*:\\s*(['"\\x60])([\\s\\S]*?)\\1`);
    const propMatch = segment.match(propRe);
    const value = propMatch?.[2];
    return typeof value === 'string' ? value : null;
  };

  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(switchBlock)) !== null) {
    if (match[2]) {
      pending.push(match[2]);
      continue;
    }

    const token = match[0];
    if (token.startsWith('default')) {
      pending.length = 0;
      continue;
    }

    if (!token.startsWith('return')) continue;

    const braceIndex = switchBlock.indexOf('{', match.index);
    if (braceIndex === -1) {
      pending.length = 0;
      continue;
    }

    const literal = extractBalancedBlock(switchBlock, braceIndex);
    if (!literal) {
      pending.length = 0;
      continue;
    }

    const bg = findProp(literal, 'bg');
    if (!bg) {
      pending.length = 0;
      continue;
    }
    const hover = findProp(literal, 'hover') || bg;

    for (const id of pending) {
      if (!colors[id]) colors[id] = { bg, hover };
    }
    pending.length = 0;
  }

  return Object.keys(colors).length ? colors : null;
}

function isSupportedColorValue(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return (
    normalized.startsWith('#') ||
    normalized.startsWith('rgb(') ||
    normalized.startsWith('rgba(') ||
    normalized.startsWith('hsl(') ||
    normalized.startsWith('linear-gradient(')
  );
}

/**
 * Parse switch cases that return a direct CSS color string.
 * Newer game bundles use this form instead of { bg, hover } objects.
 */
function parseAbilityColorsFromSimpleSwitch(switchBlock: string): Record<string, RuntimeAbilityColor> | null {
  const colors: Record<string, RuntimeAbilityColor> = {};
  const pending: string[] = [];
  const tokenRe = /case\s*(['"\x60])([^'"\x60]+)\1\s*:|default\s*:|return\s*(['"\x60])([^'"\x60]+)\3/g;

  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(switchBlock)) !== null) {
    if (match[2]) {
      pending.push(match[2]);
      continue;
    }

    const token = match[0];
    if (token.startsWith('default')) {
      pending.length = 0;
      continue;
    }

    const colorValue = match[4];
    if (!colorValue || !isSupportedColorValue(colorValue)) {
      pending.length = 0;
      continue;
    }

    for (const id of pending) {
      if (!colors[id]) {
        colors[id] = { bg: colorValue, hover: colorValue };
      }
    }
    pending.length = 0;
  }

  return Object.keys(colors).length ? colors : null;
}

// '#228B22' is the ProduceScaleBoost hex from getAbilityColor's switch. It is
// unique to the color-switch chunk — main-*.js references ProduceScaleBoost in
// the ability dex and description switches but has zero hex-color returns.
// In v643+ the color switch moved to index-*.js; this marker routes there.
const ABILITY_COLOR_BUNDLE_MARKER = '#228B22';

/**
 * Load ability color map from live main bundle.
 */
async function loadAbilityColorsFromBundle(): Promise<Record<string, RuntimeAbilityColor> | null> {
  const bundleText = await fetchBundleContaining(ABILITY_COLOR_BUNDLE_MARKER);
  if (!bundleText) return null;

  const switchBlock = findAbilityColorSwitchBlock(bundleText);
  if (!switchBlock) {
    if (shouldDebug()) console.log('[QPM Catalog] [AbilityColors] switch block not found');
    return null;
  }

  const map = parseAbilityColorsFromSwitch(switchBlock) || parseAbilityColorsFromSimpleSwitch(switchBlock);
  if (!map && shouldDebug()) console.log('[QPM Catalog] [AbilityColors] switch block found but parse failed');
  if (map && shouldDebug()) console.log('[QPM Catalog] [AbilityColors] parsed ability color map', { count: Object.keys(map).length });
  return map;
}

/**
 * Public getter with single in-flight + positive cache.
 */
export async function getAbilityColorMap(): Promise<Record<string, RuntimeAbilityColor> | null> {
  if (abilityColorMapCache) return abilityColorMapCache;
  if (abilityColorMapInFlight) return abilityColorMapInFlight;

  abilityColorMapInFlight = (async () => {
    const map = await loadAbilityColorsFromBundle();
    if (!map) return null;
    abilityColorMapCache = map;
    return map;
  })().finally(() => {
    abilityColorMapInFlight = null;
  });

  return abilityColorMapInFlight;
}
