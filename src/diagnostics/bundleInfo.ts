// Publish build-time bundle metadata to the health bus so size regressions are visible
// in the Diagnostics window. scripts/build-userscript.js burns `window.__QPM_BUNDLE_INFO__`
// into the bundle before the IIFE; scripts/build-weavermod.js rewrites its `packaging`.

import { healthBus } from './healthBus';

export type BundlePackaging = 'userscript' | 'weavermod';

interface QpmBundleInfo {
  version?: string;
  iifeBytes?: number;
  builtAt?: string;
  packaging?: string;
}

declare global {
  interface Window {
    __QPM_BUNDLE_INFO__?: QpmBundleInfo;
  }
}

let started = false;

function readInfo(): QpmBundleInfo {
  return (typeof window !== 'undefined' && window.__QPM_BUNDLE_INFO__) || {};
}

/** Null for a dev build or a bundle older than the packaging field. */
export function readBundlePackaging(): BundlePackaging | null {
  try {
    const packaging = readInfo().packaging;
    return packaging === 'userscript' || packaging === 'weavermod' ? packaging : null;
  } catch {
    return null;
  }
}

export function startBundleInfoDiagnostics(): void {
  if (started) return;
  started = true;

  const info = readInfo();

  const version = typeof info.version === 'string' ? info.version : 'unknown';
  const iifeBytes = typeof info.iifeBytes === 'number' ? info.iifeBytes : 0;
  const builtAt = typeof info.builtAt === 'string' ? info.builtAt : 'unknown';
  const packaging = readBundlePackaging() ?? 'unknown';

  healthBus.register('bundle', {
    category: 'core',
    status: 'ok',
    message: `v${version} · ${(iifeBytes / 1024).toFixed(1)} KiB`,
  });

  healthBus.publish({
    subsystem: 'bundle',
    category: 'core',
    status: 'ok',
    message: `v${version} · ${(iifeBytes / 1024).toFixed(1)} KiB`,
    metrics: {
      version,
      iifeBytes,
      builtAt,
      packaging,
    },
  });
}
