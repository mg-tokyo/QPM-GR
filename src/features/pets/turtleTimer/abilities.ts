import { getAbilityDefinition } from '../data/petAbilities';
import {
  GROWTH_ABILITY_PATTERNS,
  RESTORE_PCT_BY_LEVEL,
  RESTORE_PROC_ODDS_BY_LEVEL,
  SLOW_PCT_BY_LEVEL,
} from './constants';
import type { ResolvedGrowthAbility, TurtleSupportKind } from './types';

export function normalizeAbility(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function resolveGrowthAbility(rawAbility: string, normalizedAbility: string): ResolvedGrowthAbility | null {
  let matchedKind: 'plant' | 'egg' | null = null;
  for (const group of GROWTH_ABILITY_PATTERNS) {
    if (group.patterns.some((pattern) => normalizedAbility.includes(pattern))) {
      matchedKind = group.kind;
      break;
    }
  }
  if (!matchedKind) return null;

  const def = getAbilityDefinition(rawAbility);
  if (!def) return null;

  const baseProbability = def.baseProbability ?? 0;
  const effectMinutesPerProc = def.effectValuePerProc ?? 0;
  if (baseProbability <= 0 || effectMinutesPerProc <= 0) return null;

  return {
    kind: matchedKind,
    abilityId: def.id,
    baseProbability,
    effectMinutesPerProc,
  };
}

function parseAbilityLevel(rawAbility: string, normalizedAbility: string): number {
  const numeralMatch = rawAbility.match(/\b(IV|III|II|I)\b/i);
  if (numeralMatch) {
    const token = numeralMatch[1]!.toUpperCase();
    switch (token) {
      case 'I':
        return 1;
      case 'II':
        return 2;
      case 'III':
        return 3;
      case 'IV':
        return 4;
      default:
        break;
    }
  }

  const digitMatch = rawAbility.match(/\b(\d+)\b/);
  if (digitMatch) {
    const parsed = Number.parseInt(digitMatch[1]!, 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }
  }

  if (normalizedAbility.endsWith('iv')) return 4;
  if (normalizedAbility.endsWith('iii')) return 3;
  if (normalizedAbility.endsWith('ii')) return 2;
  return 1;
}

export function resolveSupportEffect(
  kind: TurtleSupportKind,
  rawAbility: string,
  normalizedAbility: string,
): { effectPct: number; procOdds: number | null } | null {
  const level = parseAbilityLevel(rawAbility, normalizedAbility);
  if (kind === 'restore') {
    const effectPct = RESTORE_PCT_BY_LEVEL[Math.min(level, RESTORE_PCT_BY_LEVEL.length - 1)] ?? RESTORE_PCT_BY_LEVEL[1]!;
    const procOdds = RESTORE_PROC_ODDS_BY_LEVEL[Math.min(level, RESTORE_PROC_ODDS_BY_LEVEL.length - 1)] ?? RESTORE_PROC_ODDS_BY_LEVEL[1]!;
    return { effectPct, procOdds };
  }

  if (kind === 'slow') {
    const effectPct = SLOW_PCT_BY_LEVEL[Math.min(level, SLOW_PCT_BY_LEVEL.length - 1)] ?? SLOW_PCT_BY_LEVEL[1]!;
    return { effectPct, procOdds: null };
  }

  return null;
}

export function computeSupportProcPerMinute(baseScore: number, baseProcOdds: number | null): number {
  if (!baseProcOdds || baseProcOdds <= 0 || baseScore <= 0) {
    return 0;
  }
  const adjustedOdds = Math.min(0.95, Math.max(0, baseProcOdds * (baseScore / 100)));
  const perSecondChance = 1 - Math.pow(1 - adjustedOdds, 1 / 60);
  return perSecondChance * 60;
}
