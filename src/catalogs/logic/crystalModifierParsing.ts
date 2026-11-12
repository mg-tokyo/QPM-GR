// Crystal pet modifiers from game bundle text (REL-6 spec F28). Modifier names, crystal types and
// values are all parsed, so a new crystal or modifier flows through without a QPM change.

export interface CrystalModifier {
  crystalType: string;
  active: number;     // value while a crystal of `crystalType` has charge left
  inactive: number;
}

export type CrystalModifierTable = Readonly<Record<string, CrystalModifier>>;

const NAME = '[\\w$]+';
// One split per digit run (see dayCycleParsing.ts NUM): ambiguous number patterns hang the tab.
const NUM = '(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:e[+-]?\\d+)?';
const PAIR = '[A-Za-z_$][\\w$]*:\\1\\.has\\(`[\\w$]+`\\)\\?' + NUM + ':' + NUM;
const PAIR_PARTS = new RegExp('^([A-Za-z_$][\\w$]*):[\\w$]+\\.has\\(`([\\w$]+)`\\)\\?(' + NUM + '):(' + NUM + ')$');

// 1989: `function dt(e){let t=new Set;for(let{crystal:n}of ct(e))n.remainingActiveSeconds>0&&t.add(n.crystalType);
//        return{hungerRateMultiplier:t.has(`Hunger`)?.9:1,xpRateMultiplier:t.has(`XP`)?1.1:1,strengthBonus:t.has(`Strength`)?10:0}}`
export const CRYSTAL_MODIFIER_MARKER = new RegExp(
  'let (' + NAME + ')=new Set;for\\(let\\{crystal:(' + NAME + ')\\}of ' + NAME + '\\(' + NAME + '\\)\\)'
  + '\\2\\.remainingActiveSeconds>0&&\\1\\.add\\(\\2\\.crystalType\\);'
  + 'return\\{(' + PAIR + '(?:,' + PAIR + ')*)\\}',
);

export function parseCrystalModifiers(text: string): Record<string, CrystalModifier> | null {
  const body = CRYSTAL_MODIFIER_MARKER.exec(text)?.[3];
  if (body === undefined) return null;
  const out: Record<string, CrystalModifier> = {};
  for (const pair of body.split(',')) {
    const m = PAIR_PARTS.exec(pair);
    if (!m) return null;
    const [, modifier, crystalType, activeRaw, inactiveRaw] = m;
    const active = Number(activeRaw);
    const inactive = Number(inactiveRaw);
    if (!modifier || !crystalType || Object.prototype.hasOwnProperty.call(out, modifier)) return null;
    if (!Number.isFinite(active) || !Number.isFinite(inactive)) return null;
    out[modifier] = { crystalType, active, inactive };
  }
  return Object.keys(out).length > 0 ? out : null;
}
