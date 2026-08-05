import type { LowLevelRive } from '../../rive-engine/types';

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
  file: RivePetsFile | null;
  renderer: RivePetsRenderer | null;
  workCanvas: HTMLCanvasElement | null;
  artboardNames: Set<string>;
  readyCallbacks: Array<() => void>;
  cleanups: Array<() => void>;
};

export const petRiveState: PetRiveState = {
  initialized: false,
  ready: false,
  runtime: null,
  file: null,
  renderer: null,
  workCanvas: null,
  artboardNames: new Set(),
  readyCallbacks: [],
  cleanups: [],
};

export function resetPetRiveState(): void {
  petRiveState.initialized = false;
  petRiveState.ready = false;
  petRiveState.runtime = null;
  petRiveState.file = null;
  petRiveState.renderer = null;
  petRiveState.workCanvas = null;
  petRiveState.artboardNames.clear();
  petRiveState.readyCallbacks = [];
  petRiveState.cleanups = [];
}
