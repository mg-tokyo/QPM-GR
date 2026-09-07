// Compares the state-tree rung with the atom rung for every key that has both,
// so a wrong-sibling label match surfaces as QPM-ATOM-003 at boot instead of as
// a user bug report.
import { deepEqual } from '../../utils/deepEqual';
import { createNamedLogger } from '../../diagnostics/logger';
import type { Registry, DefsShape } from './resolver';
import type { SourceHandle } from './types';

const log = createNamedLogger('gameState');

/** Keys whose rungs intentionally differ (documented in keys/*.ts). */
export const EXPECTED_DIVERGENCE: ReadonlySet<string> = new Set(['decorShedItems']);

export interface DivergentKey { key: string; stateRung: string; atomRung: string; summary: string }
export interface DivergenceReport { checked: number; divergent: DivergentKey[]; skipped: string[] }

export function summarizeDiff(state: unknown, atom: unknown): string {
  if (typeof state !== typeof atom) return `type ${typeof state} vs ${typeof atom}`;
  if (Array.isArray(state) && Array.isArray(atom)) {
    if (state.length !== atom.length) return `array length ${state.length} vs ${atom.length}`;
    const idx = state.findIndex((v, i) => !deepEqual(v, atom[i]));
    return `array differs at index ${idx}`;
  }
  if (state && atom && typeof state === 'object' && typeof atom === 'object') {
    const sk = Object.keys(state as object), ak = Object.keys(atom as object);
    const onlyState = sk.filter((k) => !ak.includes(k)), onlyAtom = ak.filter((k) => !sk.includes(k));
    if (onlyState.length || onlyAtom.length) return `object keys: only-state [${onlyState.join(',')}], only-atom [${onlyAtom.join(',')}]`;
    const k = sk.find((key) => !deepEqual((state as Record<string, unknown>)[key], (atom as Record<string, unknown>)[key]));
    return `object differs at key ${k ?? '?'}`;
  }
  return `value ${String(state).slice(0, 40)} vs ${String(atom).slice(0, 40)}`;
}

export function runDivergenceAudit<Defs extends DefsShape>(
  registry: Registry<Defs>,
  opts: { allow?: ReadonlySet<string>; emit?: boolean } = {},
): DivergenceReport {
  const allow = opts.allow ?? EXPECTED_DIVERGENCE;
  const report: DivergenceReport = { checked: 0, divergent: [], skipped: [] };
  for (const key of registry.keys()) {
    const handles: readonly SourceHandle<unknown>[] = registry.handlesFor(key);
    const st = handles.find((h) => h.kind === 'stateTree');
    const at = handles.find((h) => h.kind === 'atom');
    if (!st || !at) { report.skipped.push(key); continue; }
    const a = st.readSync(), b = at.readSync();
    if (!a.ok || !b.ok) { report.skipped.push(key); continue; }
    report.checked++;
    if (allow.has(key)) continue;
    const normalize = registry.auditNormalizerFor(key);
    const av = normalize ? normalize(a.value) : a.value;
    const bv = normalize ? normalize(b.value) : b.value;
    if (deepEqual(av, bv)) continue;
    const entry: DivergentKey = { key, stateRung: st.describe(), atomRung: at.describe(), summary: summarizeDiff(a.value, b.value) };
    report.divergent.push(entry);
    if (opts.emit) log.warn('QPM-ATOM-003', { key, stateRung: entry.stateRung, atomRung: entry.atomRung, summary: entry.summary });
  }
  return report;
}
