import type { Ktx2DecoderTelemetry } from '../ktx2';
import { storage } from '../../utils/storage';
import { ALLOW_KTX2_LEGACY_FALLBACK_KEY } from './constants';

export function createDecoderTelemetry(): Ktx2DecoderTelemetry {
  return {
    workerReady: false,
    decodeAttempts: 0,
    decodeSuccesses: 0,
    decodeFailures: 0,
    totalDecodeMs: 0,
    discoveryStrategy: 'pending',
    workerUrl: null,
    wasmUrl: null,
    wasmBytes: 0,
    wasmFetchMs: 0,
    discoveryMs: 0,
  };
}

export function chooseKtx2DecoderConcurrency(): number {
  const cores = Number((navigator as any)?.hardwareConcurrency || 0);
  const memoryGb = Number((navigator as any)?.deviceMemory || 0);
  const lowEndByCores = Number.isFinite(cores) && cores > 0 && cores <= 4;
  const lowEndByMemory = Number.isFinite(memoryGb) && memoryGb > 0 && memoryGb <= 4;
  return lowEndByCores || lowEndByMemory ? 1 : 2;
}

export function classifyKtx2Error(error: unknown): 'discovery-failed' | 'protocol-mismatch' | 'fetch-failed' | 'decode-timeout' | 'decode-failed' | 'canvas-build-failed' | 'wasm-blocked' {
  const msg = String((error as Error)?.message ?? error ?? '').toLowerCase();
  if (msg.includes('discovery')) return 'discovery-failed';
  if (msg.includes('protocol')) return 'protocol-mismatch';
  if (msg.includes('wasm') || msg.includes('webassembly') || msg.includes('csp') || msg.includes('script-src')) return 'wasm-blocked';
  if (msg.includes('timeout')) return 'decode-timeout';
  if (msg.includes('http') || msg.includes('network') || msg.includes('fetch')) return 'fetch-failed';
  if (msg.includes('canvas') || msg.includes('2d context')) return 'canvas-build-failed';
  return 'decode-failed';
}

/** Probe whether WebAssembly compilation is available (not blocked by CSP). */
export function isWasmAvailable(): boolean {
  try {
    // Minimal valid WASM module header
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]);
    new WebAssembly.Module(bytes);
    return true;
  } catch {
    return false;
  }
}

export function shouldAllowLegacyFallbackOnKtx2(): boolean {
  return storage.get<boolean>(ALLOW_KTX2_LEGACY_FALLBACK_KEY, false) === true;
}
