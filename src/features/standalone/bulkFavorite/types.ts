export interface ProduceGroup {
  species: string;
  itemIds: string[];
  allLocked: boolean;
}

export interface BulkFavoriteConfig {
  enabled: boolean;
}

export type SidebarPlacement = 'right' | 'top';

export interface Rect {
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

export interface InventoryAnchor {
  rect: Rect;
  source: 'InventoryItems' | 'InventoryContent';
}

export interface SidebarLayout {
  placement: SidebarPlacement;
  left: number;
  top: number;
  maxHeight: number;
  maxWidth?: number;
}

export interface PixiDisplayObject {
  label?: unknown;
  children?: PixiDisplayObject[];
  getBounds?: () => unknown;
  visible?: unknown;
  renderable?: unknown;
  worldVisible?: unknown;
  alpha?: unknown;
  worldAlpha?: unknown;
}

export interface PixiRendererLike {
  screen?: { width?: number; height?: number };
  view?: unknown;
  canvas?: unknown;
}

export interface PixiAppLike {
  stage?: PixiDisplayObject;
  renderer?: PixiRendererLike;
}

export interface PixiCaptureLike {
  app?: PixiAppLike;
  renderer?: PixiRendererLike;
}

export interface PixiNodeMatch {
  node: PixiDisplayObject;
  bounds: PixiBounds;
  area: number;
}
