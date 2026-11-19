// Charged-ability rules from game bundle text (REL-8 D1, D2). Capture abilities live in one table,
// `CAPTURE_ABILITIES` (beta common/games/Quinoa/utils/chargedAbilityProjections.ts:53-62); live 2065
// ships it as ``var ro={AmberCapture:{capsuleToolId:`AmberCapsule`,capsulesByMutation:{Ambershine:1,…}},…}``.
// Chargers sit outside the table: the target filter dispatches ``if(e===`Thundercharger`)return po(t);let n=ao(e)``
// ahead of the table lookup ``function ao(e){return ro[e].capsulesByMutation}``, and
// ``function po(e){return e.includes(`Thunderstruck`)?no(`Thundercharged`,e)…`` names target and replacement.
// Every anchor is a code token or a name read from the text; no ability or mutation id is written here.

export interface CaptureRule {
  abilityId: string;
  capsuleToolId: string;
  capsulesByMutation: Readonly<Record<string, number>>;
}

export interface ChargerRule {
  abilityId: string;
  target: string;
  replacement: string;
}

export interface ChargedAbilityRules {
  captures: CaptureRule[];
  chargers: ChargerRule[];
  /** False when the dispatch ahead of the table lookup was not found: chargers are unknown, not absent. */
  chargerDispatchFound: boolean;
  /** Charger ids named by the dispatch whose rule function had another shape. */
  unparsedChargers: string[];
}

export const CHARGED_ABILITY_RULES_MARKER = 'capsulesByMutation:';

const ID = '([A-Za-z_$][\\w$]*)';
const QID = '[`\'"]([A-Za-z_$][\\w$]*)[`\'"]';
const MAX_ENTRIES = 32;
const MAX_MUTATIONS = 32;
const MAX_CHARGERS = 16;
const TABLE_LOOKBACK = 512;

const esc = (name: string): string => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

interface Cursor {
  pos: number;
  /** Matches `source` exactly at `pos` (sticky) and advances past it on success. */
  eat(source: string): RegExpExecArray | null;
}

function cursorAt(text: string, pos: number): Cursor {
  const cur: Cursor = {
    pos,
    eat(source) {
      const re = new RegExp(source, 'y');
      re.lastIndex = cur.pos;
      const m = re.exec(text);
      if (m) cur.pos = re.lastIndex;
      return m;
    },
  };
  return cur;
}

function parseMutationCounts(cur: Cursor): Record<string, number> | null {
  if (!cur.eat('\\s*capsulesByMutation\\s*:\\s*\\{')) return null;
  const counts: Record<string, number> = {};
  for (let i = 0; i < MAX_MUTATIONS; i += 1) {
    if (cur.eat('\\s*\\}')) return Object.keys(counts).length > 0 ? counts : null;
    const m = cur.eat(`\\s*${ID}\\s*:\\s*(\\d{1,4})\\s*(?:,|(?=\\}))`);
    const name = m?.[1];
    const count = m?.[2] ? Number(m[2]) : NaN;
    if (!name || !(count > 0) || name in counts) return null;
    counts[name] = count;
  }
  return null;
}

function parseCaptureEntry(cur: Cursor, abilityId: string): CaptureRule | null {
  let capsuleToolId: string | null = null;
  let capsulesByMutation: Record<string, number> | null = null;
  for (let field = 0; field < 2; field += 1) {
    if (field > 0 && !cur.eat('\\s*,')) return null;
    const tool: RegExpExecArray | null = capsuleToolId === null ? cur.eat(`\\s*capsuleToolId\\s*:\\s*${QID}`) : null;
    if (tool?.[1]) { capsuleToolId = tool[1]; continue; }
    if (capsulesByMutation !== null) return null;
    capsulesByMutation = parseMutationCounts(cur);
    if (!capsulesByMutation) return null;
  }
  cur.eat('\\s*,(?=\\s*\\})');
  if (!cur.eat('\\s*\\}') || !capsuleToolId || !capsulesByMutation) return null;
  return { abilityId, capsuleToolId, capsulesByMutation };
}

/** The capture table and its variable name, or null when any entry has another shape. */
function parseCaptureTable(text: string, markerIndex: number): { name: string; captures: CaptureRule[] } | null {
  // The table opens at the last `NAME={` before the first `capsulesByMutation:`; entries open with `ID:{`.
  const head = /([A-Za-z_$][\w$]*)\s*=\s*\{/g;
  head.lastIndex = Math.max(0, markerIndex - TABLE_LOOKBACK);
  let open: RegExpExecArray | null = null;
  for (let m = head.exec(text); m && m.index < markerIndex; m = head.exec(text)) open = m;
  const name = open?.[1];
  if (!open || !name) return null;
  const cur = cursorAt(text, open.index + open[0].length);
  const captures: CaptureRule[] = [];
  let closed = false;
  for (let i = 0; i < MAX_ENTRIES && !closed; i += 1) {
    if (i > 0 && !cur.eat('\\s*,')) return null;
    const entry = cur.eat(`\\s*${ID}\\s*:\\s*\\{`);
    const abilityId = entry?.[1];
    if (!abilityId || captures.some((c) => c.abilityId === abilityId)) return null;
    const rule = parseCaptureEntry(cur, abilityId);
    if (!rule) return null;
    captures.push(rule);
    closed = cur.eat('\\s*,?\\s*\\}') !== null;
  }
  return closed && cur.pos > markerIndex ? { name, captures } : null;
}

/**
 * `{id, rule fn}` pairs from the function that dispatches chargers ahead of the table lookup.
 * [] when that function matched with no charger branch; null when no call site had the shape.
 */
function findChargerDispatch(text: string, tableName: string): Array<{ abilityId: string; fn: string }> | null {
  const lookup = new RegExp(`function\\s+${ID}\\s*\\(\\s*${ID}\\s*\\)\\s*\\{\\s*return\\s+${esc(tableName)}\\[\\2\\]\\.capsulesByMutation\\s*;?\\s*\\}`).exec(text);
  const lookupName = lookup?.[1];
  if (!lookupName) return null;
  const call = new RegExp(`=\\s*${esc(lookupName)}\\(`, 'g');
  let bareMatch = false;
  for (let site = call.exec(text); site; site = call.exec(text)) {
    const start = text.lastIndexOf('function', site.index);
    if (start < 0) continue;
    const cur = cursorAt(text, start);
    const sig = cur.eat(`function\\s+[\\w$]+\\s*\\(\\s*${ID}\\s*,\\s*${ID}\\s*\\)\\s*\\{`);
    const idParam = sig?.[1];
    const listParam = sig?.[2];
    if (!idParam || !listParam) continue;
    const pairs: Array<{ abilityId: string; fn: string }> = [];
    for (let i = 0; i < MAX_CHARGERS; i += 1) {
      const branch = cur.eat(`\\s*if\\s*\\(\\s*${esc(idParam)}\\s*===\\s*${QID}\\s*\\)\\s*return\\s+${ID}\\(\\s*${esc(listParam)}\\s*\\)\\s*;`);
      if (!branch?.[1] || !branch[2]) break;
      pairs.push({ abilityId: branch[1], fn: branch[2] });
    }
    if (!cur.eat(`\\s*(?:let|const|var)\\s+[\\w$]+\\s*=\\s*${esc(lookupName)}\\(\\s*${esc(idParam)}\\s*\\)`)) continue;
    // Another two-argument caller with no branch (e.g. the payout) must not hide the real dispatch.
    if (pairs.length > 0) return pairs;
    bareMatch = true;
  }
  return bareMatch ? [] : null;
}

/** `{target, replacement}` from the first ``function FN(e){return e.includes(`T`)?G(`R`,e)`` in the text. */
function parseChargerRule(text: string, fn: string): { target: string; replacement: string } | null {
  const m = new RegExp(`function\\s+${esc(fn)}\\s*\\(\\s*${ID}\\s*\\)\\s*\\{\\s*return\\s+\\1\\.includes\\(\\s*${QID}\\s*\\)\\s*\\?\\s*[\\w$]+\\(\\s*${QID}\\s*,\\s*\\1\\s*\\)`).exec(text);
  return m?.[2] && m[3] ? { target: m[2], replacement: m[3] } : null;
}

/** Capture table required (null without it); chargers parsed one by one, a shape miss drops only that charger. */
export function parseChargedAbilityRules(text: string): ChargedAbilityRules | null {
  const markerIndex = text.indexOf(CHARGED_ABILITY_RULES_MARKER);
  if (markerIndex < 0) return null;
  const table = parseCaptureTable(text, markerIndex);
  if (!table) return null;
  const dispatch = findChargerDispatch(text, table.name);
  const chargers: ChargerRule[] = [];
  const unparsedChargers: string[] = [];
  for (const { abilityId, fn } of dispatch ?? []) {
    const rule = parseChargerRule(text, fn);
    if (rule) chargers.push({ abilityId, ...rule });
    else unparsedChargers.push(abilityId);
  }
  return { captures: table.captures, chargers, chargerDispatchFound: dispatch !== null, unparsedChargers };
}
