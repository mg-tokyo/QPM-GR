import {
  getTextureSwapperState,
  getSvc,
  buildPreviewCanvas,
  getOriginalSpriteCanvas,
  parseAtlasKey,
  type TextureOverrideRule,
} from '../../../../features/standalone/textureSwapper';
import { t } from '../../../../i18n';
import { getRuleType } from '../types';
import type { SpriteCategory } from '../types';

export function renderPreviewHero(
  container: HTMLElement,
  spriteKey: string,
  rules: TextureOverrideRule[],
  previewSwapKey?: string,
): () => void {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex;align-items:center;justify-content:center;padding:8px 0;';
  const resultBox = buildPreviewBox(t('feature.gardenPainter.result'), rules.some(r => r.enabled) || !!previewSwapKey);
  wrap.appendChild(resultBox.wrapper);
  container.appendChild(wrap);

  const resultFrame = resultBox.frame;

  const refreshResult = (): void => {
    const svc = getSvc();
    if (!svc) return;
    const freshRules = getTextureSwapperState().rules.filter(r => r.targetSpriteKey === spriteKey);
    const hasRules = freshRules.some(r => r.enabled) || !!previewSwapKey;
    if (hasRules) {
      const merged = mergeRulesForPreview(spriteKey, freshRules, previewSwapKey);
      void buildPreviewCanvas(merged).then((resultCanvas) => {
        if (!resultFrame.isConnected) return;
        setPreviewCanvas(resultFrame, resultCanvas);
      });
    } else {
      void getOriginalSpriteCanvas(spriteKey).then((origCanvas) => {
        if (!resultFrame.isConnected) return;
        setPreviewCanvas(resultFrame, origCanvas);
      });
    }
  };

  refreshResult();
  return refreshResult;
}

function buildPreviewBox(label: string, glow: boolean): { wrapper: HTMLElement; frame: HTMLElement } {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:6px;';

  const frame = document.createElement('div');
  frame.style.cssText = [
    'width:112px;height:112px',
    'background:rgba(0,0,0,0.35)',
    'border-radius:12px',
    `border:1px solid ${glow ? 'var(--qpm-accent-focus)' : 'var(--qpm-accent-subtle)'}`,
    'display:flex;align-items:center;justify-content:center;overflow:hidden',
    glow ? 'box-shadow:0 0 24px var(--qpm-accent-subtle)' : '',
  ].join(';');

  const loading = document.createElement('div');
  loading.style.cssText = 'width:48px;height:48px;border-radius:8px;background:linear-gradient(110deg,var(--qpm-accent-tint) 30%,var(--qpm-accent-subtle) 50%,var(--qpm-accent-tint) 70%);background-size:200% 100%;animation:qpm-shimmer 1.5s ease-in-out infinite;';
  frame.appendChild(loading);

  const labelEl = document.createElement('div');
  labelEl.style.cssText = `font-size:9px;text-transform:uppercase;letter-spacing:0.5px;${glow ? 'color:var(--qpm-accent-hover);' : 'color:var(--qpm-text-muted);'}`;
  labelEl.textContent = label;

  wrapper.append(frame, labelEl);
  return { wrapper, frame };
}

function setPreviewCanvas(frame: HTMLElement, canvas: HTMLCanvasElement | null): void {
  frame.innerHTML = '';
  if (canvas) {
    canvas.style.cssText = 'max-width:104px;max-height:104px;image-rendering:pixelated;object-fit:contain;';
    frame.appendChild(canvas);
  } else {
    const na = document.createElement('div');
    na.style.cssText = 'font-size:10px;color:var(--qpm-text-muted);';
    na.textContent = 'N/A';
    frame.appendChild(na);
  }
}

export function resolveEffectiveSprite(
  spriteKey: string,
  rules: TextureOverrideRule[],
  previewSwapKey?: string,
): { category: SpriteCategory; id: string; mutations: string[] } {
  const { category, id } = parseAtlasKey(spriteKey);
  let effectiveCategory: SpriteCategory = category;
  let effectiveId = id;
  const mutations: string[] = [];

  const enabled = rules.filter(r => r.enabled);
  for (const r of enabled) {
    const rt = getRuleType(r);
    if (rt === 'swap' && r.source.librarySpriteKey) {
      const parsed = parseAtlasKey(r.source.librarySpriteKey);
      effectiveCategory = parsed.category;
      effectiveId = parsed.id;
    }
    if (rt === 'mutation' && r.cosmeticMutations?.length) {
      mutations.push(...r.cosmeticMutations);
    }
  }

  if (previewSwapKey && !previewSwapKey.startsWith('upload:')) {
    const parsed = parseAtlasKey(previewSwapKey);
    effectiveCategory = parsed.category;
    effectiveId = parsed.id;
  }

  return { category: effectiveCategory, id: effectiveId, mutations };
}

function mergeRulesForPreview(
  spriteKey: string,
  rules: TextureOverrideRule[],
  previewSwapKey?: string,
): Partial<TextureOverrideRule> {
  const { category, id } = parseAtlasKey(spriteKey);
  const enabled = rules.filter(r => r.enabled);
  const merged: Partial<TextureOverrideRule> = {
    targetSpriteKey: spriteKey,
    targetCategory: category,
    displayLabel: id,
    source: { type: 'library' },
    params: {},
  };
  for (const r of enabled) {
    const rt = getRuleType(r);
    if (rt === 'swap') {
      merged.source = { ...r.source };
    }
    if (rt === 'mutation' && r.cosmeticMutations) {
      merged.cosmeticMutations = r.cosmeticMutations;
    }
    if (r.params.alpha != null) merged.params!.alpha = r.params.alpha;
    if (r.params.tintColor) {
      merged.params!.tintColor = r.params.tintColor;
      if (r.params.tintAlpha != null) merged.params!.tintAlpha = r.params.tintAlpha;
    }
    if (r.params.scaleX != null) merged.params!.scaleX = r.params.scaleX;
    if (r.params.scaleY != null) merged.params!.scaleY = r.params.scaleY;
  }
  if (previewSwapKey) {
    if (previewSwapKey.startsWith('upload:')) {
      merged.source = { type: 'upload', uploadAssetId: previewSwapKey.slice(7) };
    } else {
      merged.source = { type: 'library', librarySpriteKey: previewSwapKey };
    }
  }
  return merged;
}
