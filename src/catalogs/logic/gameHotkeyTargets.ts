// What each game hotkey acts on (INP-1.6b), read from bundle text so QPM rows can show "Game key: E"
// without a literal key → action map. A target is a string literal in the called function (`petTeams`)
// or `atom:<debugLabel>` for an atom the function names. Only `[key,()=>fn()]` entries count: an entry
// that passes a value (Shift+1 → travel to `seedShop`) does something else than opening that panel.

import { extractBalancedBlock, findAllIndices } from './bundleTextParsing';
import { GAME_HOTKEYS_MARKER, MAX_HOTKEY_MAP_CHARS, gameKeyToCombo, mapBody } from './gameHotkeysParsing';

export const BAG_ATOM_LABEL = 'inventoryModalIsActiveAtom';
export const BAG_ATOM_TARGET = `atom:${BAG_ATOM_LABEL}`;
// The chunk that defines the bag atom (beta modalAtom.ts) also holds the bag toggle the `e` key imports.
export const BAG_ATOM_MARKER = /\.debugLabel=[`'"]inventoryModalIsActiveAtom[`'"]/;

const CALLEE_ENTRY = /\[([`'"])([^`'"\\\s]{1,24})\1,\(\)=>([\w$]{1,8})\(\)\]/g;
const MAX_BODY_CHARS = 3000;
const LITERAL = /[`'"]([A-Za-z][A-Za-z0-9]{1,39})[`'"]/g;
const IDENTIFIER = /(?<![\w$.])[A-Za-z_$][\w$]{0,7}(?![\w$])/g;
const ARROW_OR_FUNCTION = /^(?:\([^)]{0,80}\)=>|[\w$]{1,8}=>|function\s*\([^)]{0,80}\))\{/;
const NAMED_FUNCTION_TAIL = /^\([^)]{0,80}\)\{/;

export interface HotkeyCallees {
  /** Called functions defined in the table's own chunk, with their targets. */
  local: Array<{ combo: string; targets: string[] }>;
  /** Called functions imported from another chunk: `file` is the chunk's file name, `name` its export. */
  imported: Array<{ combo: string; file: string; name: string }>;
}

const isIdentChar = (ch: string | undefined): boolean => ch !== undefined && /[\w$.]/.test(ch);

function boundedBlock(text: string, braceIndex: number): string | null {
  return extractBalancedBlock(text.slice(braceIndex, braceIndex + MAX_BODY_CHARS), 0);
}

/** The body of a top-level `function name(…){…}`, `name=()=>{…}` or `name=function(…){…}`. */
export function functionBody(text: string, name: string): string | null {
  const head = `function ${name}`;
  for (const at of findAllIndices(text, `${head}(`)) {
    if (isIdentChar(text[at - 1])) continue;
    const start = at + head.length;
    const m = NAMED_FUNCTION_TAIL.exec(text.slice(start, start + 100));
    if (m) return boundedBlock(text, start + m[0].length - 1);
  }
  for (const at of findAllIndices(text, `${name}=`)) {
    if (isIdentChar(text[at - 1]) || text[at + name.length + 1] === '=') continue;
    const start = at + name.length + 1;
    const m = ARROW_OR_FUNCTION.exec(text.slice(start, start + 120));
    if (m) return boundedBlock(text, start + m[0].length - 1);
  }
  return null;
}

// One pass for callers that look up many names: a functionBody call per export re-scans the chunk (42 ms on
// the 280 KB beta chunk vs a few ms here).
const DEFINITION = /function ([\w$]{1,8})\([^)]{0,80}\)\{|[,; ]([\w$]{1,8})=(?:\([^)]{0,80}\)=>|[\w$]{1,8}=>|function\s*\([^)]{0,80}\))\{/g;

function definitionIndex(text: string): Map<string, number> {
  const out = new Map<string, number>();
  for (const m of text.matchAll(DEFINITION)) {
    const name = m[1] ?? m[2];
    if (!name || out.has(name) || m.index === undefined) continue;
    if (m[1] && isIdentChar(text[m.index - 1])) continue;
    out.set(name, m.index + m[0].length - 1);
  }
  return out;
}

/** Atom variable → debugLabel for every `X.debugLabel=\`label\`` in the chunk. */
export function atomLabels(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const at of findAllIndices(text, '.debugLabel=')) {
    let start = at;
    while (start > 0 && /[\w$]/.test(text[start - 1] ?? '')) start -= 1;
    const label = /^[`'"]([\w$]{1,80})[`'"]/.exec(text.slice(at + 12, at + 100));
    if (start < at && label?.[1]) out.set(text.slice(start, at), label[1]);
  }
  return out;
}

export function bodyTargets(body: string, labels: ReadonlyMap<string, string>): string[] {
  const targets = new Set<string>();
  for (const m of body.matchAll(LITERAL)) if (m[1]) targets.add(m[1]);
  for (const m of body.matchAll(IDENTIFIER)) {
    const label = labels.get(m[0]);
    if (label) targets.add(`atom:${label}`);
  }
  return [...targets];
}

function fileName(path: string): string {
  return (path.split(/[?#]/)[0] ?? '').split('/').pop() ?? '';
}

/** Local name → { chunk file, exported name } from every `import{…}from"…"` in the chunk. */
function importsOf(text: string, wanted: ReadonlySet<string>): Map<string, { file: string; name: string }> {
  const out = new Map<string, { file: string; name: string }>();
  for (const at of findAllIndices(text, 'import{')) {
    const close = text.indexOf('}', at);
    if (close < 0 || close - at > 8000) continue;
    const from = /^\}from\s*[`'"]([^`'"]{1,200})[`'"]/.exec(text.slice(close, close + 220));
    if (!from?.[1]) continue;
    for (const spec of text.slice(at + 7, close).split(',')) {
      const [name, alias] = spec.trim().split(/\s+as\s+/);
      const local = (alias ?? name)?.trim();
      if (name && local && wanted.has(local)) out.set(local, { file: fileName(from[1]), name: name.trim() });
    }
  }
  return out;
}

export function parseHotkeyCallees(text: string): HotkeyCallees | null {
  const marker = GAME_HOTKEYS_MARKER.exec(text);
  if (!marker) return null;
  const table = mapBody(text, marker.index, MAX_HOTKEY_MAP_CHARS);
  if (!table) return null;
  const entries: Array<{ combo: string; callee: string }> = [];
  for (const m of table.matchAll(CALLEE_ENTRY)) {
    const combo = m[2] ? gameKeyToCombo(m[2]) : null;
    if (combo && m[3]) entries.push({ combo, callee: m[3] });
  }
  const labels = atomLabels(text);
  const imports = importsOf(text, new Set(entries.map(e => e.callee)));
  const result: HotkeyCallees = { local: [], imported: [] };
  for (const { combo, callee } of entries) {
    const body = functionBody(text, callee);
    if (body) {
      const targets = bodyTargets(body, labels);
      if (targets.length) result.local.push({ combo, targets });
      continue;
    }
    const imported = imports.get(callee);
    if (imported) result.imported.push({ combo, ...imported });
  }
  return result;
}

/** Exported name → targets for each export whose function names the bag atom; null without one. */
export function parseBagExports(text: string): Map<string, string[]> | null {
  const labels = atomLabels(text);
  if (![...labels.values()].includes(BAG_ATOM_LABEL)) return null;
  const open = text.lastIndexOf('export{');
  const close = open < 0 ? -1 : text.indexOf('}', open);
  if (close < 0) return null;
  const defs = definitionIndex(text);
  const out = new Map<string, string[]>();
  for (const spec of text.slice(open + 7, close).split(',')) {
    const [local, exported] = spec.trim().split(/\s+as\s+/);
    const name = (exported ?? local)?.trim();
    const brace = local ? defs.get(local.trim()) : undefined;
    if (!name || brace === undefined) continue;
    const body = boundedBlock(text, brace);
    if (!body) continue;
    const targets = bodyTargets(body, labels);
    if (targets.includes(BAG_ATOM_TARGET)) out.set(name, targets);
  }
  return out.size ? out : null;
}

/** Target → the game combos that act on it. */
export function resolveHotkeyTargets(
  callees: HotkeyCallees,
  bagChunk: { file: string; exports: ReadonlyMap<string, string[]> } | null,
): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (target: string, combo: string): void => {
    const list = out.get(target) ?? [];
    if (!list.includes(combo)) list.push(combo);
    out.set(target, list);
  };
  for (const { combo, targets } of callees.local) for (const target of targets) add(target, combo);
  if (bagChunk) {
    const file = fileName(bagChunk.file);
    for (const { combo, file: from, name } of callees.imported) {
      if (from !== file) continue;
      for (const target of bagChunk.exports.get(name) ?? []) add(target, combo);
    }
  }
  return out;
}
