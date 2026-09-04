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

// String-aware scan, not a regex: an apostrophe INSIDE an already-converted
// double-quoted string (`"Burro's Tail Cutting"`) must not open a single-quoted
// string, or everything up to the next apostrophe gets mangled.
function convertSingleQuotedStrings(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '"') {
      out += ch;
      i += 1;
      let escaped = false;
      while (i < source.length) {
        const c = source[i];
        out += c;
        i += 1;
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '"') break;
      }
      continue;
    }
    if (ch === '\'') {
      let j = i + 1;
      let escaped = false;
      let inner = '';
      let closed = false;
      while (j < source.length) {
        const c = source[j]!;
        j += 1;
        if (escaped) {
          inner += (c === '\'' || c === '"') ? c : `\\${c}`;
          escaped = false;
          continue;
        }
        if (c === '\\') { escaped = true; continue; }
        if (c === '\'') { closed = true; break; }
        inner += c;
      }
      if (closed) {
        out += JSON.stringify(inner);
        i = j;
        continue;
      }
      out += ch;
      i += 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
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

/**
 * Dex-literal variant: enum refs quote to their LAST segment (`P.Common` ->
 * "Common", `V.Single` -> "Single"), and array elements are covered too
 * (`eligibleShops:[F.Seed]` -> ["Seed"]) — the abilities/weather pipeline
 * never needed array positions, dex literals do.
 */
function quoteMemberExpressionsLastSegment(source: string): string {
  const lastSegment = (path: string): string => {
    const idx = path.lastIndexOf('.');
    return idx === -1 ? path : path.slice(idx + 1);
  };
  return source
    .replace(
      /(:\s*)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)(?=\s*[,}\]])/g,
      (_m, prefix: string, path: string) => `${prefix}"${lastSegment(path)}"`,
    )
    .replace(
      /([,[]\s*)([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)(?=\s*[,\]])/g,
      (_m, prefix: string, path: string) => `${prefix}"${lastSegment(path)}"`,
    );
}

/**
 * Substitute bare identifier VALUES (hoisted consts like `var L=40` used as
 * `speciesPityThresholdPulls:{Bee:L}`) via the caller's resolver; unresolved
 * identifiers become null so one const can't sink the whole literal.
 */
function resolveBareIdentifierValues(source: string, resolve: (name: string) => string | null): string {
  return source.replace(
    /(:\s*)([A-Za-z_$][\w$]*)(?=\s*[,}\]])/g,
    (match, prefix: string, name: string) => {
      if (name === 'true' || name === 'false' || name === 'null') return match;
      const resolved = resolve(name);
      return `${prefix}${resolved ?? 'null'}`;
    },
  );
}

/** `.01` → `0.01` / `-.5` → `-0.5` — JSON requires a leading digit. */
export function fixLeadingDotNumbers(literal: string): string {
  return literal.replace(/([:,[]\s*-?)\.(\d)/g, '$10.$2');
}

/** JSON keys must be strings — dex literals carry numeric keys
 * (`rotationVariants:{90:{...}}`). */
function quoteNumericKeys(source: string): string {
  return source.replace(/([,{]\s*)(\d+)(\s*:)/g, '$1"$2"$3');
}

/** End index (exclusive) of an expression starting at `from`: the first `,` or
 * closing `}`/`]` at bracket depth 0, string-aware. -1 when unterminated. */
function scanExpressionEnd(source: string, from: number): number {
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === '\'' || ch === '`') { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (depth === 0) return i;
      depth -= 1;
    } else if (ch === ',' && depth === 0) return i;
  }
  return -1;
}

/**
 * Remove arrow-function properties (`getCanSpawnInGuild:e=>{...}` and the
 * expression-body form `e=>e.endsWith("1")`) so one behavioral prop doesn't
 * fail the whole data literal at the unsafe-token gate. Data is never
 * executed; the prop is simply dropped.
 */
function stripArrowFunctionProps(source: string): string {
  const re = /([,{]\s*)[A-Za-z_$][\w$]*\s*:\s*(?:\([^()]*\)|[A-Za-z_$][\w$]*)\s*=>\s*/;
  let out = source;
  for (let guard = 0; guard < 200; guard += 1) {
    const m = re.exec(out);
    if (!m || m.index === undefined) return out;
    const bodyStart = m.index + m[0].length;
    let bodyEnd: number;
    if (out[bodyStart] === '{') {
      const block = extractBalancedBlock(out, bodyStart);
      if (!block) return out;
      bodyEnd = bodyStart + block.length;
    } else {
      bodyEnd = scanExpressionEnd(out, bodyStart);
      if (bodyEnd === -1) return out;
    }
    const lead = m[1] ?? '';
    let removeStart = m.index;
    let removeEnd = bodyEnd;
    if (!lead.startsWith(',')) {
      // `{key:fn=>...,` — keep the '{', drop a trailing comma instead.
      removeStart += lead.length;
      while (out[removeEnd] === ' ') removeEnd += 1;
      if (out[removeEnd] === ',') removeEnd += 1;
    }
    out = out.slice(0, removeStart) + out.slice(removeEnd);
  }
  return out;
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

// Numeric arithmetic in value position (`DawnCapture:1/0` Infinity idiom,
// `flipChance:1/3`, `secondsToMature:1440*60`) — computed; 1e999 overflows to
// Infinity in JSON.parse. Looped so chains like `2*60*60` reduce fully.
function foldNumericArithmetic(source: string): string {
  const binaryRe = /([:,[]\s*)(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)\s*([*/])\s*(\d+(?:\.\d+)?(?:e[+-]?\d+)?)(?=\s*[,}\]*/])/g;
  let out = source;
  for (let guard = 0; guard < 5; guard += 1) {
    const next = out.replace(binaryRe, (_m, prefix: string, a: string, op: string, b: string) => {
      const q = op === '/' ? Number(a) / Number(b) : Number(a) * Number(b);
      if (q === Infinity) return `${prefix}1e999`;
      if (q === -Infinity) return `${prefix}-1e999`;
      return Number.isFinite(q) ? `${prefix}${q}` : `${prefix}null`;
    });
    if (next === out) return out;
    out = next;
  }
  return out;
}

function hasUnsafeToken(source: string): boolean {
  // Reject executable constructs to keep parser non-executing. Runs AFTER
  // convertBacktickStrings, so a surviving backtick means an unconverted
  // template literal (interpolation) — reject those too.
  return /(?:=>|\bfunction\b|\bnew\b|\bthis\b|\bwindow\b|\bdocument\b|\bglobalThis\b|;|`|\(|\))/i.test(source);
}

export interface JsonCandidateOptions {
  /** 'path' (default, abilities/weather behavior) keeps the dotted path with the
   * sprite/ui mapping; 'lastSegment' quotes enum refs to their final segment and
   * also covers array element positions. */
  memberExprMode?: 'path' | 'lastSegment';
  /** Resolver for bare identifier values (hoisted consts). Return a JSON token
   * or null; unresolved values become null. Absent = current strict behavior. */
  resolveIdentifier?: (name: string) => string | null;
  /** Quote numeric object keys (`{90:` → `{"90":`). */
  quoteNumericKeys?: boolean;
  /** Drop brace-bodied arrow-function properties before the unsafe-token gate. */
  stripFunctionProps?: boolean;
}

export function toStrictJsonCandidate(literal: string, options?: JsonCandidateOptions): string | null {
  const withoutComments = removeComments(literal).trim();
  if (!withoutComments.startsWith('{') || !withoutComments.endsWith('}')) return null;

  let noBackticks = convertBacktickStrings(withoutComments);
  if (options?.stripFunctionProps) noBackticks = stripArrowFunctionProps(noBackticks);
  if (hasUnsafeToken(noBackticks)) return null;

  let quoted = options?.memberExprMode === 'lastSegment'
    ? quoteMemberExpressionsLastSegment(quoteUnquotedKeys(convertSingleQuotedStrings(noBackticks)))
    : quoteMemberExpressionValues(quoteUnquotedKeys(convertSingleQuotedStrings(noBackticks)));
  if (options?.quoteNumericKeys) quoted = quoteNumericKeys(quoted);
  let normalized = normalizeJsLiterals(quoted);
  if (options?.memberExprMode === 'lastSegment') normalized = foldNumericArithmetic(normalized);
  return options?.resolveIdentifier
    ? resolveBareIdentifierValues(normalized, options.resolveIdentifier)
    : normalized;
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

// ── Pet-ability blueprint pipeline ─────────────────────────────────────────
// Definition site only: consumers write `ws.CoinFinderI` / `case\`CoinFinderI\``,
// never `CoinFinderI:{name:`. Verified against v1040 and live 2026-09-01.
export const PET_ABILITIES_BLUEPRINT_MARKER = /CoinFinderI:\s*\{\s*name:/;

const WEATHER_ENUM_RE = /\b[A-Za-z_$][\w$]*\.(Rain|Frost|Dawn|AmberMoon|Thunderstorm)\b/g;

function normalizePetAbilitiesLiteral(literal: string): string {
  return literal
    .replace(WEATHER_ENUM_RE, '"$1"')
    // `.01` → `0.01` (JSON requires a leading digit)
    .replace(/([:,\[]\s*-?)\.(\d)/g, '$10.$2');
}

function isPetAbilityEntry(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object'
    && typeof (value as Record<string, unknown>).trigger === 'string'
    && typeof (value as Record<string, unknown>).baseParameters === 'object';
}

export function extractPetAbilitiesCatalogFromText(text: string): Record<string, Record<string, unknown>> | null {
  const anchorRe = new RegExp(PET_ABILITIES_BLUEPRINT_MARKER.source, 'g');
  for (const match of text.matchAll(anchorRe)) {
    if (match.index === undefined) continue;
    const literal = extractBalancedObjectLiteral(text, match.index);
    if (!literal) continue;
    const jsonCandidate = toStrictJsonCandidate(normalizePetAbilitiesLiteral(literal));
    if (!jsonCandidate) continue;
    let parsed: unknown;
    try { parsed = JSON.parse(jsonCandidate); } catch { continue; }
    if (!parsed || typeof parsed !== 'object') continue;
    const entries = Object.entries(parsed as Record<string, unknown>).filter(([, v]) => isPetAbilityEntry(v));
    // Sanity floor: the smallest scraped catalog (v1040) has 78 entries.
    if (entries.length < 40) continue;
    return Object.fromEntries(entries) as Record<string, Record<string, unknown>>;
  }
  return null;
}
