export type SfxName = string;

export type AudioRoute = 'audiosprite' | 'fallback' | 'none';

export interface PlaySfxOptions {
  volumeMultiplier?: number;
  volumeOverride?: number;
  pan?: number;
  feature?: string;
}

export interface SpatialSfxOptions {
  maxDistance?: number;
  feature?: string;
}

export interface SfxLoopHandle {
  readonly isActive: boolean;
  setVolume(v: number): void;
  setPan(p: number): void;
  stop(): void;
}

export interface AudioCatalogSnapshot {
  readonly ready: boolean;
  readonly route: AudioRoute;
  readonly sfxCount: number;
  readonly activeLoops: number;
  readonly mute: boolean;
  readonly volume: number;
}

export interface BridgePlayOpts {
  volume: number;
  pan?: number;
}

export interface BridgeLoopHandle {
  readonly id: number;
  setVolume(v: number): void;
  setPan(p: number): void;
  stop(): void;
  isActive(): boolean;
}

export interface AudioBridge {
  hasAtlas(): boolean;
  getAtlas(): Record<string, { start: number; end: number }> | null;
  play(name: string, opts: BridgePlayOpts): boolean;
  startLoop(name: string, opts: BridgePlayOpts): BridgeLoopHandle | null;
  stopAll(): void;
  primeUnlock(): void;
}
