import type { ProbeTargetCandidate } from '../../debug/universalProbe/types';
import type { ResolveTargetEvidence, TargetRecipeSignal } from './types';

function includesAny(text: string, values: string[]): boolean {
  const lower = text.toLowerCase();
  return values.some((value) => lower.includes(value.toLowerCase()));
}

export function evaluateSignal(candidate: ProbeTargetCandidate, signal: TargetRecipeSignal): ResolveTargetEvidence {
  const weight = signal.weight ?? 1;
  const label = candidate.label || '';
  const type = candidate.type || '';
  const source = candidate.source;
  const valueText = typeof signal.value === 'string' ? signal.value : '';
  let matched = false;
  let detail = '';
  switch (signal.type) {
    case 'source':
      matched = source === signal.value;
      detail = `${source}`;
      break;
    case 'interactive':
      matched = candidate.interactive === Boolean(signal.value);
      detail = `${candidate.interactive}`;
      break;
    case 'textIncludesAny':
      matched = Array.isArray(signal.value) ? includesAny(label, signal.value) : typeof signal.value === 'string' && includesAny(label, [signal.value]);
      detail = label;
      break;
    case 'labelIncludes':
      matched = typeof signal.value === 'string' && label.toLowerCase().includes(signal.value.toLowerCase());
      detail = label;
      break;
    case 'labelEquals':
      matched = typeof signal.value === 'string' && label.toLowerCase() === signal.value.toLowerCase();
      detail = label;
      break;
    case 'labelPattern':
      if (typeof signal.value === 'string') {
        try {
          matched = new RegExp(signal.value, 'i').test(label);
        } catch {
          matched = false;
        }
      }
      detail = label;
      break;
    case 'typeIncludes':
      matched = typeof signal.value === 'string' && type.toLowerCase().includes(signal.value.toLowerCase());
      detail = type;
      break;
    case 'minChildren':
      matched = typeof signal.value === 'number' && (candidate.childCount ?? 0) >= signal.value;
      detail = `${candidate.childCount ?? 0}`;
      break;
    case 'ancestorRole':
      if (candidate.element && valueText) {
        let current = candidate.element.parentElement;
        while (current) {
          if ((current.getAttribute('role') ?? '').toLowerCase() === valueText.toLowerCase()) {
            matched = true;
            break;
          }
          current = current.parentElement;
        }
      }
      detail = valueText;
      break;
    case 'layoutPattern':
      matched = valueText.length > 0 && (candidate.layout?.pattern ?? '').toLowerCase() === valueText.toLowerCase();
      detail = candidate.layout?.pattern ?? '';
      break;
    default:
      matched = false;
      detail = 'unknown signal';
      break;
  }
  return { signal: signal.type, matched, score: matched ? weight : -weight, detail };
}

export function confidenceFromEvidence(candidateConfidence: number, evidence: ResolveTargetEvidence[]): number {
  const possible = evidence.reduce((sum, item) => sum + Math.max(1, Math.abs(item.score || 0)), 0) || 1;
  const actual = evidence.reduce((sum, item) => sum + (item.matched ? Math.max(1, item.score || 1) : 0), 0);
  const signalConfidence = actual / possible;
  return Math.round(Math.min(0.99, (candidateConfidence / 100) * 0.5 + signalConfidence * 0.5) * 100) / 100;
}
