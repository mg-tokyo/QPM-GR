// Day-cycle data from game bundle text (REL-6 spec F13/F21). Minified names change
// per build, so every name is `[\w$]+`; stage keys are generic so a new stage flows through.

export interface DayCycleStage {
  id: string;
  minutes: number;
}

export interface StageKeyMismatch {
  missingInBonus: string[];
  extraInBonus: string[];
}

const NAME = '[\\w$]+';
// IMPORTANT: every digit run must have exactly one split. `\d+\.?\d*` let `210` split three ways and
// hung the game tab on 1989 chunks with long numeric object literals (catastrophic backtracking).
const NUM = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const PAIR = `[A-Za-z_$][\\w$]*:${NUM}`;
const STAGE_OBJECT = `\\{((?:${PAIR},)*day:${NUM}(?:,${PAIR})*)\\}`;

// 1989: `var Ae={day:210,sunset:10,midnight:10,sunrise:10},je=Object.values(Ae).reduce(`
export const DAY_CYCLE_MARKER = new RegExp(`(?<![\\w$])(${NAME})=${STAGE_OBJECT},${NAME}=Object\\.values\\(\\1\\)\\.reduce\\(`);
// 1989: `var F={day:0,sunset:15,midnight:20,sunrise:10};F.midnight;function I(e){return M[e].isNocturnal===!0}`
export const NOCTURNAL_BONUS_MARKER = new RegExp(`(?<![\\w$])${NAME}=${STAGE_OBJECT}(?:(?!=\\{)[\\s\\S]){0,160}?isNocturnal===!0`);
// 1989: `var ct=.99;function lt(e){return Number.isNaN(e)?0:Math.min(1,Math.max(0,e))}function ut(e){return Math.min(ct,lt(e))}`
export const CHANCE_CAP_MARKER = new RegExp(
  `(?<![\\w$])(${NAME})=(${NUM});function (${NAME})\\((${NAME})\\)\\{return Number\\.isNaN\\(\\4\\)\\?0:Math\\.min\\(1,Math\\.max\\(0,\\4\\)\\)\\}`
  + `function ${NAME}\\((${NAME})\\)\\{return Math\\.min\\(\\1,\\3\\(\\5\\)\\)\\}`,
);

function parseStageBody(body: string): Array<[string, number]> | null {
  const out: Array<[string, number]> = [];
  const seen = new Set<string>();
  for (const pair of body.split(',')) {
    const sep = pair.indexOf(':');
    const id = pair.slice(0, sep);
    const value = Number(pair.slice(sep + 1));
    if (sep <= 0 || seen.has(id) || !Number.isFinite(value) || value < 0) return null;
    seen.add(id);
    out.push([id, value]);
  }
  return out.length > 0 ? out : null;
}

export function parseDayCycleStages(text: string): DayCycleStage[] | null {
  const body = DAY_CYCLE_MARKER.exec(text)?.[2];
  if (body === undefined) return null;
  const pairs = parseStageBody(body);
  if (!pairs || !pairs.some(([, minutes]) => minutes > 0)) return null;
  return pairs.map(([id, minutes]) => ({ id, minutes }));
}

export function parseNocturnalBonus(text: string): Record<string, number> | null {
  const body = NOCTURNAL_BONUS_MARKER.exec(text)?.[1];
  if (body === undefined) return null;
  const pairs = parseStageBody(body);
  return pairs ? Object.fromEntries(pairs) : null;
}

export function parseChanceCap(text: string): number | null {
  const raw = CHANCE_CAP_MARKER.exec(text)?.[2];
  if (raw === undefined) return null;
  const cap = Number(raw);
  return Number.isFinite(cap) && cap > 0 && cap <= 1 ? cap : null;
}

export function compareStageKeys(stages: readonly DayCycleStage[], bonus: Readonly<Record<string, number>>): StageKeyMismatch {
  const stageIds = new Set(stages.map((s) => s.id));
  return {
    missingInBonus: [...stageIds].filter((id) => !Object.prototype.hasOwnProperty.call(bonus, id)),
    extraInBonus: Object.keys(bonus).filter((id) => !stageIds.has(id)),
  };
}
