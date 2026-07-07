/** Narrow `unknown` to a plain object record (excludes arrays). */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}
