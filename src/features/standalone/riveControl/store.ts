import { storage } from '../../../utils/storage';
import { sanitizeRiveRule, type RiveRule } from './types';

const STORAGE_KEY = 'qpm.riveRules.v1';

let rules: RiveRule[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function generateId(): string {
  return `rrule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function persist(): void {
  try {
    storage.set(STORAGE_KEY, rules);
  } catch {
    // Storage layer already logs; nothing we can do here.
  }
}

function fire(): void {
  for (const cb of listeners) {
    try { cb(); } catch { /* swallow */ }
  }
}

/** Read persisted rules into memory. Safe to call multiple times — idempotent. */
export function loadRiveRules(): void {
  if (loaded) return;
  loaded = true;
  const raw = storage.get<unknown>(STORAGE_KEY, []);
  if (!Array.isArray(raw)) {
    rules = [];
    return;
  }
  const cleaned: RiveRule[] = [];
  for (const entry of raw) {
    const r = sanitizeRiveRule(entry);
    if (r) cleaned.push(r);
  }
  rules = cleaned;
}

export function getRiveRules(): RiveRule[] {
  return rules.slice();
}

export function addRiveRule(rule: Omit<RiveRule, 'id'>): RiveRule {
  const withId: RiveRule = { ...rule, id: generateId() };
  const cleaned = sanitizeRiveRule(withId);
  if (!cleaned) throw new Error('[riveControl] addRiveRule: invalid rule shape');
  rules = [...rules, cleaned];
  persist();
  fire();
  return cleaned;
}

export function updateRiveRule(rule: RiveRule): void {
  const cleaned = sanitizeRiveRule(rule);
  if (!cleaned) return;
  const idx = rules.findIndex((r) => r.id === cleaned.id);
  if (idx === -1) return;
  const next = rules.slice();
  next[idx] = cleaned;
  rules = next;
  persist();
  fire();
}

export function deleteRiveRule(id: string): void {
  const next = rules.filter((r) => r.id !== id);
  if (next.length === rules.length) return;
  rules = next;
  persist();
  fire();
}

export function clearAllRiveRules(): void {
  if (rules.length === 0) return;
  rules = [];
  persist();
  fire();
}

export function onRiveRulesChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
