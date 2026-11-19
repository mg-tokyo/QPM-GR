import { describe, expect, it } from 'vitest';
import { CHARGED_ABILITY_RULES_MARKER, parseChargedAbilityRules } from './chargedAbilityRulesParsing';

// Exact excerpts of beta pr-4669-gke-2911 `inventoryAtoms-DkbetI5Q.js` (table, lookup + dispatch, charger rule).
const BETA_TABLE = 'ak}default:return e}return n}var io={AmberCapture:{capsuleToolId:`AmberCapsule`,capsulesByMutation:{Ambershine:1,Ambercharged:2}},DawnCapture:{capsuleToolId:`DawnCapsule`,capsulesByMutation:{Dawnlit:1,Dawncharged:2}}};';
const BETA_DISPATCH = 'function oo(e){return io[e].capsulesByMutation}function so(e,t){if(e===`Thundercharger`)return mo(t);let n=oo(e),r=t.filter(e=>n[e]===void 0);return r.length===t.length?null:r}';
const BETA_RULE = 'function mo(e){return e.includes(`Thunderstruck`)?ro(`Thundercharged`,e)??null:null}';
const BETA = `${BETA_TABLE}${BETA_DISPATCH}function co(e,t,n){let r=[];return r}${BETA_RULE}`;

// Exact excerpts of live build 2065 `inventoryAtoms-BGsbJlLc.js` (2026-11-17): table, lookup + dispatch, charger rule.
const LIVE = 'var ro={AmberCapture:{capsuleToolId:`AmberCapsule`,capsulesByMutation:{Ambershine:1,Ambercharged:2}},DawnCapture:{capsuleToolId:`DawnCapsule`,capsulesByMutation:{Dawnlit:1,Dawncharged:2}}};'
  + 'function ao(e){return ro[e].capsulesByMutation}function oo(e,t){if(e===`Thundercharger`)return po(t);let n=ao(e),r=t.filter(e=>n[e]===void 0);return r.length===t.length?null:r}'
  + 'function po(e){return e.includes(`Thunderstruck`)?no(`Thundercharged`,e)??null:null}';

const RULES = {
  captures: [
    { abilityId: 'AmberCapture', capsuleToolId: 'AmberCapsule', capsulesByMutation: { Ambershine: 1, Ambercharged: 2 } },
    { abilityId: 'DawnCapture', capsuleToolId: 'DawnCapsule', capsulesByMutation: { Dawnlit: 1, Dawncharged: 2 } },
  ],
  chargers: [{ abilityId: 'Thundercharger', target: 'Thunderstruck', replacement: 'Thundercharged' }],
  chargerDispatchFound: true,
  unparsedChargers: [],
};

describe('parseChargedAbilityRules (REL-8.1)', () => {
  it('live and beta parse equal despite different minified names', () => {
    expect(parseChargedAbilityRules(LIVE)).toEqual(RULES);
    expect(parseChargedAbilityRules(BETA)).toEqual(RULES);
  });

  it('a charger rule of another shape drops only that charger', () => {
    const text = BETA.replace(BETA_RULE, 'function mo(e){return e.some(t=>t===`Thunderstruck`)?[]:null}');
    expect(parseChargedAbilityRules(text)).toEqual({ ...RULES, chargers: [], unparsedChargers: ['Thundercharger'] });
  });

  it('no dispatch ahead of the lookup → captures kept, chargers unknown', () => {
    const text = BETA.replace('if(e===`Thundercharger`)return mo(t);let n=oo(e)', 'let n=Xo(e)');
    expect(parseChargedAbilityRules(text)).toEqual({ ...RULES, chargers: [], chargerDispatchFound: false });
  });

  it('a dispatch with no charger branch → none, and a bare caller earlier does not hide the real one', () => {
    const bare = BETA.replace('if(e===`Thundercharger`)return mo(t);', '');
    expect(parseChargedAbilityRules(bare)).toEqual({ ...RULES, chargers: [], chargerDispatchFound: true });
    const earlyCaller = BETA.replace(BETA_DISPATCH, `function oo(e){return io[e].capsulesByMutation}function fo(e,t){let n=oo(e);return n}${BETA_DISPATCH.slice(BETA_DISPATCH.indexOf('function so'))}`);
    expect(parseChargedAbilityRules(earlyCaller)).toEqual(RULES);
  });

  it('reads spaced output and other quotes', () => {
    const spaced = 'const T = {\n  AmberCapture: {\n    capsulesByMutation: { Ambershine: 1, Ambercharged: 2, },\n    capsuleToolId: "AmberCapsule",\n  },\n};\n'
      + 'function L(e) { return T[e].capsulesByMutation; }\n'
      + 'function D(e, t) {\n  if (e === \'Thundercharger\') return F(t);\n  const n = L(e);\n}\n'
      + 'function F(e) { return e.includes("Thunderstruck") ? G("Thundercharged", e) : null; }';
    expect(parseChargedAbilityRules(spaced)).toEqual({ ...RULES, captures: [RULES.captures[0]] });
  });

  it('table absent, empty or of another shape → null', () => {
    expect(parseChargedAbilityRules('var a=1;')).toBeNull();
    expect(parseChargedAbilityRules('x.capsulesByMutation:1')).toBeNull();
    expect(parseChargedAbilityRules('var io={AmberCapture:{capsuleToolId:`AmberCapsule`,capsulesByMutation:{}}};')).toBeNull();
    expect(parseChargedAbilityRules(BETA_TABLE.replace('Ambershine:1', 'Ambershine:`one`'))).toBeNull();
    expect(parseChargedAbilityRules(BETA_TABLE.replace('capsuleToolId:`DawnCapsule`,', 'capsuleToolId:`DawnCapsule`,weight:2,'))).toBeNull();
    expect(parseChargedAbilityRules(BETA_TABLE.replace(',capsulesByMutation:{Dawnlit:1,Dawncharged:2}', ''))).toBeNull();
    expect(parseChargedAbilityRules(BETA_TABLE.slice(0, -3))).toBeNull();
  });

  it('locale prose naming Thundercharger is not a rule', () => {
    const prose = 'var q={Thundercharger:`Thundercharger turns Thunderstruck crops into Thundercharged ones`,thunder:"Thundercharger"};';
    expect(parseChargedAbilityRules(prose)).toBeNull();
    expect(parseChargedAbilityRules(`${prose}${BETA}`)).toEqual(RULES);
  });

  it('stays fast on a large chunk', () => {
    const big = `${'function a(e,t){let n=b(e)}'.repeat(5000)}${'{x:{capsuleToolId:'.repeat(5000)}${BETA}${'=oo('.repeat(5000)}`;
    const t0 = performance.now();
    expect(big.includes(CHARGED_ABILITY_RULES_MARKER)).toBe(true);
    expect(parseChargedAbilityRules(big)).toEqual(RULES);
    expect(performance.now() - t0).toBeLessThan(200);
  });
});
