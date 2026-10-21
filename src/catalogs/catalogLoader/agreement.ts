// Does a captured catalog agree with the game's bundle text? Another mod's copy
// (Arie's Mod loads one from its own API) has every key, so a key-set diff can't
// see it; its sprite paths and extra fields can. Numbers are never compared —
// the hoisted-const guess in dexBlueprints can be wrong, and a false replacement
// would swap good data for bad.

export interface CatalogAgreement {
  agrees: boolean;
  mismatches: string[];
}

export interface AgreementOptions {
  /** Fields QPM's own enrichment writes onto captured entries (e.g. `color`). */
  ignoreKeys?: readonly string[];
}

type Entry = Record<string, unknown>;

const isObj = (v: unknown): v is Entry => !!v && typeof v === 'object' && !Array.isArray(v);
const isSpritePath = (v: unknown): v is string => typeof v === 'string' && v.startsWith('sprite/');

function safeGet(obj: Entry, key: string): unknown {
  try {
    return obj[key];
  } catch {
    return undefined;
  }
}

function safeKeys(obj: unknown): string[] {
  try {
    return isObj(obj) ? Object.keys(obj) : [];
  } catch {
    return [];
  }
}

function compareSpritePaths(path: string, captured: unknown, bundle: Entry, out: string[]): void {
  const capturedEntry = isObj(captured) ? captured : {};
  for (const key of Object.keys(bundle)) {
    const expected = bundle[key];
    if (!isSpritePath(expected)) continue;
    const actual = safeGet(capturedEntry, key);
    if (actual !== expected) out.push(`${path}.${key}: ${JSON.stringify(actual)} != ${JSON.stringify(expected)}`);
  }
}

export function checkCatalogAgreement(
  captured: Record<string, unknown>,
  bundle: Record<string, Entry>,
  options: AgreementOptions = {},
): CatalogAgreement {
  const ignore = new Set(options.ignoreKeys ?? []);
  const mismatches: string[] = [];

  for (const id of safeKeys(captured)) {
    const bundleEntry = bundle[id];
    if (!isObj(bundleEntry)) continue;
    const capturedEntry = safeGet(captured, id);
    if (!isObj(capturedEntry)) continue;

    compareSpritePaths(id, capturedEntry, bundleEntry, mismatches);
    for (const [stage, stageValue] of Object.entries(bundleEntry)) {
      if (isObj(stageValue)) compareSpritePaths(`${id}.${stage}`, safeGet(capturedEntry, stage), stageValue, mismatches);
    }

    for (const key of safeKeys(capturedEntry)) {
      if (key in bundleEntry || ignore.has(key)) continue;
      const value = safeGet(capturedEntry, key);
      if (typeof value === 'function' || isSpritePath(value)) continue;
      mismatches.push(`${id}.${key}: foreign field`);
    }
  }

  return { agrees: mismatches.length === 0, mismatches };
}
