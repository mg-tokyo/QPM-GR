// KTX2 decoder pool — reuses the game's own compiled worker + wasm.
//
// At runtime we discover the hashed asset URLs on the game origin
// (`ktx2.worker-<hash>.js`, `libktx-<hash>.wasm`), fetch the wasm bytes on the
// main thread, spawn the game's worker file ourselves, and drive it with the
// game's own message protocol requesting `rgba8unorm` output. See
// `.claude/plans/2026-07-08-ktx2-libktx-port.md` for the protocol contract and
// the live-probe evidence that established it.

import { discoverGameAssets, type GameAssetHit } from '../../utils/gameAssetDiscovery';
import type {
  Ktx2DecodeResult,
  Ktx2DecoderPool,
  Ktx2DecoderPoolOptions,
  Ktx2DecoderTelemetry,
  Ktx2DiscoveryStrategy,
} from './types';

type WorkerLoadRequest = {
  type: 'load';
  id: number;
  url: string;
  bytes: ArrayBuffer;
};

type WorkerInitRequest = {
  type: 'init';
  wasmBinary: ArrayBuffer;
  supportedTextures: readonly string[];
  forceRgbaFallback: boolean;
};

type TextureOptions = {
  width: number;
  height: number;
  format: string;
  mipLevelCount?: number;
  resource: readonly (Uint8Array | ArrayBufferView)[];
  alphaMode?: string;
};

type WorkerLoaded = {
  type: 'loaded';
  id: number;
  textureOptions: TextureOptions;
};

type WorkerLoadError = {
  type: 'load-error';
  id: number;
  error: string;
};

type WorkerInbound = WorkerLoaded | WorkerLoadError;

type DecodeTask = {
  id: number;
  label: string;
  bytes: ArrayBuffer;
  resolve: (result: Ktx2DecodeResult) => void;
  reject: (error: Error) => void;
};

type InFlightTask = {
  task: DecodeTask;
  slotIndex: number;
  timeoutHandle: ReturnType<typeof setTimeout> | null;
  startedAt: number;
};

type WorkerSlot = {
  worker: Worker;
  busy: boolean;
};

const DEFAULT_CONCURRENCY = 2;
const DEFAULT_DECODE_TIMEOUT_MS = 9000;
const INIT_TIMEOUT_MS = 10000;
const SUPPORTED_TEXTURES: readonly string[] = ['rgba8unorm'];
const ACCEPTED_FORMATS = new Set<string>(['rgba8unorm', 'rgba8unorm-srgb']);

const DISCOVERY_QUERIES = [
  { key: 'ktx2Worker', filenamePattern: /\bktx2\.worker[\w.-]*\.js\b/ },
  { key: 'libktxWasm', filenamePattern: /\blibktx[\w.-]*\.wasm\b/ },
] as const;

function createInitialTelemetry(): Ktx2DecoderTelemetry {
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

export function createKtx2DecoderPool(options: Ktx2DecoderPoolOptions = {}): Ktx2DecoderPool {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? DEFAULT_CONCURRENCY));
  const decodeTimeoutMs = Math.max(1000, Math.floor(options.decodeTimeoutMs ?? DEFAULT_DECODE_TIMEOUT_MS));
  const telemetry = createInitialTelemetry();
  const queue: DecodeTask[] = [];
  const inFlight = new Map<number, InFlightTask>();
  const slots: WorkerSlot[] = [];
  let nextTaskId = 1;
  let destroyed = false;
  let workerUrl: string | null = null;
  let wasmBytes: ArrayBuffer | null = null;
  let runtimePromise: Promise<void> | null = null;

  const handleMessage = (event: MessageEvent<WorkerInbound>): void => {
    const message = event.data;
    if (!message) return;

    if (message.type === 'loaded') {
      finalizeLoaded(message);
      return;
    }
    if (message.type === 'load-error') {
      const task = releaseTask(message.id);
      if (!task) return;
      telemetry.decodeFailures += 1;
      task.reject(new Error(message.error || `KTX2 decode failed for ${task.label}`));
    }
  };

  const finalizeLoaded = (message: WorkerLoaded): void => {
    const flight = inFlight.get(message.id);
    if (!flight) return;
    const decodeMs = performance.now() - flight.startedAt;
    const validation = validateTextureOptions(message.textureOptions);
    if (!validation.ok) {
      releaseTask(message.id);
      telemetry.decodeFailures += 1;
      flight.task.reject(new Error(`KTX2 worker protocol mismatch (${flight.task.label}): ${validation.reason}`));
      return;
    }
    releaseTask(message.id);
    telemetry.decodeSuccesses += 1;
    telemetry.totalDecodeMs += decodeMs;
    const level0 = validation.level0;
    const rgba = new Uint8ClampedArray(level0.buffer, level0.byteOffset, level0.byteLength);
    flight.task.resolve({
      width: validation.width,
      height: validation.height,
      rgba,
      decodeMs,
    });
  };

  const handleWorkerError = (error: ErrorEvent): void => {
    const sourceWorker = (error.currentTarget || error.target) as Worker | null;
    const slotIndex = sourceWorker ? slots.findIndex((slot) => slot.worker === sourceWorker) : -1;
    const failure = `KTX2 worker error: ${error.message || 'unknown'}`;

    if (slotIndex >= 0) {
      const impacted = Array.from(inFlight.entries())
        .filter(([, flight]) => flight.slotIndex === slotIndex)
        .map(([taskId, flight]) => ({ taskId, task: flight.task }));
      recycleWorkerSlot(slotIndex);
      for (const impactedTask of impacted) {
        releaseById(impactedTask.taskId);
        rejectTask(impactedTask.task, new Error(failure));
      }
      schedule();
      return;
    }

    const anyInFlight = Array.from(inFlight.values());
    for (const flight of anyInFlight) {
      releaseById(flight.task.id);
      rejectTask(flight.task, new Error(failure));
    }
    for (let i = 0; i < slots.length; i++) {
      recycleWorkerSlot(i);
    }
    schedule();
  };

  const attachWorkerListeners = (worker: Worker): void => {
    worker.addEventListener('message', handleMessage as EventListener);
    worker.addEventListener('error', handleWorkerError as EventListener);
  };

  const detachWorkerListeners = (worker: Worker): void => {
    worker.removeEventListener('message', handleMessage as EventListener);
    worker.removeEventListener('error', handleWorkerError as EventListener);
  };

  const spawnWorker = (): Worker => {
    if (!workerUrl) throw new Error('KTX2 worker URL not resolved');
    if (!wasmBytes) throw new Error('KTX2 wasm bytes not fetched');
    const worker = new Worker(workerUrl, { type: 'module' });
    const initMessage: WorkerInitRequest = {
      type: 'init',
      wasmBinary: wasmBytes,
      supportedTextures: SUPPORTED_TEXTURES,
      forceRgbaFallback: false,
    };
    worker.postMessage(initMessage);
    return worker;
  };

  const recycleWorkerSlot = (slotIndex: number): void => {
    const oldSlot = slots[slotIndex];
    if (oldSlot?.worker) {
      detachWorkerListeners(oldSlot.worker);
      oldSlot.worker.terminate();
    }
    try {
      const worker = spawnWorker();
      attachWorkerListeners(worker);
      slots[slotIndex] = { worker, busy: false };
    } catch (error) {
      const stub = { busy: true } as WorkerSlot;
      slots[slotIndex] = stub;
      // Schedule cannot use this slot; failures propagate via ensureRuntime.
      throw error instanceof Error ? error : new Error(String(error));
    }
  };

  const rejectTask = (task: DecodeTask, error: Error): void => {
    telemetry.decodeFailures += 1;
    task.reject(error);
  };

  const releaseById = (id: number): InFlightTask | null => {
    const flight = inFlight.get(id);
    if (!flight) return null;
    inFlight.delete(id);
    if (flight.timeoutHandle) {
      clearTimeout(flight.timeoutHandle);
    }
    const slot = slots[flight.slotIndex];
    if (slot) slot.busy = false;
    return flight;
  };

  const handleTaskTimeout = (taskId: number): void => {
    const flight = releaseById(taskId);
    if (!flight) return;
    try {
      recycleWorkerSlot(flight.slotIndex);
    } catch (error) {
      rejectTask(flight.task, error instanceof Error ? error : new Error(String(error)));
      return;
    }
    rejectTask(flight.task, new Error(`KTX2 decode timeout after ${decodeTimeoutMs}ms (${flight.task.label})`));
    schedule();
  };

  const schedule = (): void => {
    if (destroyed || !telemetry.workerReady) return;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      if (!slot || slot.busy) continue;
      const task = queue.shift();
      if (!task) break;
      slot.busy = true;
      const request: WorkerLoadRequest = {
        type: 'load',
        id: task.id,
        url: task.label,
        bytes: task.bytes,
      };
      const timeoutHandle = setTimeout(() => handleTaskTimeout(task.id), decodeTimeoutMs);
      inFlight.set(task.id, { task, slotIndex: i, timeoutHandle, startedAt: performance.now() });
      try {
        slot.worker.postMessage(request, [task.bytes]);
      } catch (error) {
        releaseById(task.id);
        try {
          recycleWorkerSlot(i);
        } catch (recycleError) {
          rejectTask(task, recycleError instanceof Error ? recycleError : new Error(String(recycleError)));
          continue;
        }
        rejectTask(task, error instanceof Error ? error : new Error(String(error ?? 'worker-post-failed')));
      }
    }
  };

  const releaseTask = (id: number): DecodeTask | null => {
    const flight = releaseById(id);
    if (!flight) return null;
    schedule();
    return flight.task;
  };

  const ensureRuntime = (): Promise<void> => {
    if (runtimePromise) return runtimePromise;
    runtimePromise = (async () => {
      const discovery = await discoverGameAssets(DISCOVERY_QUERIES);
      telemetry.discoveryMs = Math.round(discovery.ms);
      const workerHit = discovery.hits.get('ktx2Worker');
      const wasmHit = discovery.hits.get('libktxWasm');
      if (!workerHit || !wasmHit) {
        telemetry.discoveryStrategy = 'failed';
        throw new Error(
          `KTX2 discovery failed (workerHit=${workerHit ? 'ok' : 'missing'}, wasmHit=${wasmHit ? 'ok' : 'missing'})`,
        );
      }
      telemetry.discoveryStrategy = pickStrategy(workerHit, wasmHit);
      telemetry.workerUrl = workerHit.url;
      telemetry.wasmUrl = wasmHit.url;
      workerUrl = workerHit.url;

      const fetchStart = performance.now();
      wasmBytes = await fetchValidatedWasm(wasmHit.url);
      telemetry.wasmFetchMs = Math.round(performance.now() - fetchStart);
      telemetry.wasmBytes = wasmBytes.byteLength;

      for (let i = 0; i < concurrency; i++) {
        const worker = spawnWorker();
        attachWorkerListeners(worker);
        slots.push({ worker, busy: false });
      }
      telemetry.workerReady = true;
    })();
    runtimePromise.catch(() => {
      // Surface only through the per-decode rejection path.
    });
    return runtimePromise;
  };

  return {
    decode(bytes: ArrayBuffer, label: string): Promise<Ktx2DecodeResult> {
      if (destroyed) {
        return Promise.reject(new Error('KTX2 decoder pool destroyed'));
      }
      const taskId = nextTaskId++;
      telemetry.decodeAttempts += 1;
      return new Promise<Ktx2DecodeResult>((resolve, reject) => {
        const task: DecodeTask = { id: taskId, label, bytes, resolve, reject };
        queue.push(task);
        withRuntime(ensureRuntime, () => {
          if (destroyed) return;
          schedule();
        }).catch((error: unknown) => {
          const index = queue.indexOf(task);
          if (index >= 0) queue.splice(index, 1);
          rejectTask(task, error instanceof Error ? error : new Error(String(error)));
        });
      });
    },

    snapshot(): Ktx2DecoderTelemetry {
      return { ...telemetry };
    },

    destroy(): void {
      if (destroyed) return;
      destroyed = true;

      while (queue.length > 0) {
        const task = queue.shift();
        task?.reject(new Error('KTX2 decoder pool destroyed'));
      }

      for (const [, flight] of inFlight) {
        if (flight.timeoutHandle) {
          clearTimeout(flight.timeoutHandle);
        }
        flight.task.reject(new Error('KTX2 decoder pool destroyed'));
      }
      inFlight.clear();

      for (const slot of slots) {
        if (slot?.worker) {
          detachWorkerListeners(slot.worker);
          slot.worker.terminate();
        }
      }
      slots.length = 0;
      wasmBytes = null;
    },
  };
}

async function withRuntime(ensure: () => Promise<void>, onReady: () => void): Promise<void> {
  await withTimeout(ensure(), INIT_TIMEOUT_MS, 'KTX2 runtime init timed out');
  onReady();
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(handle);
        resolve(value);
      },
      (error) => {
        clearTimeout(handle);
        reject(error);
      },
    );
  });
}

function pickStrategy(a: GameAssetHit, b: GameAssetHit): Ktx2DiscoveryStrategy {
  if (a.strategy === 'bundle-scan' || b.strategy === 'bundle-scan') return 'bundle-scan';
  return 'resource-timing';
}

async function fetchValidatedWasm(url: string): Promise<ArrayBuffer> {
  const attempt = async (target: string): Promise<ArrayBuffer> => {
    const response = await fetch(target, { cache: 'force-cache' });
    if (!response.ok) {
      throw new Error(`KTX2 wasm fetch http ${response.status} (${target})`);
    }
    const bytes = await response.arrayBuffer();
    if (!WebAssembly.validate(bytes)) {
      throw new Error(`KTX2 wasm validate failed (${target})`);
    }
    return bytes;
  };
  try {
    return await attempt(url);
  } catch (error) {
    const cacheBust = url.includes('?') ? `${url}&qpm=${Date.now()}` : `${url}?qpm=${Date.now()}`;
    try {
      return await attempt(cacheBust);
    } catch {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

type Validation =
  | { ok: true; width: number; height: number; level0: Uint8Array }
  | { ok: false; reason: string };

function validateTextureOptions(options: TextureOptions | undefined | null): Validation {
  if (!options || typeof options !== 'object') {
    return { ok: false, reason: 'protocol: missing textureOptions' };
  }
  const { width, height, format, resource } = options;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return { ok: false, reason: `protocol: bad dimensions ${width}x${height}` };
  }
  if (typeof format !== 'string' || !ACCEPTED_FORMATS.has(format)) {
    return { ok: false, reason: `protocol: unexpected format ${String(format)}` };
  }
  if (!Array.isArray(resource) || resource.length === 0) {
    return { ok: false, reason: 'protocol: empty resource array' };
  }
  const level0Raw = resource[0];
  if (!level0Raw || typeof (level0Raw as ArrayBufferView).byteLength !== 'number') {
    return { ok: false, reason: 'protocol: level-0 resource missing' };
  }
  const level0 = level0Raw as Uint8Array;
  const expected = width * height * 4;
  if (level0.byteLength !== expected) {
    return { ok: false, reason: `protocol: level-0 byteLength ${level0.byteLength} != ${expected}` };
  }
  return { ok: true, width, height, level0 };
}
