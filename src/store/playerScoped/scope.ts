import type { ClaimMarker, PlayerScopedDeps, PlayerScopedHandle, PlayerScopedLayout, PlayerScopedSpec } from './types';

export const PLAYER_SCOPED_CLAIMS_KEY = 'qpm.playerScoped.claims.v1';
/** A `split` result for a part whose stored copy is still current. */
export const PLAYER_SCOPED_UNCHANGED: unique symbol = Symbol('playerScoped.unchanged');

const ABSENT: unique symbol = Symbol('playerScoped.absent');
type Maybe<T> = T | typeof ABSENT;

export function singleKeyLayout<T>(baseKey: string): PlayerScopedLayout<T> {
  return { parts: [baseKey], join: ([raw]) => raw as T | undefined, split: (value) => [value] };
}

function stringEntries(value: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value)) if (typeof v === 'string') out[k] = v;
  return out;
}

function parseMarker(raw: unknown): ClaimMarker {
  const out: ClaimMarker = { sites: {}, shared: {} };
  if (!raw || typeof raw !== 'object') return out;
  const record = raw as { sites?: unknown; shared?: unknown };
  out.shared = stringEntries(record.shared);
  if (record.sites && typeof record.sites === 'object') {
    for (const [site, claims] of Object.entries(record.sites)) out.sites[site] = stringEntries(claims);
  }
  return out;
}

/** Claims are first-come; `a` wins where both copies name a claimant. */
function unionMarkers(a: ClaimMarker, b: ClaimMarker): ClaimMarker {
  const out: ClaimMarker = { sites: {}, shared: { ...b.shared, ...a.shared } };
  for (const site of new Set([...Object.keys(a.sites), ...Object.keys(b.sites)])) {
    out.sites[site] = { ...b.sites[site], ...a.sites[site] };
  }
  return out;
}

const isMissing = (raw: readonly unknown[]): boolean => raw.every((part) => part === undefined);

function sameContent(a: readonly unknown[], b: readonly unknown[]): boolean {
  if (isMissing(a) || isMissing(b)) return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
}

export function createPlayerScopedWith<T>(
  spec: PlayerScopedSpec<T>,
  deps: PlayerScopedDeps,
  layout: PlayerScopedLayout<T> = singleKeyLayout<T>(spec.baseKey),
): PlayerScopedHandle<T> {
  const baseKey = spec.baseKey;
  const noParts: readonly unknown[] = layout.parts.map(() => undefined);
  let started = false;
  let unsubscribe: (() => void) | null = null;
  let generation = 0;
  let boundId: string | null = null;
  let pendingId: string | null = null;
  let held: Maybe<T> = ABSENT;
  let current: T = spec.fallback;

  const scopedKeys = (id: string): string[] => layout.parts.map((part) => `${part}.${id}`);

  const readLocal = (keys: readonly string[]): unknown[] => keys.map((key) => {
    const raw = deps.storageGet<unknown>(key, ABSENT);
    return raw === ABSENT ? undefined : raw;
  });

  const readDurable = (keys: readonly string[]): Promise<unknown[]> => Promise.all(keys.map(async (key) => {
    const raw = await deps.readDurable<unknown>(key, ABSENT);
    return raw === ABSENT ? undefined : raw;
  }));

  function joinParts(raw: readonly unknown[]): Maybe<T> {
    if (isMissing(raw)) return ABSENT;
    const value = layout.join(raw);
    return value === undefined ? ABSENT : value;
  }

  function writeParts(id: string, value: T, reason: 'bind' | 'write'): boolean {
    const parts = layout.split(value, reason);
    let ok = true;
    scopedKeys(id).forEach((key, n) => {
      const part = parts[n];
      if (part === undefined || part === PLAYER_SCOPED_UNCHANGED) return;
      try { deps.storageSet(key, part); } catch (error) { ok = false; deps.onError('persist', baseKey, error); }
    });
    return ok;
  }

  function complete(id: string, durableOk: boolean, durableScoped: readonly unknown[], durableLegacy: readonly unknown[], durableMarker: unknown): void {
    const keys = scopedKeys(id);
    const site = deps.siteId();
    const marker = unionMarkers(parseMarker(deps.storageGet<unknown>(PLAYER_SCOPED_CLAIMS_KEY, null)), parseMarker(durableMarker));
    const sharedClaim = marker.shared[baseKey];
    const siteClaim = marker.sites[site]?.[baseKey];
    const localScoped = joinParts(readLocal(keys));

    const copies: T[] = [];
    const push = (copy: Maybe<T>): void => { if (copy !== ABSENT) copies.push(copy); };
    push(localScoped);
    push(joinParts(durableScoped));
    // A failed durable read cannot tell this site's own copy from the shared one, so nothing is claimed until a later load.
    const claimShared = durableOk && sharedClaim === undefined;
    const claimSite = durableOk && siteClaim === undefined;
    if (claimShared) push(joinParts(durableLegacy));
    if (claimSite) {
      const localLegacy = readLocal(layout.parts);
      // With no mirror row, `storage.get` serves the shared GM copy; never hand another player's claim to this one.
      const isOthersShared = sharedClaim !== undefined && sharedClaim !== id && sameContent(localLegacy, durableLegacy);
      if (!isOthersShared) push(joinParts(localLegacy));
    }
    push(held);

    let value = spec.fallback;
    const [first, ...rest] = copies;
    if (first !== undefined) {
      value = first;
      for (const copy of rest) value = spec.merge(value, copy);
    }

    const saved = first !== undefined && (localScoped === ABSENT || value !== localScoped) ? writeParts(id, value, 'bind') : true;
    // An unsaved merge must not claim the legacy copy, or a later load would never merge it again.
    if (saved && (claimShared || claimSite)) {
      if (claimShared) marker.shared[baseKey] = id;
      if (claimSite) marker.sites[site] = { ...marker.sites[site], [baseKey]: id };
      try { deps.storageSet(PLAYER_SCOPED_CLAIMS_KEY, marker); } catch (error) { deps.onError('persist', baseKey, error); }
    }
    for (const key of keys) deps.registerDynamicKey(key);

    held = ABSENT;
    boundId = id;
    pendingId = null;
    current = value;
    try { spec.onReady(value, id); } catch (error) { deps.onError('bind', baseKey, error); }
  }

  async function bind(id: string, gen: number): Promise<void> {
    let durableOk = true;
    let durableScoped: readonly unknown[] = noParts;
    let durableLegacy: readonly unknown[] = noParts;
    let durableMarker: unknown = null;
    try {
      [durableScoped, durableLegacy, durableMarker] = await Promise.all([
        readDurable(scopedKeys(id)),
        readDurable(layout.parts),
        deps.readDurable<unknown>(PLAYER_SCOPED_CLAIMS_KEY, null),
      ]);
    } catch (error) {
      durableOk = false;
      durableScoped = noParts;
      durableLegacy = noParts;
      deps.onError('bind', baseKey, error);
    }
    if (gen !== generation || !started) return;
    try {
      complete(id, durableOk, durableScoped, durableLegacy, durableMarker);
    } catch (error) {
      pendingId = null;
      deps.onError('bind', baseKey, error);
    }
  }

  function onPlayerId(id: string | null): void {
    if (!started || !id || id === pendingId) return;
    if (id === boundId) {
      if (pendingId !== null) { pendingId = null; generation++; }
      return;
    }
    if (boundId !== null && spec.flush) {
      try { spec.flush(); } catch (error) { deps.onError('persist', baseKey, error); }
    }
    pendingId = id;
    const gen = ++generation;
    void bind(id, gen);
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      unsubscribe = deps.onIdentityChange(onPlayerId);
      onPlayerId(deps.currentPlayerId());
    },
    stop(): void {
      if (!started) return;
      started = false;
      generation++;
      unsubscribe?.();
      unsubscribe = null;
      boundId = null;
      pendingId = null;
      held = ABSENT;
      current = spec.fallback;
    },
    write(value: T): boolean {
      current = value;
      if (boundId === null) { held = value; return true; }
      // During a rebind the store's state still belongs to the old id, so its key gets the write.
      return writeParts(boundId, value, 'write');
    },
    read: () => current,
    isReady: () => boundId !== null,
    scopedKey: () => (boundId === null ? null : `${baseKey}.${boundId}`),
  };
}
