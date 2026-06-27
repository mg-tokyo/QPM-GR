import { stripRenderState } from './matcher/state';
import { scopeKey } from './types';
import type { TextureOverrideRule } from './types';

type RuleId = string;

export class RuleIndex {
  private byFamily = new Map<string, RuleId[]>();
  private byScopeKey = new Map<string, RuleId[]>();

  rebuild(rules: TextureOverrideRule[]): void {
    this.byFamily.clear();
    this.byScopeKey.clear();
    for (const rule of rules) {
      const family = stripRenderState(rule.targetSpriteKey);
      pushBucket(this.byFamily, family, rule.id);
      pushBucket(this.byScopeKey, scopeKey(rule.scope), rule.id);
    }
  }

  candidatesForFamily(familyRoot: string): RuleId[] {
    return this.byFamily.get(familyRoot) ?? [];
  }

  scopedRulesFor(args: { species: string; tileKey?: string; slotIndex?: 0 | 1 | 2 }): RuleId[] {
    const out: RuleId[] = [];
    const sp = args.species.toLowerCase();
    if (typeof args.tileKey === 'string') {
      const key = `tile:${args.tileKey}:${sp}`;
      out.push(...(this.byScopeKey.get(key) ?? []));
    }
    if (args.slotIndex === 0 || args.slotIndex === 1 || args.slotIndex === 2) {
      const key = `pet:${args.slotIndex}:${sp}`;
      out.push(...(this.byScopeKey.get(key) ?? []));
    }
    return out;
  }
}

function pushBucket<K>(map: Map<K, RuleId[]>, key: K, id: RuleId): void {
  const arr = map.get(key);
  if (arr) arr.push(id); else map.set(key, [id]);
}

export const ruleIndex = new RuleIndex();
