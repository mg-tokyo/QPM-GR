// src/rive-engine/assetInterceptor.ts
//
// Per-asset interception inside a loaded .riv bundle. The setter is wired
// through index.ts and consumed by loadWrapper.ts — when rive.load(bytes) is
// called, the wrapper reverse-resolves the bundle URL via the fetch
// interceptor's fingerprint map, then installs an assetLoader that calls
// getAssetHandler(url, asset.name) for each asset Rive processes. Returning
// override bytes from the handler causes the wrapper to decode and bind
// those bytes instead of the asset embedded in the bundle.

import type { AssetInterceptOpts, OverrideInfo } from './types';
import { riveLog, EventBus } from './helpers';

interface ActiveAssetInterceptor {
  info: OverrideInfo;
  opts: AssetInterceptOpts;
}

const activeInterceptors = new Map<string, ActiveAssetInterceptor>();
let nextId = 1;

export function setAssetInterceptor(
  opts: AssetInterceptOpts,
  eventBus: EventBus,
): () => void {
  const id = `asset_${nextId++}`;

  const info: OverrideInfo = {
    id,
    kind: 'asset',
    scope: { type: 'global', source: opts.rivFile },
    property: typeof opts.assetName === 'string' ? opts.assetName : opts.assetName.source,
    cleanup: () => {},
  };

  const entry: ActiveAssetInterceptor = { info, opts };
  activeInterceptors.set(id, entry);

  const cleanup = () => {
    if (!activeInterceptors.has(id)) return;
    activeInterceptors.delete(id);
    eventBus.emit('overrideReverted', info);
    riveLog(`Asset interceptor reverted: ${id}`);
  };

  info.cleanup = cleanup;
  eventBus.emit('overrideApplied', info);
  riveLog(`Asset interceptor registered: ${opts.rivFile} / ${opts.assetName}`);
  return cleanup;
}

export function getAssetHandler(
  rivFile: string,
  assetName: string,
): ((name: string) => Uint8Array | null) | null {
  const fileLower = rivFile.toLowerCase();
  for (const entry of activeInterceptors.values()) {
    if (!fileLower.includes(entry.opts.rivFile.toLowerCase())) continue;

    const pattern = entry.opts.assetName;
    const matches = typeof pattern === 'string'
      ? assetName === pattern
      : pattern.test(assetName);

    if (matches) return entry.opts.handler;
  }
  return null;
}

export function revertAllAssetInterceptors(): void {
  for (const entry of activeInterceptors.values()) {
    entry.info.cleanup();
  }
  activeInterceptors.clear();
}

export function getActiveAssetInterceptors(): OverrideInfo[] {
  return Array.from(activeInterceptors.values()).map((e) => e.info);
}
