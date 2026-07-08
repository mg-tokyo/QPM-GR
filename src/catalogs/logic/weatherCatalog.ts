// src/catalogs/logic/weatherCatalog.ts
// Weather catalog extraction from live main bundle (Gemini-style).

import { fetchMainBundle, extractBalancedBlock, extractBalancedObjectLiteral, findAllIndices, markBundleConsumerDone } from './bundleParser';
import { readSharedGlobal } from '../../core/pageContext';

const WEATHER_IDS = ['Rain', 'Frost', 'Thunderstorm', 'Dawn', 'AmberMoon'] as const;

type RawWeatherEntry = Record<string, unknown>;
export type RuntimeWeatherCatalog = Record<string, Record<string, unknown>>;

let weatherCatalogCache: RuntimeWeatherCatalog | null = null;
let weatherCatalogInFlight: Promise<RuntimeWeatherCatalog | null> | null = null;

function shouldDebug(): boolean {
  try {
    return (
      readSharedGlobal('__QPM_DEBUG_WEATHER_CATALOG') === true ||
      readSharedGlobal('__QPM_DEBUG_CATALOGS') === true ||
      readSharedGlobal('__QPM_VERBOSE_LOGS') === true
    );
  } catch {
    return false;
  }
}

function buildWeather(data: unknown): RuntimeWeatherCatalog | null {
  const source = data && typeof data === 'object' ? (data as Record<string, RawWeatherEntry>) : null;
  if (!source) return null;

  const out: RuntimeWeatherCatalog = {};
  let found = false;

  for (const id of WEATHER_IDS) {
    const blueprint = source[id];
    if (!blueprint || typeof blueprint !== 'object') continue;
    const raw = blueprint as RawWeatherEntry;
    const spriteId = typeof raw.iconSpriteKey === 'string' ? raw.iconSpriteKey : null;
    const { iconSpriteKey: _iconSpriteKey, ...rest } = raw;
    out[id] = { weatherId: id, spriteId, ...rest };
    found = true;
  }

  // Keep Sunny available even when not explicitly included in the parsed object.
  if (!out.Sunny) {
    out.Sunny = {
      weatherId: 'Sunny',
      name: 'Sunny',
      spriteId: 'sprite/ui/SunnyIcon',
      type: 'primary',
    };
  }

  if (!found) return null;

  // Basic sanity check to avoid capturing the wrong object.
  const rainMutation = ((out.Rain as Record<string, unknown> | undefined)?.mutator as Record<string, unknown> | undefined)?.mutation;
  if (rainMutation && rainMutation !== 'Wet') return null;

  // Runtime/weather APIs often use "Snow" while game catalogs use "Frost".
  // Add alias for compatibility so consumers can read either ID.
  if (out.Frost && !out.Snow) {
    out.Snow = { ...out.Frost, weatherId: 'Snow', name: 'Snow' };
  }

  return out;
}

function extractWeatherObject(text: string, anchorPos: number): string | null {
  // Search backward for "Rain:{" and then expand the containing object block.
  const searchStart = Math.max(0, anchorPos - 3000);
  const searchArea = text.substring(searchStart, anchorPos);
  const match = searchArea.match(/Rain:\{/);
  if (!match || match.index === undefined) return null;

  const rainStart = searchStart + match.index;
  let objectStart = -1;
  for (let i = rainStart - 1; i >= Math.max(0, rainStart - 200); i -= 1) {
    if (text[i] === '{') {
      objectStart = i;
      break;
    }
  }
  if (objectStart < 0) return null;
  return extractBalancedBlock(text, objectStart);
}

function normalizeWeatherLiteral(literal: string): string {
  return literal
    // Handle computed property keys like [gt.Rain]
    .replace(/\[([A-Za-z_$][\w$]*\.)(Rain|Frost|Dawn|AmberMoon|Thunderstorm)\]/g, '"$2"')
    // Normalize groupId enum references (Bc.Hydro -> "Hydro", Bc.Lunar -> "Lunar")
    .replace(/\b[A-Za-z_$][\w$]*\.(Hydro|Lunar)\b/g, '"$1"')
    // Keep older enum patterns as fallback.
    .replace(/\$t\.(Rain|Frost|Dawn|AmberMoon|Thunderstorm)\b/g, '"$1"')
    .replace(/\b[A-Za-z_$][\w$]*\.(Rain|Frost|Dawn|AmberMoon|Thunderstorm)\b/g, '"$1"');
}

function removeComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^\\])\/\/.*$/gm, '$1');
}

function convertSingleQuotedStrings(source: string): string {
  return source.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, (_m, inner: string) => {
    const unescaped = inner.replace(/\\'/g, "'").replace(/\\"/g, '"');
    return JSON.stringify(unescaped);
  });
}

function quoteUnquotedKeys(source: string): string {
  return source.replace(/([,{]\s*)([A-Za-z_$][\w$]*)(\s*:)/g, '$1"$2"$3');
}

function normalizeJsLiterals(source: string): string {
  return source
    .replace(/\bundefined\b/g, 'null')
    .replace(/\bvoid\s+0\b/g, 'null')
    .replace(/\bNaN\b/g, 'null')
    .replace(/\bInfinity\b/g, 'null')
    .replace(/\b-Infinity\b/g, 'null')
    .replace(/!0/g, 'true')
    .replace(/!1/g, 'false')
    .replace(/,\s*([}\]])/g, '$1');
}

function hasUnsafeToken(source: string): boolean {
  // Reject executable constructs to keep parser non-executing.
  return /(?:=>|\bfunction\b|\bnew\b|\bthis\b|\bwindow\b|\bdocument\b|\bglobalThis\b|;|`|\(|\))/i.test(source);
}

function toStrictJsonCandidate(literal: string): string | null {
  const withoutComments = removeComments(literal).trim();
  if (!withoutComments.startsWith('{') || !withoutComments.endsWith('}')) return null;
  if (hasUnsafeToken(withoutComments)) return null;

  const converted = normalizeJsLiterals(
    quoteUnquotedKeys(
      convertSingleQuotedStrings(withoutComments),
    ),
  );
  return converted;
}

function parseWeatherLiteral(literal: string): RuntimeWeatherCatalog | null {
  const fixedLiteral = normalizeWeatherLiteral(literal);
  const jsonCandidate = toStrictJsonCandidate(fixedLiteral);
  if (!jsonCandidate) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    return null;
  }

  return buildWeather(parsed);
}

function findAnchors(bundleText: string): number[] {
  const anchors = new Set<number>();

  for (const token of ['mutator', 'name:"Amber Moon"', "name:'Amber Moon'", 'AmberMoon', 'Rain:{']) {
    for (const idx of findAllIndices(bundleText, token)) {
      anchors.add(idx);
    }
  }

  return Array.from(anchors).sort((a, b) => a - b);
}

async function loadWeatherCatalogFromBundle(): Promise<RuntimeWeatherCatalog | null> {
  const bundleText = await fetchMainBundle();
  if (!bundleText) return null;

  const anchors = findAnchors(bundleText);
  if (!anchors.length) {
    if (shouldDebug()) console.log('[QPM Catalog] [WeatherCatalog] anchor not found');
    return null;
  }

  // Try each anchor until we find a valid weather catalog.
  for (const anchor of anchors) {
    const literalCandidates = [
      extractBalancedObjectLiteral(bundleText, anchor),
      extractWeatherObject(bundleText, anchor),
    ];

    for (const literal of literalCandidates) {
      if (!literal) continue;
      const catalog = parseWeatherLiteral(literal);
      if (catalog) return catalog;
    }
  }

  if (shouldDebug()) console.log('[QPM Catalog] [WeatherCatalog] parsed object rejected by validator');
  return null;
}

export async function getWeatherCatalogMap(): Promise<RuntimeWeatherCatalog | null> {
  if (weatherCatalogCache) return weatherCatalogCache;
  if (weatherCatalogInFlight) return weatherCatalogInFlight;

  weatherCatalogInFlight = (async () => {
    const map = await loadWeatherCatalogFromBundle();
    if (!map) return null;
    weatherCatalogCache = map;
    markBundleConsumerDone('weather');
    return map;
  })().finally(() => {
    weatherCatalogInFlight = null;
  });

  return weatherCatalogInFlight;
}
