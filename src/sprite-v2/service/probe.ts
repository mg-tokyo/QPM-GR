import type { SpriteService } from '../types';
import { getRuntimeWindow } from '../detector';
import type { SpriteProbeInput, SpriteProbeResult } from './types';
import { ctxRef } from './state';

function normalizeProbeInput(input: SpriteProbeInput): {
  input: string;
  category: string;
  id: string;
  mutations: string[];
} {
  if (typeof input === 'string') {
    const raw = input.trim();
    if (!raw) {
      return { input: String(input), category: 'any', id: '', mutations: [] };
    }
    return { input: raw, category: 'any', id: raw, mutations: [] };
  }

  const key = String(input.key ?? '').trim();
  if (key) {
    return {
      input: key,
      category: String(input.category ?? 'any'),
      id: key,
      mutations: Array.isArray(input.mutations) ? input.mutations.map((m) => String(m)).filter(Boolean) : [],
    };
  }

  const category = String(input.category ?? 'any').trim() || 'any';
  const id = String(input.id ?? '').trim();
  return {
    input: `${category}:${id}`,
    category,
    id,
    mutations: Array.isArray(input.mutations) ? input.mutations.map((m) => String(m)).filter(Boolean) : [],
  };
}

export function spriteProbe(inputs?: SpriteProbeInput[]): SpriteProbeResult[] {
  const probeInputs: SpriteProbeInput[] = inputs && inputs.length
    ? inputs
    : [
        'sprite/ui/Coin',
        'sprite/pet/Worm',
        'sprite/plant/Sunflower',
        'sprite/seed/Sunflower',
        'sprite/mutation/Rainbow',
        'sprite/mutation-overlay/FrozenTallPlant',
      ];

  if (!ctxRef.current?.state) {
    return probeInputs.map((value) => {
      const normalized = normalizeProbeInput(value);
      return {
        input: normalized.input,
        category: normalized.category,
        id: normalized.id,
        mutations: normalized.mutations,
        ok: false,
        width: 0,
        height: 0,
        error: 'sprite-context-not-initialized',
      };
    });
  }

  const service = (getRuntimeWindow() as any).__MG_SPRITE_SERVICE__ as SpriteService | undefined;
  if (!service) {
    return probeInputs.map((value) => {
      const normalized = normalizeProbeInput(value);
      return {
        input: normalized.input,
        category: normalized.category,
        id: normalized.id,
        mutations: normalized.mutations,
        ok: false,
        width: 0,
        height: 0,
        error: 'sprite-service-not-available',
      };
    });
  }

  return probeInputs.map((value) => {
    const normalized = normalizeProbeInput(value);
    try {
      const canvas = service.renderToCanvas({
        category: normalized.category as any,
        id: normalized.id,
        mutations: normalized.mutations,
      });
      return {
        input: normalized.input,
        category: normalized.category,
        id: normalized.id,
        mutations: normalized.mutations,
        ok: Boolean(canvas),
        width: canvas?.width ?? 0,
        height: canvas?.height ?? 0,
      };
    } catch (error) {
      return {
        input: normalized.input,
        category: normalized.category,
        id: normalized.id,
        mutations: normalized.mutations,
        ok: false,
        width: 0,
        height: 0,
        error: String((error as Error)?.message ?? error),
      };
    }
  });
}
