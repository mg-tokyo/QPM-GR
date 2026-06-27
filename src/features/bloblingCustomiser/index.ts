import { readAtomValueSync } from '../../core/atomRegistry';
import { sendSetPlayerData } from '../../websocket/api';
import { notify } from '../../core/notifications';
import { fetchOwnedCosmetics, getCosmeticsBySlot } from './cosmeticApi';
import {
  SLOT_TYPES, SLOT_CONFIG, AVATAR_SLOT_INDEX, COLORS, COLOR_HEX,
  type SlotType, type CosmeticColor, type SessionState, type CarouselPosition, type CartItem,
  type CosmeticCatalogEntry,
} from './types';
import type { WebSocketSendResult } from '../../websocket/api';

export type { SlotType, CosmeticColor, SessionState, CartItem, CosmeticCatalogEntry };
export { SLOT_TYPES, SLOT_CONFIG, AVATAR_SLOT_INDEX, COLORS, COLOR_HEX };

let session: SessionState | null = null;
const changeListeners = new Set<() => void>();

function emitChange(): void {
  for (const cb of changeListeners) {
    try { cb(); } catch { /* swallow */ }
  }
}

export function onSessionChange(cb: () => void): () => void {
  changeListeners.add(cb);
  return () => { changeListeners.delete(cb); };
}

export function getSession(): SessionState | null {
  return session;
}

export function readCurrentOutfit(): { avatar: readonly string[]; color: string } {
  try {
    const player = readAtomValueSync('player');
    const cosmetic = player?.cosmetic as
      | { color?: string; avatar?: readonly string[] }
      | undefined;
    return {
      avatar: cosmetic?.avatar ?? [],
      color: cosmetic?.color ?? 'Red',
    };
  } catch {
    return { avatar: [], color: 'Red' };
  }
}

export function initSession(): SessionState {
  const owned = fetchOwnedCosmetics();
  const { avatar, color } = readCurrentOutfit();

  const carousel = {} as Record<SlotType, CarouselPosition>;
  const selectedSlots = {} as Record<SlotType, string | null>;

  for (const cfg of SLOT_CONFIG) {
    const items = getCosmeticsBySlot(cfg.type, owned);
    const equippedFilename = (avatar[cfg.avatarIndex] as string | undefined) ?? null;
    const equippedIndex = equippedFilename
      ? items.findIndex(i => i.filename === equippedFilename)
      : -1;

    carousel[cfg.type] = { index: Math.max(equippedIndex, 0), items };
    selectedSlots[cfg.type] = equippedFilename;
  }

  session = {
    selectedSlots,
    selectedColor: color as CosmeticColor,
    carousel,
    ownershipSet: owned,
    previewActive: false,
    previewEndTime: 0,
    purchaseInProgress: false,
  };

  emitChange();
  return session;
}

export function destroySession(): void {
  session = null;
  changeListeners.clear();
}

export function cycleSlot(slot: SlotType, direction: 1 | -1): CosmeticCatalogEntry | null {
  if (!session) return null;
  const pos = session.carousel[slot];
  if (!pos.items.length) return null;

  let next = pos.index + direction;
  if (next < 0) next = pos.items.length - 1;
  if (next >= pos.items.length) next = 0;

  pos.index = next;
  const entry = pos.items[next]!;
  session.selectedSlots[slot] = entry.filename;
  emitChange();
  return entry;
}

export function selectSlotByFilename(slot: SlotType, filename: string): CosmeticCatalogEntry | null {
  if (!session) return null;
  const pos = session.carousel[slot];
  const idx = pos.items.findIndex(i => i.filename === filename);
  if (idx < 0) return null;

  pos.index = idx;
  session.selectedSlots[slot] = filename;
  emitChange();
  return pos.items[idx]!;
}

export function getCurrentEntry(slot: SlotType): CosmeticCatalogEntry | null {
  if (!session) return null;
  const pos = session.carousel[slot];
  return pos.items[pos.index] ?? null;
}

export function selectColor(color: CosmeticColor): void {
  if (!session) return;
  session.selectedColor = color;
  emitChange();
}

export function resetToEquipped(): void {
  if (!session) return;
  const { avatar, color } = readCurrentOutfit();

  for (const cfg of SLOT_CONFIG) {
    const equippedFilename = (avatar[cfg.avatarIndex] as string | undefined) ?? null;
    const pos = session.carousel[cfg.type];
    const equippedIndex = equippedFilename
      ? pos.items.findIndex(i => i.filename === equippedFilename)
      : -1;
    pos.index = Math.max(equippedIndex, 0);
    session.selectedSlots[cfg.type] = equippedFilename;
  }

  session.selectedColor = color as CosmeticColor;
  emitChange();
}

export function getCart(): CartItem[] {
  if (!session) return [];
  const items: CartItem[] = [];
  for (const slot of SLOT_TYPES) {
    const filename = session.selectedSlots[slot];
    if (!filename) continue;
    if (session.ownershipSet.has(filename)) continue;
    const entry = session.carousel[slot].items.find(i => i.filename === filename);
    if (entry) items.push({ slot, entry });
  }
  return items;
}

export function getCartTotal(): number {
  return getCart().reduce((sum, item) => sum + item.entry.price, 0);
}

export function markOwned(filename: string): void {
  if (!session) return;
  session.ownershipSet.add(filename);
  emitChange();
}

export function equipOwnedSlots(): WebSocketSendResult {
  if (!session) return { ok: false, reason: 'invalid_payload' };

  const { avatar: current } = readCurrentOutfit();
  const avatar = SLOT_TYPES.map((slot, i) => {
    const filename = session!.selectedSlots[slot];
    if (filename && session!.ownershipSet.has(filename)) return filename;
    return (current[i] as string) ?? '';
  }) as [string, string, string, string];

  const color = session.selectedColor;
  const result = sendSetPlayerData({ cosmetic: { color, avatar } });

  if (result.ok) {
    notify({ feature: 'bloblingCustomiser', level: 'success', message: 'Outfit equipped!' });
  }
  return result;
}

export function equipFullOutfit(
  avatar: [string, string, string, string],
  color: CosmeticColor,
): WebSocketSendResult {
  const result = sendSetPlayerData({ cosmetic: { color, avatar } });
  if (result.ok) {
    notify({ feature: 'bloblingCustomiser', level: 'success', message: 'Outfit equipped!' });
  }
  return result;
}

// Apply a saved preset to the current session. Updates carousel positions,
// selectedSlots, and color via the existing session helpers. Does NOT send
// any WebSocket message and does NOT start the in-world preview — the user
// still has to click Equip or Preview after.
export function applyPresetToSession(
  slots: Record<SlotType, string | null>,
  color: CosmeticColor,
): void {
  if (!session) return;
  for (const slot of SLOT_TYPES) {
    const filename = slots[slot];
    if (filename) selectSlotByFilename(slot, filename);
  }
  selectColor(color);
}
