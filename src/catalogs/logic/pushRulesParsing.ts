// The game's phone-push rules from bundle text (ALR-8 PD1/PD2). Pure text helpers; cross-chunk
// names (crystal list, building list, shop enum, weather enum) are resolved in pushRulesCatalog.ts.
// Bounded single-class runs only, so every scan stays linear (memory: bundle regexes can hang the tab).

// 2082 villageDirectory: `ft=[`ChilledPotion`,…,...at],pt=new Set(ft);function N(e){return e.some(e=>e!==ve.Spooky)}`
export const PUSH_TOOL_RULE_MARKER =
  /(?<![\w$])([\w$]+)=\[([^\]]{0,600})\],([\w$]+)=new Set\(\1\);function ([\w$]+)\(([\w$]+)\)\{return \5\.some\(([\w$]+)=>([^)]{0,300})\)\}/;

const SHOP_SUBJECT_RE = /subject:`([\w$]+)`,itemType:[\w$]+\.([\w$]+),/g;
const IS_NOTIFIABLE_RE = /isNotifiable:([\w$]+)=>/g;
// `xt=d({subject:c(`QuinoaWeatherActive`),itemId:ge})`; shop variants use `c(e.subject)` and never match.
const LIST_TOPIC_RE = /subject:[\w$]+\(`([\w$]+)`\),itemId:([\w$]+)\}/g;
const IMPORT_RE = /import\{([^}]{0,4000})\}from["']([^"']{1,200})["']/g;
const EXPORT_RE = /export\{([^}]{0,8000})\}/g;
const IDENT = /^[A-Za-z_$][\w$]*$/;
const MAX_DEFINITION_TRIES = 20;

export interface ListRef { literals: string[]; spreads: string[] }
export interface SilentRef { ref: string; member: string }

export interface RawShopTopic {
  subject: string;
  itemType: string;
  usesToolList: boolean;
  usesSilentShops: boolean;
  excludeRef: string | null;
  /** A gate the parser cannot evaluate (another `.has` set); the topic is unreadable. */
  unknownGate: boolean;
}

export interface RawPushRules {
  toolList: ListRef;
  silentShops: Array<SilentRef | string>;
  shopTopics: RawShopTopic[];
  listTopics: Array<{ subject: string; ref: string }>;
}

export type Definition =
  | { kind: 'list'; list: ListRef }
  | { kind: 'enum'; members: Record<string, string> }
  | { kind: 'call'; inner: string };

const escapeName = (name: string): string => name.replace(/\$/g, '\\$');

export function parseListBody(body: string): ListRef | null {
  const literals: string[] = [];
  const spreads: string[] = [];
  for (const raw of body.split(',')) {
    const item = raw.trim();
    const lit = /^`([\w$]+)`$/.exec(item);
    if (lit?.[1]) { literals.push(lit[1]); continue; }
    const spread = /^\.\.\.([\w$]+)$/.exec(item);
    if (spread?.[1]) { spreads.push(spread[1]); continue; }
    return null;
  }
  return literals.length + spreads.length > 0 ? { literals, spreads } : null;
}

function parseSilentBody(param: string, body: string): Array<SilentRef | string> | null {
  const out: Array<SilentRef | string> = [];
  const prefix = `${param}!==`;
  for (const term of body.split('&&')) {
    if (!term.startsWith(prefix)) return null;
    const rest = term.slice(prefix.length);
    const member = /^([\w$]+)\.([\w$]+)$/.exec(rest);
    if (member?.[1] && member[2]) { out.push({ ref: member[1], member: member[2] }); continue; }
    const lit = /^`([\w$]+)`$/.exec(rest);
    if (lit?.[1]) { out.push(lit[1]); continue; }
    return null;
  }
  return out.length > 0 ? out : null;
}

// The isNotifiable body runs to the end of its subject's object literal (the first `}`).
function readGates(body: string, param: string, setVar: string, silentFn: string): Omit<RawShopTopic, 'subject' | 'itemType'> {
  const gates = { usesToolList: false, usesSilentShops: false, excludeRef: null as string | null, unknownGate: false };
  for (const term of body.split('&&')) {
    const has = /^([\w$]+)\.has\(([\w$]+)\)$/.exec(term);
    if (has) {
      if (has[1] === setVar && has[2] === param) gates.usesToolList = true;
      else gates.unknownGate = true;
      continue;
    }
    const exclude = /^!([\w$]+)\.some\(/.exec(term);
    if (exclude?.[1]) { gates.excludeRef = exclude[1]; continue; }
    if (term.startsWith(`${silentFn}(`)) gates.usesSilentShops = true;
  }
  return gates;
}

function parseShopTopics(text: string, setVar: string, silentFn: string): RawShopTopic[] {
  const subjects = Array.from(text.matchAll(SHOP_SUBJECT_RE));
  const gates = Array.from(text.matchAll(IS_NOTIFIABLE_RE));
  const out: RawShopTopic[] = [];
  subjects.forEach((s, i) => {
    const start = s.index ?? 0;
    const end = subjects[i + 1]?.index ?? text.length;
    const gate = gates.find((g) => (g.index ?? 0) > start && (g.index ?? 0) < end);
    if (!s[1] || !s[2] || !gate?.[1]) return;
    const bodyStart = (gate.index ?? 0) + gate[0].length;
    const window = text.slice(bodyStart, Math.min(bodyStart + 400, end));
    const close = window.indexOf('}');
    if (close < 0) return;
    out.push({ subject: s[1], itemType: s[2], ...readGates(window.slice(0, close), gate[1], setVar, silentFn) });
  });
  return out;
}

/** Everything the rules chunk says on its own; null when the tool rule or every shop subject is missing. */
export function parsePushRulesChunk(text: string): RawPushRules | null {
  const rule = PUSH_TOOL_RULE_MARKER.exec(text);
  if (!rule) return null;
  const [, , listBody, setVar, silentFn, , someParam, someBody] = rule;
  if (listBody === undefined || !setVar || !silentFn || !someParam || someBody === undefined) return null;
  const toolList = parseListBody(listBody);
  const silentShops = parseSilentBody(someParam, someBody);
  if (!toolList || !silentShops) return null;
  const shopTopics = parseShopTopics(text, setVar, silentFn);
  if (shopTopics.length === 0) return null;
  const listTopics: RawPushRules['listTopics'] = [];
  for (const m of text.matchAll(LIST_TOPIC_RE)) {
    if (m[1] && m[2]) listTopics.push({ subject: m[1], ref: m[2] });
  }
  return { toolList, silentShops, shopTopics, listTopics };
}

// `M=function(e){return e.Rain=`Rain`,e.Frost=`Frost`,e}({})`
function parseEnumIife(src: string): Record<string, string> | null {
  const m = /^function\(([\w$]+)\)\{return ([^}]{1,3000})\}\(\{\}\)/.exec(src);
  if (!m?.[1] || !m[2]) return null;
  const param = m[1];
  const parts = m[2].split(',');
  if (parts.pop() !== param) return null;
  const members: Record<string, string> = {};
  for (const part of parts) {
    const pair = /^([\w$]+)\.([\w$]+)=`([\w$]+)`$/.exec(part);
    if (!pair?.[2] || !pair[3] || pair[1] !== param) return null;
    members[pair[2]] = pair[3];
  }
  return Object.keys(members).length > 0 ? members : null;
}

function readDefinitionAt(text: string, from: number): Definition | null {
  const src = text.slice(from, from + 3200);
  if (src.startsWith('[')) {
    const close = src.indexOf(']');
    const list = close > 0 ? parseListBody(src.slice(1, close)) : null;
    return list ? { kind: 'list', list } : null;
  }
  if (src.startsWith('function(')) {
    const members = parseEnumIife(src);
    return members ? { kind: 'enum', members } : null;
  }
  const call = /^[\w$]+\(([\w$]+)\)[,;]/.exec(src);
  return call?.[1] ? { kind: 'call', inner: call[1] } : null;
}

/** The first `name=` in the chunk whose right side is a list, an enum IIFE or `fn(ref)`. */
export function findDefinition(text: string, name: string): Definition | null {
  if (!IDENT.test(name)) return null;
  const re = new RegExp(`(?<![\\w$.])${escapeName(name)}=(?!=)`, 'g');
  let tries = 0;
  for (const m of text.matchAll(re)) {
    if (++tries > MAX_DEFINITION_TRIES) break;
    const def = readDefinitionAt(text, (m.index ?? 0) + m[0].length);
    if (def) return def;
  }
  return null;
}

const splitBinding = (entry: string): [string, string] => {
  const parts = entry.trim().split(/\s+as\s+/);
  const left = parts[0] ?? '';
  return [left, parts[1] ?? left];
};

/** `import{Xr as at}from"./inventoryAtoms-k.js"` → `{ exported: 'Xr', from: './inventoryAtoms-k.js' }` for `at`. */
export function findImport(text: string, localName: string): { exported: string; from: string } | null {
  for (const m of text.matchAll(IMPORT_RE)) {
    for (const entry of (m[1] ?? '').split(',')) {
      const [exported, local] = splitBinding(entry);
      if (local === localName && exported && m[2]) return { exported, from: m[2] };
    }
  }
  return null;
}

/** `export{at as Xr}` → `at` for `Xr`. */
export function findExportLocal(text: string, exportedName: string): string | null {
  for (const m of text.matchAll(EXPORT_RE)) {
    for (const entry of (m[1] ?? '').split(',')) {
      const [local, exported] = splitBinding(entry);
      if (exported === exportedName && local) return local;
    }
  }
  return null;
}
