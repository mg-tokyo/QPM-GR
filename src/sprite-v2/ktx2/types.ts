export type Ktx2DecodeResult = {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
  decodeMs: number;
};

export type Ktx2DiscoveryStrategy = 'resource-timing' | 'bundle-scan' | 'failed' | 'pending';

// workerReady semantics: runtime ready (discovery + wasm fetch + worker spawn +
// init post). There is no worker-side ready message in the game's protocol —
// the wasm compiles lazily inside the worker on the first load request.
export type Ktx2DecoderTelemetry = {
  workerReady: boolean;
  decodeAttempts: number;
  decodeSuccesses: number;
  decodeFailures: number;
  totalDecodeMs: number;
  discoveryStrategy: Ktx2DiscoveryStrategy;
  workerUrl: string | null;
  wasmUrl: string | null;
  wasmBytes: number;
  wasmFetchMs: number;
  discoveryMs: number;
};

export type Ktx2DecoderPoolOptions = {
  concurrency?: number;
  decodeTimeoutMs?: number;
};

export type Ktx2DecoderPool = {
  decode(bytes: ArrayBuffer, label: string): Promise<Ktx2DecodeResult>;
  snapshot(): Ktx2DecoderTelemetry;
  destroy(): void;
};
