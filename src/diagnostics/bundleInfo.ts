// src/diagnostics/bundleInfo.ts — Publish build-time bundle metadata to the
// health bus so size regressions are visible in the Diagnostics window.
//
// The build script (scripts/build-userscript.js) burns
// `window.__QPM_BUNDLE_INFO__ = { version, iifeBytes, builtAt }` into
// dist/QPM.user.js just before the IIFE footer. This module reads that
// object once at boot and publishes it as `bundle` on the health bus.

import { healthBus } from './healthBus';

interface QpmBundleInfo {
  version?: string;
  iifeBytes?: number;
  builtAt?: string;
}

declare global {
  interface Window {
    __QPM_BUNDLE_INFO__?: QpmBundleInfo;
  }
}

let started = false;

export function startBundleInfoDiagnostics(): void {
  if (started) return;
  started = true;

  const info: QpmBundleInfo =
    (typeof window !== 'undefined' && window.__QPM_BUNDLE_INFO__) || {};

  const version = typeof info.version === 'string' ? info.version : 'unknown';
  const iifeBytes = typeof info.iifeBytes === 'number' ? info.iifeBytes : 0;
  const builtAt = typeof info.builtAt === 'string' ? info.builtAt : 'unknown';

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
    },
  });
}
