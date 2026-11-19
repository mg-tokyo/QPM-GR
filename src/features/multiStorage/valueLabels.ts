// One storage-value label per open panel (decision D1), under the game's count strap as in the single storage
// window. A child of the panel's host, so it moves, stacks and closes with its panel.
import { getStoragePanelIds } from '../../catalogs/logic/gamePanelsCatalog';
import { formatStorageValue, onStorageValueInputsChange, readStorageValue } from '../economy/storageValueById';
import { renderBySpriteKey } from '../../sprite-v2/compat';
import { panelRootZ } from './storageChrome';
import { destroyArtSprite, findSpriteKit, makeArtSprite, paint, setArt, type ArtSprite, type SpriteKit } from './chromeArt';
import { panelIdFor, type PixiNode, type StorageViewLike } from './gameHooks';

export interface ValuePanel {
  readonly storageId: string;
  readonly host: PixiNode;
  view(): StorageViewLike | null;
}

export interface ValueLabels {
  sync(): void;
  dispose(): void;
  describe(): Array<Record<string, unknown>>;
}

interface Label {
  panel: ValuePanel;
  panelId: string | null;
  sprite: ArtSprite;
  /** Null: this storage has no value label. */
  text: string | null;
  painted: string;
  width: number;
  height: number;
}

const COIN_SPRITE_KEY = 'sprite/ui/Coin';
const FONT_PX = 14;
const COIN_PX = 18;
const GAP_PX = 5;
const PAD_PX = 2;
const STRAP_GAP_PX = 2;
// The single storage window's label colours (src/ui/economy/storageValueOverlay.ts buildOverlay).
const GOLD = '#f5c518';
const OUTLINE = 'rgba(0, 0, 0, 0.5)';
const OUTLINE_OFFSETS: ReadonlyArray<readonly [number, number]> = [[-1, -1], [1, -1], [-1, 1], [1, 1]];

function paintLabel(text: string, coin: HTMLCanvasElement | null): { canvas: HTMLCanvasElement; width: number; height: number } | null {
  const font = `700 ${FONT_PX}px ${getComputedStyle(document.body).fontFamily || 'sans-serif'}`;
  const measure = document.createElement('canvas').getContext('2d');
  if (!measure) return null;
  measure.font = font;
  const textWidth = Math.ceil(measure.measureText(text).width);
  const coinWidth = coin ? COIN_PX + GAP_PX : 0;
  const width = PAD_PX * 2 + coinWidth + textWidth;
  const height = PAD_PX * 2 + COIN_PX;
  const canvas = paint(width, height, (ctx) => {
    if (coin) ctx.drawImage(coin, PAD_PX, PAD_PX, COIN_PX, COIN_PX);
    ctx.font = font;
    ctx.textBaseline = 'middle';
    const x = PAD_PX + coinWidth;
    const y = height / 2;
    ctx.fillStyle = OUTLINE;
    for (const [dx, dy] of OUTLINE_OFFSETS) ctx.fillText(text, x + dx, y + dy);
    ctx.fillStyle = GOLD;
    ctx.fillText(text, x, y);
  });
  return canvas ? { canvas, width, height } : null;
}

/** Null when the game's sprite class is not reachable inside the panels; the panels work without labels. */
export function createValueLabels(panels: readonly ValuePanel[]): ValueLabels | null {
  const kit: SpriteKit | null = findSpriteKit(panels.map(p => p.host));
  if (!kit) return null;
  const panelIds = getStoragePanelIds() ?? [];
  let coin: HTMLCanvasElement | null = null;
  let dirty = true;
  let disposed = false;
  const off = onStorageValueInputsChange(() => { dirty = true; });

  const labels: Label[] = panels.map((panel) => {
    // Above the panel and its grip; it never takes input.
    const sprite = makeArtSprite(kit, 'MultiStorageValue', 'default', panelRootZ(panel.host) + 0.6);
    sprite.eventMode = 'none';
    panel.host.addChild(sprite);
    return { panel, panelId: panelIdFor(panel.storageId, panelIds), sprite, text: null, painted: '', width: 0, height: 0 };
  });

  const refresh = (): void => {
    dirty = false;
    coin ??= renderBySpriteKey(COIN_SPRITE_KEY);
    for (const label of labels) {
      const reading = label.panelId ? readStorageValue(label.panel.storageId, label.panelId) : null;
      label.text = reading === null ? null : reading.status === 'loading' ? '—' : formatStorageValue(reading.value);
    }
  };

  const place = (label: Label): boolean => {
    const sheet = label.panel.view()?.itemSheet;
    const body = sheet?.body;
    const button = sheet?.strap?.button;
    if (label.text === null || !body || body.destroyed || !button || button.destroyed || !button.visible) return false;
    const key = `${label.text}|${coin ? 1 : 0}`;
    if (key !== label.painted) {
      const art = paintLabel(label.text, coin);
      if (!art || !setArt(kit, label.sprite, art.canvas, art.width, art.height)) return false;
      label.painted = key;
      label.width = art.width;
      label.height = art.height;
    }
    label.sprite.position.set(
      Math.round(body.x + button.x + button.width / 2 - label.width / 2),
      Math.round(body.y + button.y + button.height + STRAP_GAP_PX),
    );
    return true;
  };

  const sync = (): void => {
    if (disposed) return;
    if (dirty) refresh();
    for (const label of labels) {
      if (label.panel.host.destroyed || label.sprite.destroyed) continue;
      label.sprite.visible = place(label);
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    off();
    for (const label of labels) {
      try { destroyArtSprite(kit, label.sprite); } catch { /* torn down with the renderer */ }
    }
  };

  const describe = (): Array<Record<string, unknown>> => labels.map(label => ({
    storageId: label.panel.storageId,
    panelId: label.panelId,
    text: label.text,
    visible: label.sprite.visible && !label.sprite.destroyed,
    at: { x: label.sprite.x, y: label.sprite.y, w: label.width, h: label.height },
  }));

  return { sync, dispose, describe };
}
