import { t } from '../../i18n';
import { COLORS, COLOR_HEX, type CosmeticColor, type SlotType } from '../../features/bloblingCustomiser/types';
import type { PreviewHandle } from '../../features/bloblingCustomiser/avatarPreview';

const EMOTES = [
  { icon: '\u{1F44F}', type: 0, label: 'Clap' },
  { icon: '\u{1F602}', type: 1, label: 'Laugh' },
  { icon: '\u{1F621}', type: 2, label: 'Angry' },
  { icon: '\u{1F622}', type: 3, label: 'Cry' },
  { icon: '\u{2753}',  type: 4, label: 'Question' },
  { icon: '\u{2764}\u{FE0F}', type: 5, label: 'Love' },
] as const;

function buildColorGlow(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `radial-gradient(ellipse at center, rgba(${r},${g},${b},0.35) 0%, rgba(${r},${g},${b},0.15) 45%, rgba(${r},${g},${b},0) 75%)`;
}

export interface PreviewBoxHandle {
  canvas: HTMLCanvasElement;
  previewArea: HTMLElement;
  setPreviewHandle(handle: PreviewHandle | null): void;
  setDropHandler(handler: ((slot: SlotType, filename: string) => void) | null): void;
  updateColor(color: CosmeticColor): void;
  destroy(): void;
}

export function renderPreviewBox(
  container: HTMLElement,
  currentColor: CosmeticColor,
  onColorSelect: (color: CosmeticColor) => void,
): PreviewBoxHandle {
  let previewHandle: PreviewHandle | null = null;
  let dropHandler: ((slot: SlotType, filename: string) => void) | null = null;
  const MIME_TYPE = 'application/x-qpm-cosmetic';

  const previewArea = document.createElement('div');
  previewArea.style.cssText = 'position:relative;background:linear-gradient(180deg,rgba(143,130,255,0.03) 0%,rgba(143,130,255,0.06) 100%);border:1px solid rgba(143,130,255,0.12);border-radius:14px;width:100%;aspect-ratio:280/340;max-height:340px;display:flex;align-items:center;justify-content:center;overflow:hidden;';

  const dropOverlay = document.createElement('div');
  dropOverlay.style.cssText = 'position:absolute;inset:0;border-radius:var(--qpm-radius-lg);border:2px dashed var(--qpm-accent-emphasis);background:var(--qpm-accent-tint);pointer-events:none;opacity:0;transition:opacity 0.15s;z-index:20;display:flex;align-items:center;justify-content:center;';
  const dropLabel = document.createElement('div');
  dropLabel.style.cssText = 'font-size:var(--qpm-font-body);color:var(--qpm-accent);font-weight:var(--qpm-weight-semibold);';
  dropLabel.textContent = t('feature.bloblingCustomiser.dropToEquip');
  dropOverlay.appendChild(dropLabel);
  previewArea.appendChild(dropOverlay);

  previewArea.addEventListener('dragover', (e) => {
    if (!e.dataTransfer?.types.includes(MIME_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dropOverlay.style.opacity = '1';
  });
  previewArea.addEventListener('dragleave', (e) => {
    if (previewArea.contains(e.relatedTarget as Node)) return;
    dropOverlay.style.opacity = '0';
  });
  previewArea.addEventListener('drop', (e) => {
    e.preventDefault();
    dropOverlay.style.opacity = '0';
    const raw = e.dataTransfer?.getData(MIME_TYPE);
    if (!raw) return;
    try {
      const { slot, filename } = JSON.parse(raw) as { slot: SlotType; filename: string };
      dropHandler?.(slot, filename);
    } catch { /* malformed data */ }
  });

  const canvas = document.createElement('canvas');
  canvas.width = 280;
  canvas.height = 300;
  canvas.style.cssText = 'position:absolute;top:5.9%;left:50%;transform:translateX(-50%);pointer-events:none;width:clamp(140px,calc(100% - 96px),280px);aspect-ratio:280/300;height:auto;';
  previewArea.appendChild(canvas);

  const colorGlow = document.createElement('div');
  colorGlow.style.cssText = `position:absolute;bottom:11.8%;left:50%;transform:translateX(-50%);width:70%;max-width:196px;aspect-ratio:196/98;pointer-events:none;z-index:1;transition:background-image 0.3s;background-image:${buildColorGlow(COLOR_HEX[currentColor])};`;
  previewArea.appendChild(colorGlow);

  const emoteRow = document.createElement('div');
  emoteRow.style.cssText = 'position:absolute;bottom:3.5%;left:50%;transform:translateX(-50%);display:flex;gap:7px;';
  for (const emote of EMOTES) {
    const btn = document.createElement('div');
    btn.style.cssText = 'width:30px;height:30px;border-radius:50%;background:var(--qpm-accent-tint);border:1px solid var(--qpm-accent-border);display:flex;align-items:center;justify-content:center;font-size:var(--qpm-font-subtitle);cursor:pointer;transition:all 0.15s;';
    btn.textContent = emote.icon;
    btn.title = emote.label;
    btn.addEventListener('mouseenter', () => { btn.style.background = 'var(--qpm-accent-subtle)'; });
    btn.addEventListener('mouseleave', () => { btn.style.background = 'var(--qpm-accent-tint)'; });
    const emoteType = emote.type;
    btn.addEventListener('click', () => { previewHandle?.fireEmote(String(emoteType)); });
    emoteRow.appendChild(btn);
  }
  previewArea.appendChild(emoteRow);

  container.appendChild(previewArea);

  const colorRow = document.createElement('div');
  colorRow.style.cssText = 'display:flex;align-items:center;gap:var(--qpm-space-4);padding:var(--qpm-space-4) var(--qpm-space-5);background:rgba(255,255,255,0.015);border:1px solid var(--qpm-accent-tint);border-radius:var(--qpm-radius-md);margin-top:var(--qpm-space-4);';

  const colorLabel = document.createElement('span');
  colorLabel.style.cssText = 'font-size:var(--qpm-font-xs);color:rgba(224,224,224,0.3);font-weight:var(--qpm-weight-semibold);letter-spacing:0.5px;';
  colorLabel.textContent = t('feature.bloblingCustomiser.color').toUpperCase();
  colorRow.appendChild(colorLabel);

  const swatchContainer = document.createElement('div');
  swatchContainer.style.cssText = 'display:flex;gap:6px;flex:1;justify-content:center;';

  const swatchEls = new Map<CosmeticColor, HTMLElement>();
  for (const color of COLORS) {
    const swatch = document.createElement('div');
    const hex = COLOR_HEX[color];
    const isActive = color === currentColor;
    swatch.style.cssText = `width:24px;aspect-ratio:1;flex-shrink:1;min-width:12px;border-radius:50%;background:${hex};cursor:pointer;box-shadow:0 0 0 1px rgba(0,0,0,0.2);transition:all 0.15s;${isActive ? 'border:2.5px solid rgba(255,255,255,0.4);' : ''}`;
    if (color === 'Black') swatch.style.border = isActive ? '2.5px solid rgba(255,255,255,0.4)' : '1px solid rgba(255,255,255,0.15)';
    swatch.title = color;
    swatch.addEventListener('click', () => onColorSelect(color));
    swatchContainer.appendChild(swatch);
    swatchEls.set(color, swatch);
  }
  colorRow.appendChild(swatchContainer);
  container.appendChild(colorRow);

  function updateColor(color: CosmeticColor): void {
    for (const [c, el] of swatchEls) {
      if (c === color) {
        el.style.border = '2.5px solid rgba(255,255,255,0.4)';
      } else if (c === 'Black') {
        el.style.border = '1px solid rgba(255,255,255,0.15)';
      } else {
        el.style.border = 'none';
      }
    }
    colorGlow.style.backgroundImage = buildColorGlow(COLOR_HEX[color]);
  }

  return {
    canvas,
    previewArea,
    setPreviewHandle(handle: PreviewHandle | null): void {
      previewHandle = handle;
    },
    setDropHandler(handler: ((slot: SlotType, filename: string) => void) | null): void {
      dropHandler = handler;
    },
    updateColor,
    destroy(): void {
      previewHandle = null;
      dropHandler = null;
    },
  };
}
