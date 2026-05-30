import type { SpriteCategory, SpriteService } from '../../../sprite-v2/types';
import { serviceReady } from '../../../sprite-v2/compat';
import type { SpriteKey } from './constants';

export const inspectorState = {
  targetPlayerId: null as string | null,
  targetPlayerName: '',
  targetRoomId: '',
};

export const inspectorDragCleanups: Array<() => void> = [];

export const spriteReadyPromise = serviceReady;
export let spriteService: SpriteService | null = null;
export const spriteNameLookup = new Map<string, SpriteKey[]>();
export const spriteUrlCache = new Map<string, string>();

export function setSpriteService(svc: SpriteService | null): void {
  spriteService = svc;
}

export function normalizeSpriteLookupKey(name: string): string {
  return String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function addSpriteLookup(name: string, entry: SpriteKey): void {
  const key = normalizeSpriteLookupKey(name);
  const arr = spriteNameLookup.get(key) ?? [];
  arr.push(entry);
  spriteNameLookup.set(key, arr);
}

// Module-level side effect: populate sprite lookup when service is ready
void spriteReadyPromise.then((svc) => {
  setSpriteService(svc);
  if (!svc) return;
  const cats: SpriteCategory[] = ['item', 'decor', 'seed', 'plant', 'tallplant', 'crop', 'pet'];
  cats.forEach((cat) => {
    try {
      svc.list(cat).forEach((it) => {
        const parts = String(it.key || '').split('/');
        const id = parts[parts.length - 1] || it.key;
        addSpriteLookup(id, { category: cat, id });
      });
    } catch {
      // ignore
    }
  });
});
