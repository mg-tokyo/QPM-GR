import { describe, expect, it } from 'vitest';
import { MUTATION_RULES_MARKER, parseMutationRules } from './mutationRulesParsing';

// Exact excerpt of beta pr-4669 `inventoryAtoms-DkbetI5Q.js`. Live build 2022 `inventoryAtoms-CaOrtw-I.js`
// differs only in the two function names; LIVE below was checked byte-equal to it on 2026-11-13.
const BETA = 'function no(e,t,n){let r=W[t].group;return e.some(e=>W[e].group===r&&n?.includes(e)!==!0)}function ro(e,t){if(t.includes(e))return;let n=[...t];switch(e){case`Rainbow`:case`Gold`:if(no(t,e))return;n.push(e);break;case`Wet`:case`Chilled`:{let r=e===`Wet`?`Chilled`:`Wet`;if(no(t,e,[r]))return;t.includes(r)?(n=n.filter(e=>e!==r),n.push(`Frozen`)):n.push(e);break}case`Frozen`:if(no(t,e,[`Wet`,`Chilled`]))return;n=n.filter(e=>W[e].group!==`Hydro`),n.push(`Frozen`);break;case`Thunderstruck`:if(no(t,e))return;n.push(`Thunderstruck`);break;case`Thundercharged`:if(no(t,e,[`Thunderstruck`]))return;t.includes(`Thunderstruck`)&&(n=n.filter(e=>e!==`Thunderstruck`)),n.push(`Thundercharged`);break;case`Dawnlit`:case`Ambershine`:if(no(t,e))return;n.push(e);break;case`Dawncharged`:case`Ambercharged`:{let r=e===`Dawncharged`?`Dawnlit`:`Ambershine`;if(no(t,e,[r]))return;t.includes(r)&&(n=n.filter(e=>e!==r)),n.push(e);break}default:return e}return n}';
const LIVE = BETA.replace('function no(', 'function qa(').replace('function ro(', 'function Ja(').replace(/\bno\(t,e/g, 'qa(t,e');
const wrap = (fn: string): string => `var x=1;${fn}var Ya={AmberCapture:{capsuleToolId:\`AmberCapsule\`}};`;

const plain = (id: string): object => ({ mayReplace: [], removes: [], clearsGroup: null, adds: id, combine: null });

describe('parseMutationRules', () => {
  it('reads every case of the beta switch as data', () => {
    const parsed = parseMutationRules(wrap(BETA));
    expect(parsed?.unparsed).toEqual([]);
    expect(parsed?.rules).toEqual({
      Rainbow: plain('Rainbow'),
      Gold: plain('Gold'),
      Wet: { mayReplace: ['Chilled'], removes: [], clearsGroup: null, adds: 'Wet', combine: { with: 'Chilled', into: 'Frozen' } },
      Chilled: { mayReplace: ['Wet'], removes: [], clearsGroup: null, adds: 'Chilled', combine: { with: 'Wet', into: 'Frozen' } },
      Frozen: { mayReplace: ['Wet', 'Chilled'], removes: [], clearsGroup: 'Hydro', adds: 'Frozen', combine: null },
      Thunderstruck: plain('Thunderstruck'),
      Thundercharged: { mayReplace: ['Thunderstruck'], removes: ['Thunderstruck'], clearsGroup: null, adds: 'Thundercharged', combine: null },
      Dawnlit: plain('Dawnlit'),
      Ambershine: plain('Ambershine'),
      Dawncharged: { mayReplace: ['Dawnlit'], removes: ['Dawnlit'], clearsGroup: null, adds: 'Dawncharged', combine: null },
      Ambercharged: { mayReplace: ['Ambershine'], removes: ['Ambershine'], clearsGroup: null, adds: 'Ambercharged', combine: null },
    });
  });

  it('gives the same rules for the live build text', () => {
    expect(LIVE).toContain('function qa(e,t,n)');
    expect(LIVE).toContain('if(qa(t,e,[`Wet`,`Chilled`]))');
    expect(parseMutationRules(wrap(LIVE))).toEqual(parseMutationRules(wrap(BETA)));
  });

  it('follows renamed minified names, including $', () => {
    const renamed = BETA.replace(/\bno\(/g, '$o(').replace(/\bW\[/g, 'W$[');
    const parsed = parseMutationRules(renamed);
    expect(parsed?.unparsed).toEqual([]);
    expect(parsed?.rules.Frozen).toMatchObject({ clearsGroup: 'Hydro', mayReplace: ['Wet', 'Chilled'] });
    expect(parsed?.rules.Wet?.combine).toEqual({ with: 'Chilled', into: 'Frozen' });
  });

  it('picks up a new plain case and lists an unknown shape as unparsed', () => {
    const extra = BETA.replace('default:', 'case`Moonlit`:if(no(t,e))return;n.push(e);break;case`Eclipse`:if(no(t,e))return;n.unshift(e);break;default:');
    const parsed = parseMutationRules(extra);
    expect(parsed?.rules.Moonlit).toEqual(plain('Moonlit'));
    expect(parsed?.rules.Eclipse).toBeUndefined();
    expect(parsed?.unparsed).toEqual(['Eclipse']);
    expect(parsed?.rules.Gold).toEqual(plain('Gold'));
  });

  it('is null without the marker or without the switch end', () => {
    expect(parseMutationRules('function a(e,t){return e}')).toBeNull();
    expect(parseMutationRules(BETA.replace('default:', 'dflt:'))).toBeNull();
    expect(MUTATION_RULES_MARKER.test(BETA.replace('n?.includes', 'n.includes'))).toBe(false);
  });
});
