import type { Ktx2DecoderTelemetry } from '../ktx2';

export type AtlasLoaderMode = 'legacy' | 'compressed';
export type SpriteLoadMode = 'legacy' | 'ktx2-native' | 'ktx2-native-failed' | 'legacy-fallback';
export type AtlasSource = 'legacy-image' | 'ktx2-decoder' | 'legacy-fallback' | 'runtime-bridge';
export type SpriteHydrationStatus = 'ok' | 'degraded' | 'failed';
export type TextureSourceName = 'assets' | 'bridge' | 'runtime';

export type SpriteProbeInput =
  | string
  | {
      key?: string;
      category?: string;
      id?: string;
      mutations?: string[];
    };

export type SpriteProbeResult = {
  input: string;
  category: string;
  id: string;
  mutations: string[];
  ok: boolean;
  width: number;
  height: number;
  error?: string;
};

export type AtlasBootReport = {
  atlasPath: string;
  imagePath: string;
  mode: AtlasLoaderMode;
  source: AtlasSource;
  expectedFrames: number;
  hydratedFrames: number;
  coverage: number;
  status: SpriteHydrationStatus;
  sourceHits: Record<TextureSourceName, number>;
  missingSample: string[];
};

export type SpriteRendererReport = {
  rendererUid: string | number | null;
  rendererType: string | number | null;
  appRendererUid: string | number | null;
  sameAsAppRenderer: boolean;
  hasExtractCanvas: boolean;
  appHasExtractCanvas: boolean;
  lastRenderError: string | null;
  lastRenderErrorAt: number | null;
};

export type SpriteBootReport = {
  version: string | null;
  base: string | null;
  pixiVersion: string | null;
  finalMode: AtlasLoaderMode | 'mixed' | 'unknown';
  loadMode: SpriteLoadMode | 'unknown';
  status: SpriteHydrationStatus;
  expectedFrames: number;
  hydratedFrames: number;
  coverage: number;
  fallbackBase: string | null;
  atlasReports: AtlasBootReport[];
  bridgeSnapshot: any;
  renderer: SpriteRendererReport;
  decoder: Ktx2DecoderTelemetry;
  generatedAt: number;
};

export type RuntimeTextureIndex = {
  exact: Map<string, any>;
  normalized: Map<string, any>;
};

export type HydratePassResult = {
  hydrated: number;
  coverage: number;
  sourceHits: Record<TextureSourceName, number>;
  missingSample: string[];
  status: SpriteHydrationStatus;
};

export type SpriteBridge = {
  loadAtlas?: (atlasPath: string, base: string, imagePath?: string, atlasData?: any) => Promise<any>;
  getAtlasTextures?: (atlasPath: string) => any;
  snapshot?: () => any;
  atlas?: Record<string, { textures?: Record<string, any> }>;
  runtimePool?: Record<string, any>;
};

export type PrefetchedAtlas = {
  base: string;
  atlasJsons: Record<string, any>;
  blobs: Map<string, Blob>;
};

export type CompressedAtlasEntry = {
  atlasPath: string;
  imagePath: string;
  data: any;
};

export type LoadTexturesResult = {
  atlasReports: AtlasBootReport[];
  compressedEntries: CompressedAtlasEntry[];
  expectedFrames: number;
  hydratedFrames: number;
  status: SpriteHydrationStatus;
  finalMode: AtlasLoaderMode | 'mixed' | 'unknown';
  loadMode: SpriteLoadMode;
  bridgeSnapshot: any;
  fallbackBase: string | null;
  decoder: Ktx2DecoderTelemetry;
};

export type PixiBundle = { app: any; renderer: any; version: string | null; runtimeHints?: any[] };
