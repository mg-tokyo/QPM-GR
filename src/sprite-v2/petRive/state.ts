import type { LowLevelRive } from '../../rive-engine/types';
import type { PetRiveSources } from './bundleLoader';

export type RivePetsFile = {
  artboardCount(): number;
  artboardByIndex(i: number): RivePetsArtboard | null;
  artboardByName(name: string): RivePetsArtboard | null;
  unref?(): void;
};

export type RivePetsArtboard = {
  name: string;
  width: number;
  height: number;
  bounds: unknown;
  stateMachineCount(): number;
  stateMachineByIndex(i: number): unknown | null;
  advance(seconds: number): void;
  draw(renderer: RivePetsRenderer): void;
  delete?(): void;
};

export type RivePetsRenderer = {
  save(): void;
  restore(): void;
  align(fit: unknown, alignment: unknown, dest: unknown, src: unknown): void;
  clear(): void;
  invalidateGLState?(): void;
  unbindGLInternalResources?(): void;
  flush?(): void;
};

export type PetRiveState = {
  initialized: boolean;
  ready: boolean;
  runtime: LowLevelRive | null;
  sources: PetRiveSources | null;
  /** Single-file mode only; per-species files are unref'd after render. */
  file: RivePetsFile | null;
  renderer: RivePetsRenderer | null;
  workCanvas: HTMLCanvasElement | null;
  /** Species QPM can render: discovered species (split) or artboard names (single). */
  artboardNames: Set<string>;
  inFlight: Map<string, Promise<void>>;
  failed: Set<string>;
  refreshFrame: number | null;
  readyCallbacks: Array<() => void>;
  cleanups: Array<() => void>;
};

export const petRiveState: PetRiveState = {
  initialized: false,
  ready: false,
  runtime: null,
  sources: null,
  file: null,
  renderer: null,
  workCanvas: null,
  artboardNames: new Set(),
  inFlight: new Map(),
  failed: new Set(),
  refreshFrame: null,
  readyCallbacks: [],
  cleanups: [],
};

export function resetPetRiveState(): void {
  petRiveState.initialized = false;
  petRiveState.ready = false;
  petRiveState.runtime = null;
  petRiveState.sources = null;
  petRiveState.file = null;
  petRiveState.renderer = null;
  petRiveState.workCanvas = null;
  petRiveState.artboardNames.clear();
  petRiveState.inFlight.clear();
  petRiveState.failed.clear();
  petRiveState.refreshFrame = null;
  petRiveState.readyCallbacks = [];
  petRiveState.cleanups = [];
}
