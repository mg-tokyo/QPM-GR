// src/rive-engine/types.ts

// ---------------------------------------------------------------------------
// Rive runtime types (opaque — we access these at runtime, not via import)
// ---------------------------------------------------------------------------

export type LowLevelRive = {
  load(bytes: Uint8Array, assetLoader?: unknown): unknown;
  decodeImage(bytes: Uint8Array, cb: (img: RiveImage | null) => void): void;
  makeRenderer(canvas: HTMLCanvasElement): unknown;
  StateMachineInstance: new (sm: unknown, artboard: unknown) => unknown;
  SMIInput: { number: number; boolean: number; trigger: number };
};

export type RiveImage = {
  unref(): void;
};

export type RiveViewModelInstance = {
  image(name: string): { value(img: unknown): void } | null;
  string(name: string): { value: string } | null;
  number(name: string): { value: number } | null;
  boolean(name: string): { value: boolean } | null;
  delete(): void;
};

export type RiveArtboard = {
  width: number;
  height: number;
  stateMachineCount(): number;
  stateMachineByIndex(index: number): unknown | null;
  setTextRunValue(name: string, value: string): void;
  textRun(name: string): { text: string } | null;
  delete(): void;
};

export type RiveStateMachine = {
  inputCount(): number;
  input(index: number): RiveSMIInput | null;
  delete(): void;
};

export type RiveSMIInput = {
  name: string;
  type: number;
  asBool(): { value: boolean };
  asNumber(): { value: number };
  asTrigger(): { fire(): void };
};

// ---------------------------------------------------------------------------
// Instance descriptor
// ---------------------------------------------------------------------------

export interface RiveInstance {
  id: string;
  type: 'sprite' | 'react';
  source: string;
  artboardName: string;
  stateMachineName: string;
  artboard: RiveArtboard | null;
  stateMachine: RiveStateMachine | null;
  viewModel: RiveViewModelInstance | null;
  canvas: HTMLCanvasElement | null;
  tags: string[];
  raw: unknown;
}

// ---------------------------------------------------------------------------
// Override scoping
// ---------------------------------------------------------------------------

export type OverrideScope =
  | { type: 'global'; source: string }
  | { type: 'tagged'; tag: string }
  | { type: 'instance'; id: string };

// ---------------------------------------------------------------------------
// Override info (for getActiveOverrides)
// ---------------------------------------------------------------------------

export interface OverrideInfo {
  id: string;
  kind: 'image' | 'input' | 'text' | 'file' | 'asset' | 'speed';
  scope: OverrideScope;
  property: string;
  cleanup: () => void;
}

// ---------------------------------------------------------------------------
// Enumeration
// ---------------------------------------------------------------------------

export interface InputDescriptor {
  name: string;
  type: 'boolean' | 'number' | 'trigger';
  currentValue: boolean | number | null;
}

// ---------------------------------------------------------------------------
// Override option types
// ---------------------------------------------------------------------------

export interface ImageOverrideOpts {
  target: OverrideScope;
  property: string;
  image: string | Uint8Array;
  // Optional callback invoked from cleanup() to obtain the image that should
  // be written back to the property as a one-shot restore. Without this, the
  // override leaves the previewed image on screen because Rive's viewModel
  // image API has no read-current-bytes call. Resolved lazily so callers can
  // restore "whatever is equipped right now" instead of a stale snapshot.
  restoreOnCleanup?: () => string | Uint8Array | null;
}

export interface InputOverrideOpts {
  target: OverrideScope;
  input: string;
  value: boolean | number;
  pin?: boolean;
}

export interface TriggerOpts {
  target: OverrideScope;
  trigger: string;
}

export interface TextOverrideOpts {
  target: OverrideScope;
  textRun: string;
  value: string;
  pin?: boolean;
}

export interface AssetInterceptOpts {
  rivFile: string;
  assetName: string | RegExp;
  handler: (assetName: string) => Uint8Array | null;
}

export interface SpeedOverrideOpts {
  target: OverrideScope;
  /** Multiplier applied to RiveSprite.playbackSpeed. 0 freezes; 1 = normal. */
  speed: number;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export type RiveEngineEventMap = {
  registered: RiveInstance;
  destroyed: string;
  imageReloaded: { instanceId: string; property: string };
  overrideApplied: OverrideInfo;
  overrideReverted: OverrideInfo;
};

export type RiveEngineListener<K extends keyof RiveEngineEventMap> =
  (data: RiveEngineEventMap[K]) => void;
