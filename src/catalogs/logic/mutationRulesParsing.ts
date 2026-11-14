// Mutation combination rules from game bundle text (ALR-5 spec F1–F2). The game's
// `updateMutationList` switch ships minified; names change per build, so every name is `[\w$]+`
// and the parse reads the case bodies as data, never runs them.

export interface MutationRule {
  /** Same-group mutations already on the crop that do not block this one. */
  mayReplace: string[];
  /** Dropped from the crop when this one applies. */
  removes: string[];
  /** Every mutation of this group is dropped when this one applies. */
  clearsGroup: string | null;
  /** The id that lands on the crop (itself, unless `combine` fires). */
  adds: string;
  /** With `with` already on the crop, both make way for `into`. */
  combine: { with: string; into: string } | null;
}

export interface ParsedMutationRules {
  rules: Record<string, MutationRule>;
  /** Case labels whose body did not match a known shape. */
  unparsed: string[];
}

const NAME = '[\\w$]+';
const Q = '[`\'"]';
const ID = '[A-Za-z_$][\\w$]*';
const esc = (s: string): string => s.replace(/[$]/g, '\\$');

// live 2022 / beta pr-4669: `function qa(e,t,n){let r=W[t].group;return e.some(e=>W[e].group===r&&n?.includes(e)!==!0)}
// function Ja(e,t){if(t.includes(e))return;let n=[...t];switch(e){`
// Every quantifier is a name run between fixed punctuation, so each match has one split.
export const MUTATION_RULES_MARKER = new RegExp(
  `function (${NAME})\\((${NAME}),(${NAME}),(${NAME})\\)\\{let (${NAME})=(${NAME})\\[\\3\\]\\.group;`
  + `return \\2\\.some\\((${NAME})=>\\6\\[\\7\\]\\.group===\\5&&\\4\\?\\.includes\\(\\7\\)!==!0\\)\\}`
  + `function ${NAME}\\((${NAME}),(${NAME})\\)\\{if\\(\\9\\.includes\\(\\8\\)\\)return;let (${NAME})=\\[\\.\\.\\.\\9\\];switch\\(\\8\\)\\{`,
);

const MAX_SWITCH_CHARS = 8000;
const CASE_LABEL = new RegExp(`case${Q}(${ID})${Q}:`, 'g');

interface Names { helper: string; dex: string; add: string; existing: string; copy: string }

interface Shapes {
  local: RegExp; guard: RegExp; ternary: RegExp; cond: RegExp;
  filterId: RegExp; filterGroup: RegExp; push: RegExp; sep: RegExp; end: RegExp;
}

type Step =
  | { kind: 'push'; arg: string }
  | { kind: 'remove'; arg: string }
  | { kind: 'clear'; group: string }
  | { kind: 'combine'; with: string; into: string; otherwise: string };

function shapes(n: Names): Shapes {
  const add = esc(n.add);
  const existing = esc(n.existing);
  const copy = esc(n.copy);
  const arg = `(${Q}${ID}${Q}|${NAME})`;
  const filterId = (ref: string): string => `${copy}=${copy}\\.filter\\((${NAME})=>\\${ref}!==${arg}\\)`;
  return {
    local: new RegExp(`let (${NAME})=${add}===${Q}(${ID})${Q}\\?${Q}(${ID})${Q}:${Q}(${ID})${Q};`, 'y'),
    guard: new RegExp(`if\\(${esc(n.helper)}\\(${existing},${add}(?:,\\[([^\\]]*)\\])?\\)\\)return;`, 'y'),
    ternary: new RegExp(`${existing}\\.includes\\(${arg}\\)\\?\\(${filterId('2')},${copy}\\.push\\(${arg}\\)\\):${copy}\\.push\\(${arg}\\)`, 'y'),
    cond: new RegExp(`${existing}\\.includes\\(${arg}\\)&&\\(${filterId('2')}\\)`, 'y'),
    filterId: new RegExp(filterId('1'), 'y'),
    filterGroup: new RegExp(`${copy}=${copy}\\.filter\\((${NAME})=>${esc(n.dex)}\\[\\1\\]\\.group!==${Q}(${ID})${Q}\\)`, 'y'),
    push: new RegExp(`${copy}\\.push\\(${arg}\\)`, 'y'),
    sep: /[,;]/y,
    end: /break;?$/y,
  };
}

function at(re: RegExp, text: string, pos: number): RegExpExecArray | null {
  re.lastIndex = pos;
  return re.exec(text);
}

/** The action statements after the guard, or null at the first unknown statement. */
function readSteps(text: string, from: number, s: Shapes): Step[] | null {
  const steps: Step[] = [];
  let pos = from;
  while (pos < text.length) {
    if (at(s.end, text, pos)) return steps;
    let m: RegExpExecArray | null;
    if ((m = at(s.ternary, text, pos))) {
      if (m[1] !== m[3]) return null;
      steps.push({ kind: 'combine', with: m[1] ?? '', into: m[4] ?? '', otherwise: m[5] ?? '' });
      pos = s.ternary.lastIndex;
    } else if ((m = at(s.cond, text, pos))) {
      if (m[1] !== m[3]) return null;
      steps.push({ kind: 'remove', arg: m[1] ?? '' });
      pos = s.cond.lastIndex;
    } else if ((m = at(s.filterGroup, text, pos))) {
      steps.push({ kind: 'clear', group: m[2] ?? '' });
      pos = s.filterGroup.lastIndex;
    } else if ((m = at(s.filterId, text, pos))) {
      steps.push({ kind: 'remove', arg: m[2] ?? '' });
      pos = s.filterId.lastIndex;
    } else if ((m = at(s.push, text, pos))) {
      steps.push({ kind: 'push', arg: m[1] ?? '' });
      pos = s.push.lastIndex;
    } else {
      return null;
    }
    if (at(s.sep, text, pos)) pos = s.sep.lastIndex;
  }
  return null;
}

/** One case body (after its labels) → a rule per label, or null for an unknown shape. */
function parseCaseBody(body: string, labels: string[], names: Names, s: Shapes): Record<string, MutationRule> | null {
  const braced = body.startsWith('{');
  if (braced !== body.endsWith('}')) return null;
  const text = braced ? body.slice(1, -1) : body;
  let pos = 0;
  let local: { name: string; when: string; then: string; otherwise: string } | null = null;
  const lm = at(s.local, text, pos);
  if (lm) {
    local = { name: lm[1] ?? '', when: lm[2] ?? '', then: lm[3] ?? '', otherwise: lm[4] ?? '' };
    pos = s.local.lastIndex;
  }
  const gm = at(s.guard, text, pos);
  if (!gm) return null;
  const steps = readSteps(text, s.guard.lastIndex, s);
  if (!steps) return null;
  const replaceRaw = gm[1] === undefined || gm[1] === '' ? [] : gm[1].split(',');

  const resolve = (raw: string, label: string): string | null => {
    if (/^[`'"]/.test(raw)) return raw.slice(1, -1);
    if (local && raw === local.name) return label === local.when ? local.then : local.otherwise;
    if (raw === names.add) return label;
    return null;
  };

  const out: Record<string, MutationRule> = {};
  for (const label of labels) {
    const mayReplace: string[] = [];
    for (const raw of replaceRaw) {
      const id = resolve(raw, label);
      if (id === null) return null;
      mayReplace.push(id);
    }
    const rule: MutationRule = { mayReplace, removes: [], clearsGroup: null, adds: '', combine: null };
    for (const step of steps) {
      if (step.kind === 'clear') { rule.clearsGroup = step.group; continue; }
      if (step.kind === 'combine') {
        const withId = resolve(step.with, label);
        const into = resolve(step.into, label);
        const otherwise = resolve(step.otherwise, label);
        if (withId === null || into === null || otherwise === null || rule.adds !== '') return null;
        rule.combine = { with: withId, into };
        rule.adds = otherwise;
        continue;
      }
      const id = resolve(step.arg, label);
      if (id === null) return null;
      if (step.kind === 'remove') rule.removes.push(id);
      else if (rule.adds === '') rule.adds = id;
      else return null;
    }
    if (rule.adds === '') return null;
    out[label] = rule;
  }
  return out;
}

export function parseMutationRules(text: string): ParsedMutationRules | null {
  const match = MUTATION_RULES_MARKER.exec(text);
  if (!match) return null;
  const names: Names = {
    helper: match[1] ?? '', dex: match[6] ?? '', add: match[8] ?? '', existing: match[9] ?? '', copy: match[10] ?? '',
  };
  const start = match.index + match[0].length;
  const window = text.slice(start, start + MAX_SWITCH_CHARS);
  const end = window.indexOf('default:');
  if (end < 0) return null;
  const body = window.slice(0, end);
  const s = shapes(names);

  const labels: Array<{ id: string; from: number; to: number }> = [];
  CASE_LABEL.lastIndex = 0;
  for (let m = CASE_LABEL.exec(body); m; m = CASE_LABEL.exec(body)) {
    labels.push({ id: m[1] ?? '', from: m.index, to: m.index + m[0].length });
  }
  if (labels[0]?.from !== 0) return null;

  const rules: Record<string, MutationRule> = {};
  const unparsed: string[] = [];
  let group: string[] = [];
  for (let i = 0; i < labels.length; i += 1) {
    const label = labels[i];
    if (!label) continue;
    group.push(label.id);
    const next = labels[i + 1];
    const segment = body.slice(label.to, next ? next.from : body.length);
    if (segment === '') continue;   // stacked label: shares the next body
    const parsed = parseCaseBody(segment, group, names, s);
    if (parsed) Object.assign(rules, parsed);
    else unparsed.push(...group);
    group = [];
  }
  unparsed.push(...group);
  return Object.keys(rules).length > 0 ? { rules, unparsed } : null;
}
