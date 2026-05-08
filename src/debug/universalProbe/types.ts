export type ProbeSource = 'dom' | 'pixi';
export type ProbeTargetMode = 'action' | 'scene' | 'all';
export type ProbeBucket = 'containers' | 'targets' | 'hits';

export interface ProbeBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface PixiBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProbeRuntime {
  app: unknown | null;
  renderer: unknown | null;
  stage: unknown | null;
  canvas: HTMLCanvasElement | null;
  version: string | null;
  ready: boolean;
}

export interface ProbeLayout {
  pattern: string;
  inferredCols: number;
  inferredRows: number;
  regularity: number;
}

export interface ProbeCandidateBase {
  source: ProbeSource;
  kind: string;
  type: string;
  label: string;
  labelHint?: string;
  assetHint?: string;
  boundsCss: ProbeBounds;
  confidence: number;
  stableKey?: string;
  stableId?: number;
  stableTag?: string;
}

export interface ProbeContainerCandidate extends ProbeCandidateBase {
  kindGuess: string;
  childCount: number;
  layout?: ProbeLayout;
  node?: unknown;
  element?: Element;
}

export interface ProbeTargetCandidate extends ProbeCandidateBase {
  interactive: boolean;
  role?: string;
  childCount?: number;
  layout?: ProbeLayout;
  node?: unknown;
  element?: Element;
}

export interface ProbeHitCandidate extends ProbeTargetCandidate {
  depth: number;
  boundsPixi?: PixiBounds;
}

export interface ProbeSceneNode {
  id: number;
  node: unknown;
  depth: number;
  parentId: number;
  type: string;
  label: string;
  assetHint: string;
  pixiBounds: PixiBounds;
  cssRect: ProbeBounds;
  interactive: boolean;
  childCount: number;
}

export interface ProbeSceneIndex {
  nodes: ProbeSceneNode[];
  nodeById: Map<number, ProbeSceneNode>;
  childrenByParent: Map<number, ProbeSceneNode[]>;
  viewportArea: number;
}

export interface ProbeClickReport {
  clientX: number;
  clientY: number;
  pixiX: number | null;
  pixiY: number | null;
  domChain: ProbeTargetCandidate[];
  pixiHits: ProbeHitCandidate[];
  bestDomTarget: ProbeTargetCandidate | null;
  bestPixiTarget: ProbeHitCandidate | null;
}

export interface ProbeScanOptions {
  targetMode?: ProbeTargetMode;
  targetTopN?: number;
  onlyInteractive?: boolean;
  includeDomContainers?: boolean;
  suppressConsole?: boolean;
  clickReport?: ProbeClickReport | null;
}

export interface ProbeScanResult {
  runtime: Record<string, unknown>;
  containers: ProbeContainerCandidate[];
  targets: ProbeTargetCandidate[];
  clickReport: ProbeClickReport | null;
  timestamp: string;
}
