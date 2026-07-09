// Pure text parsing over fetched game-bundle chunks. This module must stay
// free of ALL imports — scripts/check-weather-parser.mjs imports it directly
// under node --experimental-strip-types, which cannot resolve dependencies.

export function findAllIndices(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    out.push(idx);
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return out;
}

/**
 * Extract balanced block from text starting at open brace index.
 * Handles nested braces and string literals.
 */
export function extractBalancedBlock(text: string, openBraceIndex: number): string | null {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let i = openBraceIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === '\\') {
        escaped = true;
        continue;
      }
      if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return text.slice(openBraceIndex, i + 1);
  }

  return null;
}

export function extractBalancedArray(text: string, openBracketIndex: number): string | null {
  let depth = 0;
  let quote = '';
  let escaped = false;

  for (let i = openBracketIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }

    if (ch === '"' || ch === '\'' || ch === '`') { quote = ch; continue; }
    if (ch === '[') depth += 1;
    else if (ch === ']' && --depth === 0) return text.slice(openBracketIndex, i + 1);
  }

  return null;
}

/**
 * Extract balanced object literal from text starting near an anchor index.
 * Looks backward for const/let/var assignment and returns the object block.
 */
export function extractBalancedObjectLiteral(text: string, anchorIndex: number): string | null {
  const declStart = Math.max(
    text.lastIndexOf('const ', anchorIndex),
    text.lastIndexOf('let ', anchorIndex),
    text.lastIndexOf('var ', anchorIndex),
  );
  if (declStart < 0) return null;

  const eq = text.indexOf('=', declStart);
  if (eq < 0 || eq > anchorIndex) return null;

  const braceStart = text.indexOf('{', eq);
  if (braceStart < 0 || braceStart > anchorIndex) return null;

  return extractBalancedBlock(text, braceStart);
}

export function convertBacktickStrings(source: string): string {
  return source.replace(/`([^`\\]*(\\.[^`\\]*)*)`/g, (_m, inner: string) => {
    const unescaped = inner.replace(/\\`/g, '`').replace(/\\"/g, '"');
    return JSON.stringify(unescaped);
  });
}

// ── Weather blueprint pipeline ──────────────────────────────────────────────
// The game's weather blueprint has kept this literal shape across every build
// scraped since pr-2478 AND production v679 (Rolldown), only moving between
// chunks and switching string quoting:
//   {[xh.Rain]:{groupId:bh.Hydro,iconSpriteKey:J.Ui.RainIcon,name:`Rain`,
//     mutator:{mutation:`Wet`,chancePerMinutePerCrop:7}}, ...}

export type RuntimeWeatherCatalog = Record<string, Record<string, unknown>>;

const WEATHER_IDS = ['Rain', 'Frost', 'Thunderstorm', 'Dawn', 'AmberMoon'] as const;

/**
 * Identifies the chunk that DEFINES the blueprint. Consumer chunks reference
 * `x[weatherId].mutator` but never contain `mutator:{mutation:` — verified
 * against production v679 index/main and beta pr-3063 main. Keep non-global.
 */
export const WEATHER_BLUEPRINT_MARKER = /mutator:\s*\{\s*mutation:/;

function buildWeather(data: unknown): RuntimeWeatherCatalog | null {
  const source = data && typeof data === 'object' ? (data as Record<string, Record<string, unknown>>) : null;
  if (!source) return null;

  const out: RuntimeWeatherCatalog = {};
  let found = false;

  for (const id of WEATHER_IDS) {
    const blueprint = source[id];
    if (!blueprint || typeof blueprint !== 'object') continue;
    const raw = blueprint;
    const spriteId = typeof raw.iconSpriteKey === 'string' ? raw.iconSpriteKey : null;
    const { iconSpriteKey: _iconSpriteKey, ...rest } = raw;
    out[id] = { weatherId: id, spriteId, ...rest };
    found = true;
  }

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
  if (out.Frost && !out.Snow) {
    out.Snow = { ...out.Frost, weatherId: 'Snow', name: 'Snow' };
  }

  return out;
}

function extractWeatherObjectNearAnchor(text: string, anchorPos: number): string | null {
  const searchStart = Math.max(0, anchorPos - 3000);
  const searchArea = text.substring(searchStart, anchorPos + 200);
  // Matches both plain `Rain:{` (pre-Rolldown) and computed `[xh.Rain]:{`.
  const match = searchArea.match(/(?:\[[A-Za-z_$][\w$]*\.Rain\]|Rain)\s*:\s*\{/);
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
    // Computed property keys like [gt.Rain]
    .replace(/\[([A-Za-z_$][\w$]*\.)(Rain|Frost|Dawn|AmberMoon|Thunderstorm)\]/g, '"$2"')
    // groupId enum references (Bc.Hydro -> "Hydro")
    .replace(/\b[A-Za-z_$][\w$]*\.(Hydro|Lunar)\b/g, '"$1"')
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

/**
 * Quote bare member-expression VALUES so JSON.parse survives them.
 * Sprite-enum refs map to their real key: prod defines RainIcon as
 * `sprite/ui/RainIcon`, so `J.Ui.RainIcon` -> "sprite/ui/RainIcon".
 */
function quoteMemberExpressionValues(source: string): string {
  return source.replace(
    /(:\s*)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)(?=\s*[,}\]])/g,
    (_m, prefix: string, path: string) => {
      const uiMatch = path.match(/\.Ui\.([A-Za-z_$][\w$]*)$/);
      if (uiMatch) return `${prefix}"sprite/ui/${uiMatch[1]}"`;
      return `${prefix}"${path}"`;
    },
  );
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
  // Reject executable constructs to keep parser non-executing. Runs AFTER
  // convertBacktickStrings, so a surviving backtick means an unconverted
  // template literal (interpolation) — reject those too.
  return /(?:=>|\bfunction\b|\bnew\b|\bthis\b|\bwindow\b|\bdocument\b|\bglobalThis\b|;|`|\(|\))/i.test(source);
}

function toStrictJsonCandidate(literal: string): string | null {
  const withoutComments = removeComments(literal).trim();
  if (!withoutComments.startsWith('{') || !withoutComments.endsWith('}')) return null;

  const noBackticks = convertBacktickStrings(withoutComments);
  if (hasUnsafeToken(noBackticks)) return null;

  return normalizeJsLiterals(
    quoteMemberExpressionValues(
      quoteUnquotedKeys(
        convertSingleQuotedStrings(noBackticks),
      ),
    ),
  );
}

function parseWeatherLiteral(literal: string): RuntimeWeatherCatalog | null {
  const fixedLiteral = normalizeWeatherLiteral(literal);
  const jsonCandidate = toStrictJsonCandidate(fixedLiteral);
  if (!jsonCandidate) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    return null;
  }

  return buildWeather(parsed);
}

export function extractWeatherCatalogFromText(text: string): RuntimeWeatherCatalog | null {
  const anchorRe = new RegExp(WEATHER_BLUEPRINT_MARKER.source, 'g');
  for (const match of text.matchAll(anchorRe)) {
    if (match.index === undefined) continue;
    const literal = extractWeatherObjectNearAnchor(text, match.index);
    if (!literal) continue;
    const catalog = parseWeatherLiteral(literal);
    if (catalog) return catalog;
  }
  return null;
}
