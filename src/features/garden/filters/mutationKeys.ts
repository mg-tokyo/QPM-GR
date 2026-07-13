import { normalizeMutationName } from '../../../utils/game/cropMultipliers';

export function normalizeMutationFilterKey(raw: unknown): string | null {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!text) return null;

  const canonical = normalizeMutationName(text) ?? text;
  let key = canonical.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!key) return null;

  // Game payloads may use either Amberlit or Ambershine for the same amber lunar mutation.
  if (key === 'ambershine' || key === 'amberlit') {
    key = 'amberlit';
  }

  return key;
}

export function collectMutationKeys(value: unknown, out: Set<string>, seen: WeakSet<object> = new WeakSet<object>(), depth = 0): void {
  if (value == null || depth > 4) return;

  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = normalizeMutationFilterKey(value);
    if (normalized) out.add(normalized);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectMutationKeys(item, out, seen, depth + 1);
    }
    return;
  }

  if (value instanceof Set || value instanceof Map) {
    const values = value instanceof Set ? Array.from(value.values()) : Array.from(value.values());
    collectMutationKeys(values, out, seen, depth + 1);
    return;
  }

  if (typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);

  const record = value as Record<string, unknown>;
  collectMutationKeys(record.mutations, out, seen, depth + 1);
  collectMutationKeys(record.mutation, out, seen, depth + 1);

  // Fallback for descriptor-like payloads.
  const descriptorFields = [record.name, record.id, record.label, record.value, record.key];
  for (const field of descriptorFields) {
    if (typeof field === 'string') {
      const normalized = normalizeMutationFilterKey(field);
      if (normalized) out.add(normalized);
    }
  }
}
