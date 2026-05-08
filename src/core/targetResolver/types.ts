import type { ProbeBounds, ProbeSource, ProbeTargetCandidate } from '../../debug/universalProbe/types';

export type TargetRecipeSignalType =
  | 'ancestorRole'
  | 'textIncludesAny'
  | 'layoutPattern'
  | 'minChildren'
  | 'interactive'
  | 'source'
  | 'labelIncludes'
  | 'labelEquals'
  | 'labelPattern'
  | 'typeIncludes';

export interface TargetRecipeSignal {
  type: TargetRecipeSignalType;
  value: string | string[] | number | boolean;
  weight?: number;
}

export interface TargetRecipe {
  id: string;
  sources: ProbeSource[];
  requiredSignals: TargetRecipeSignal[];
  rejectSignals?: TargetRecipeSignal[];
  minConfidence: number;
}

export interface ResolveTargetParams {
  text?: string;
  label?: string;
  tileKey?: string;
  minConfidence?: number;
}

export interface ResolveTargetEvidence {
  signal: string;
  matched: boolean;
  score: number;
  detail: string;
}

export interface ResolveTargetResult {
  found: boolean;
  recipeId: string;
  confidence: number;
  source: ProbeSource | null;
  stableTag?: string;
  bounds?: ProbeBounds;
  target?: ProbeTargetCandidate;
  evidence: ResolveTargetEvidence[];
  warnings: string[];
}
