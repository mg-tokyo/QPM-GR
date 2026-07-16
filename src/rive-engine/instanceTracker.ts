// src/rive-engine/instanceTracker.ts

import { pageWindow } from '../core/pageContext';
import type {
  RiveInstance, RiveArtboard, RiveStateMachine, RiveViewModelInstance,
} from './types';
import { riveLog, generateInstanceId, resolvePrivateField, EventBus } from './helpers';

const instances = new Map<string, RiveInstance>();
const rawToId = new WeakMap<object, string>();

// ---------------------------------------------------------------------------
// Tag inference — verified live 2026-07-15 against gg-preview-pr-3208-app.
// Route by artboard name for known families, then by parent-label walk for
// unnamed families (pet artboards are species names — 'Horse', 'Capybara',
// etc. — and never contain 'pet'; avatar artboard is literally 'default').
// ---------------------------------------------------------------------------

const DECOR_ARTBOARDS_LOWER = new Set([
  'woodwindmill', 'marblefountain', 'stonebirdbath', 'windspinner',
  'windturner', 'cauldron', 'weatherstation',
]);

function inferTags(artboardName: string, raw: Record<string, unknown>): string[] {
  const tags: string[] = [];
  const name = artboardName.toLowerCase();

  if (DECOR_ARTBOARDS_LOWER.has(name)) {
    tags.push('decor');
    return tags;
  }
  if (name.includes('avatar')) {
    tags.push('avatar');
    return tags;
  }
  if (name.includes('emote')) tags.push('emote');
  if (name.includes('currency') || name.includes('bread') || name.includes('donut')) {
    tags.push('currency');
  }
  if (name.includes('streak')) tags.push('streak');
  if (name.includes('giftbox')) tags.push('giftbox');
  if (name.includes('countdown')) tags.push('countdown');
  if (name.includes('loader')) tags.push('loader');
  if (tags.length > 0) return tags;

  // Unnamed-family instances. Pet artboards are per-species names; avatar is
  // 'default'. Distinguish via ancestor label — walkParentForAvatarOwner
  // walks up looking for AvatarView/AvatarContainer.
  if (walkParentForAvatarOwner(raw) !== null) {
    tags.push('avatar');
    return tags;
  }
  tags.push('pet');
  return tags;
}

// ---------------------------------------------------------------------------
// Structural predicates for resolvePrivateField (audit fix #7)
// ---------------------------------------------------------------------------

function isArtboardLike(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.width === 'number' && typeof obj.stateMachineCount === 'function';
}

function isStateMachineLike(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.inputCount === 'function' && typeof obj.input === 'function';
}

function isViewModelLike(v: unknown): boolean {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return typeof obj.image === 'function' && typeof obj.string === 'function';
}

// ---------------------------------------------------------------------------
// Batch renderer discovery (audit fix #3: handles non-enumerable property)
// ---------------------------------------------------------------------------

interface BatchRendererInfo {
  workingSet: Map<object, unknown>;
  obj: Record<string, unknown>;
}

function findBatchRenderer(): BatchRendererInfo | null {
  const captured = (pageWindow as Record<string, unknown>).__QPM_PIXI_CAPTURED__ as
    { app?: Record<string, unknown> } | undefined;
  const app = captured?.app;
  if (!app) return null;

  const direct = app.riveSpriteBatchRenderer;
  if (isBatchRenderer(direct)) {
    return toBatchRendererInfo(direct as Record<string, unknown>);
  }

  for (const key of Object.getOwnPropertyNames(app)) {
    try {
      const val = app[key];
      if (isBatchRenderer(val)) {
        return toBatchRendererInfo(val as Record<string, unknown>);
      }
    } catch {
      // Skip unreadable properties
    }
  }

  return null;
}

function isBatchRenderer(val: unknown): boolean {
  if (!val || typeof val !== 'object') return false;
  const obj = val as Record<string, unknown>;
  // Production build minifies method names; detect by structural properties
  return obj.workingSet instanceof Map
    && obj.rive != null && typeof obj.rive === 'object'
    && obj.riveRenderer != null && typeof obj.riveRenderer === 'object';
}

function toBatchRendererInfo(obj: Record<string, unknown>): BatchRendererInfo {
  return {
    workingSet: obj.workingSet as Map<object, unknown>,
    obj,
  };
}

// ---------------------------------------------------------------------------
// Extract existing sprites from batch renderer (audit fix #6)
// ---------------------------------------------------------------------------

function looksLikeRiveSprite(obj: object): boolean {
  const r = obj as Record<string, unknown>;
  return typeof r.artboardName === 'string' || isArtboardLike(r.artboard);
}

function spriteFromMapEntry(key: object, value?: unknown): Record<string, unknown> | null {
  if (looksLikeRiveSprite(key)) return key as Record<string, unknown>;
  if (value != null && typeof value === 'object' && looksLikeRiveSprite(value as object)) {
    return value as Record<string, unknown>;
  }
  return null;
}

// ---------------------------------------------------------------------------
// loadAndSetImage hook (audit fix #4)
// ---------------------------------------------------------------------------

function hookLoadAndSetImage(
  raw: Record<string, unknown>,
  instanceId: string,
  eventBus: EventBus,
): void {
  const original = raw.loadAndSetImage;
  if (typeof original !== 'function') return;

  raw.loadAndSetImage = async function (this: unknown, ...args: unknown[]) {
    const result = await (original as Function).apply(this, args);
    const property = typeof args[0] === 'string' ? args[0] : '';
    eventBus.emit('imageReloaded', { instanceId, property });
    return result;
  };
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function registerSprite(raw: Record<string, unknown>, eventBus: EventBus): void {
  if (rawToId.has(raw as object)) return;

  const id = generateInstanceId();
  const artboardName = typeof raw.artboardName === 'string' ? raw.artboardName : 'default';

  const artboard = resolvePrivateField<RiveArtboard>(raw, 'artboard', isArtboardLike);
  const stateMachine = resolvePrivateField<RiveStateMachine>(raw, 'stateMachine', isStateMachineLike);
  const viewModel = resolvePrivateField<RiveViewModelInstance>(
    raw, 'viewModelInstance', isViewModelLike,
  );

  const instance: RiveInstance = {
    id,
    type: 'sprite',
    source: artboardName,
    artboardName,
    stateMachineName: '',
    artboard,
    stateMachine,
    viewModel,
    canvas: null,
    tags: inferTags(artboardName, raw),
    raw,
  };

  instances.set(id, instance);
  rawToId.set(raw as object, id);

  hookLoadAndSetImage(raw, id, eventBus);

  riveLog(`Instance registered: ${id} [${instance.tags.join(', ')}] (${artboardName})`);
  eventBus.emit('registered', instance);
}

function unregisterSprite(raw: Record<string, unknown>, eventBus: EventBus): void {
  const id = rawToId.get(raw as object);
  if (!id) return;

  rawToId.delete(raw as object);
  instances.delete(id);
  riveLog(`Instance destroyed: ${id}`);
  eventBus.emit('destroyed', id);
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initInstanceTracker(eventBus: EventBus): () => void {
  const cleanups: Array<() => void> = [];

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let hooked = false;
  let hookedMap: Map<object, unknown> | null = null;

  function tryHook(): boolean {
    const br = findBatchRenderer();
    if (!br) return false;

    const ws = br.workingSet;
    hookedMap = ws;

    const origSet = ws.set;
    const origDelete = ws.delete;
    const mapObj = ws as unknown as Record<string, unknown>;

    mapObj['set'] = function (key: object, value: unknown) {
      origSet.call(ws, key, value);
      const sprite = spriteFromMapEntry(key, value);
      if (sprite) registerSprite(sprite, eventBus);
      return ws;
    };

    mapObj['delete'] = function (key: object) {
      const val = ws.get(key);
      const sprite = spriteFromMapEntry(key, val);
      if (sprite) unregisterSprite(sprite, eventBus);
      return origDelete.call(ws, key);
    };

    riveLog('Batch renderer hooks installed (workingSet)');
    hooked = true;

    let existingCount = 0;
    for (const [key, value] of ws) {
      const sprite = spriteFromMapEntry(key, value);
      if (sprite) {
        registerSprite(sprite, eventBus);
        existingCount++;
      }
    }
    if (existingCount > 0) {
      riveLog(`Registered ${existingCount} pre-existing sprite(s)`);
    }

    return true;
  }

  if (!tryHook()) {
    pollTimer = setInterval(() => {
      if (tryHook() && pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    }, 500);

    cleanups.push(() => {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    });
  }

  return () => {
    for (const fn of cleanups) fn();

    if (hooked && hookedMap) {
      const m = hookedMap as unknown as Record<string, unknown>;
      delete m['set'];
      delete m['delete'];
      riveLog('Batch renderer hooks removed');
    }

    instances.clear();
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function getAllInstances(): RiveInstance[] {
  return Array.from(instances.values());
}

export function getInstance(id: string): RiveInstance | null {
  return instances.get(id) ?? null;
}

export function getInstancesBySource(source: string): RiveInstance[] {
  const lower = source.toLowerCase();
  return Array.from(instances.values()).filter(
    (i) => i.source.toLowerCase().includes(lower),
  );
}

export function getInstancesByTag(tag: string): RiveInstance[] {
  return Array.from(instances.values()).filter((i) => i.tags.includes(tag));
}

export function addTag(instanceId: string, tag: string): void {
  const inst = instances.get(instanceId);
  if (inst && !inst.tags.includes(tag)) {
    inst.tags.push(tag);
  }
}

export function getInstanceIdByRaw(raw: object): string | undefined {
  return rawToId.get(raw);
}

// ---------------------------------------------------------------------------
// Local-player avatar resolution
// ---------------------------------------------------------------------------

const AVATAR_LABEL_RE = /^(?:AvatarView|AvatarContainer) \((.+)\)/;

function walkParentForAvatarOwner(raw: unknown): string | null {
  let node = raw as Record<string, unknown> | null;
  let depth = 0;
  while (node && depth < 15) {
    const label = node.label;
    if (typeof label === 'string') {
      const m = label.match(AVATAR_LABEL_RE);
      if (m) return m[1]!;
    }
    node = node.parent as Record<string, unknown> | null;
    depth++;
  }
  return null;
}

export function findAvatarInstanceByPlayerId(playerId: string): RiveInstance | null {
  for (const inst of instances.values()) {
    if (!inst.tags.includes('avatar')) continue;
    const owner = walkParentForAvatarOwner(inst.raw);
    if (owner === playerId) return inst;
  }
  return null;
}

export function findAllAvatarInstances(): Array<{ instance: RiveInstance; ownerId: string | null }> {
  const result: Array<{ instance: RiveInstance; ownerId: string | null }> = [];
  for (const inst of instances.values()) {
    if (!inst.tags.includes('avatar')) continue;
    result.push({ instance: inst, ownerId: walkParentForAvatarOwner(inst.raw) });
  }
  return result;
}

export function debugAvatarParentChains(): Array<{ id: string; artboard: string; chain: string[] }> {
  const results: Array<{ id: string; artboard: string; chain: string[] }> = [];
  for (const inst of instances.values()) {
    if (!inst.tags.includes('avatar')) continue;
    const chain: string[] = [];
    let node = inst.raw as Record<string, unknown> | null;
    let depth = 0;
    while (node && depth < 20) {
      const label = node.label;
      const ctor = node.constructor?.name ?? '?';
      chain.push(`[${depth}] ${ctor}${typeof label === 'string' ? ` label="${label}"` : ''}`);
      node = node.parent as Record<string, unknown> | null;
      depth++;
    }
    results.push({ id: inst.id, artboard: inst.artboardName, chain });
  }
  return results;
}

// ---------------------------------------------------------------------------
// PIXI scene-graph discovery
// ---------------------------------------------------------------------------

// Cap on parent walks. Rive sprites typically sit 4-8 nodes below the stage;
// 32 is generous and bounds runtime if the chain is somehow cyclic.
const ANCESTOR_WALK_DEPTH = 32;

function ancestryIncludes(raw: unknown, target: object): boolean {
  let node = raw as Record<string, unknown> | null;
  let depth = 0;
  while (node && depth < ANCESTOR_WALK_DEPTH) {
    if (node === target) return true;
    node = node.parent as Record<string, unknown> | null;
    depth++;
  }
  return false;
}

/**
 * Find every registered Rive instance whose PIXI display-object ancestry
 * passes through `container`. Use this to resolve "which Rive instance is
 * inside this open card/window" — the caller passes the PIXI container they
 * already have (e.g. `cv.cardVisual.container`) and we filter the registry
 * by ancestor reachability.
 *
 * Pattern mirrors `walkParentForAvatarOwner` — we walk `raw.parent` because
 * the registered `raw` is the PIXI sprite the batch renderer holds. Tag
 * filtering happens first so we skip the walk on instances we'd reject.
 */
export function findInstancesUnderPixiContainer(
  container: object,
  tagFilter?: string,
): RiveInstance[] {
  const result: RiveInstance[] = [];
  for (const inst of instances.values()) {
    if (tagFilter && !inst.tags.includes(tagFilter)) continue;
    if (ancestryIncludes(inst.raw, container)) result.push(inst);
  }
  return result;
}
