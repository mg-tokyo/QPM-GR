import { getPetMetadata } from './data/petMetadata';
import { getFavoritedItemIds, getInventoryItems, readInventoryDirect, type InventoryItem } from '../../store/inventory';
import { calculateMaxStrength } from '../../store/xpTracker';
import { getPetSpriteDataUrlWithMutations } from '../../sprite-v2/compat';
import { storage } from '../../utils/storage';
import { log } from '../../utils/logger';
import { delay } from '../../utils/scheduling/scheduling';
import { isRecord } from '../../utils/typeGuards';
import { sendRoomAction } from '../../websocket/api';
import { ensureJournalLogged } from '../journal/guard';

export type SellAllPetsRunStatus = 'success' | 'partial' | 'noop' | 'cancelled' | 'busy' | 'failed';

export interface SellAllPetsProtectionRules {
  enabled: boolean;
  protectGold: boolean;
  protectRainbow: boolean;
  protectMaxStr: boolean;
  maxStrThreshold: number;
  protectedRarities: string[];
}

export interface SellAllPetsSettings {
  keybind: string;
  protections: SellAllPetsProtectionRules;
}

export interface SellAllPetsRunResult {
  status: SellAllPetsRunStatus;
  totalCandidates: number;
  flaggedCount: number;
  soldCount: number;
  failedCount: number;
  message: string;
}

interface SellablePet {
  id: string;
  species: string | null;
  name: string | null;
  mutations: string[];
  targetScale: number | null;
  rarity: string | null;
  maxStrength: number | null;
}

interface FlaggedPet {
  pet: SellablePet;
  reasons: string[];
}

const STORAGE_KEY = 'qpm.petTeams.sellAllPets.v1';
const CONFIRM_MODAL_ID = 'qpm-sell-all-pets-confirm';
const SELL_DELAY_MS = 40;
const VALID_RARITIES = ['Common', 'Uncommon', 'Rare', 'Legendary', 'Mythical', 'Divine', 'Celestial'] as const;

export const SELL_ALL_PET_RARITY_OPTIONS = [...VALID_RARITIES];

const DEFAULT_PROTECTIONS: SellAllPetsProtectionRules = {
  enabled: true,
  protectGold: true,
  protectRainbow: true,
  protectMaxStr: true,
  maxStrThreshold: 95,
  protectedRarities: [],
};

const DEFAULT_SETTINGS: SellAllPetsSettings = {
  keybind: '',
  protections: { ...DEFAULT_PROTECTIONS },
};

let settings: SellAllPetsSettings = loadSettings();
let running = false;

function toString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function sanitizeRarities(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string') continue;
    const match = VALID_RARITIES.find((rarity) => rarity.toLowerCase() === entry.toLowerCase());
    if (!match) continue;
    if (!out.includes(match)) out.push(match);
  }
  return out;
}

function sanitizeProtections(raw: unknown): SellAllPetsProtectionRules {
  if (!isRecord(raw)) return { ...DEFAULT_PROTECTIONS };
  const threshold = toNumber(raw.maxStrThreshold);
  return {
    enabled: raw.enabled !== false,
    protectGold: raw.protectGold !== false,
    protectRainbow: raw.protectRainbow !== false,
    protectMaxStr: raw.protectMaxStr !== false,
    maxStrThreshold: threshold == null ? DEFAULT_PROTECTIONS.maxStrThreshold : Math.max(0, Math.min(100, Math.round(threshold))),
    protectedRarities: sanitizeRarities(raw.protectedRarities),
  };
}

function sanitizeSettings(raw: unknown): SellAllPetsSettings {
  if (!isRecord(raw)) return { ...DEFAULT_SETTINGS, protections: { ...DEFAULT_PROTECTIONS } };
  const keybind = toString(raw.keybind)?.toLowerCase() ?? '';
  return {
    keybind,
    protections: sanitizeProtections(raw.protections),
  };
}

function loadSettings(): SellAllPetsSettings {
  return sanitizeSettings(storage.get<unknown>(STORAGE_KEY, DEFAULT_SETTINGS));
}

function persistSettings(): void {
  storage.set(STORAGE_KEY, settings);
}

export function getSellAllPetsSettings(): SellAllPetsSettings {
  return {
    keybind: settings.keybind,
    protections: {
      ...settings.protections,
      protectedRarities: [...settings.protections.protectedRarities],
    },
  };
}

export function getSellAllPetsKeybind(): string {
  return settings.keybind;
}

export function setSellAllPetsKeybind(combo: string): void {
  const normalized = toString(combo)?.toLowerCase() ?? '';
  if (settings.keybind === normalized) return;
  settings = { ...settings, keybind: normalized };
  persistSettings();
}

export function setSellAllPetsProtectionRules(next: Partial<SellAllPetsProtectionRules>): void {
  const merged: SellAllPetsProtectionRules = {
    ...settings.protections,
    ...next,
  };
  const sanitized = sanitizeProtections(merged);
  settings = {
    ...settings,
    protections: sanitized,
  };
  persistSettings();
}

export function isSellAllPetsRunning(): boolean {
  return running;
}

function readMutations(raw: unknown): string[] {
  const candidates: unknown[] = [];
  if (isRecord(raw)) {
    candidates.push(raw.mutations);
    candidates.push(isRecord(raw.pet) ? raw.pet.mutations : undefined);
  }
  const out: string[] = [];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    for (const value of candidate) {
      const mutation = toString(value);
      if (!mutation) continue;
      out.push(mutation);
    }
  }
  return out;
}

function readTargetScale(raw: unknown): number | null {
  if (!isRecord(raw)) return null;
  return (
    toNumber(raw.targetScale)
    ?? (isRecord(raw.pet) ? toNumber(raw.pet.targetScale) : null)
    ?? (isRecord(raw.pet) ? toNumber(raw.pet.scale) : null)
    ?? toNumber(raw.scale)
  );
}

function readStrength(item: InventoryItem): number | null {
  return (
    toNumber(item.strength)
    ?? (isRecord(item.raw) ? toNumber(item.raw.strength) : null)
    ?? (isRecord(item.raw) && isRecord(item.raw.pet) ? toNumber(item.raw.pet.strength) : null)
  );
}

function isPet(item: InventoryItem): boolean {
  const itemType = toString(item.itemType)?.toLowerCase()
    ?? (isRecord(item.raw) ? toString(item.raw.itemType)?.toLowerCase() : null)
    ?? '';
  if (itemType === 'pet') return true;
  if (isRecord(item.raw) && toString(item.raw.petSpecies)) return true;
  return false;
}

function toSellablePet(item: InventoryItem): SellablePet | null {
  if (!isPet(item)) return null;
  const raw = item.raw;
  const species = toString(item.species)
    ?? (isRecord(raw) ? toString(raw.petSpecies) : null)
    ?? null;
  const name = toString(item.name)
    ?? toString(item.displayName)
    ?? (isRecord(raw) ? toString(raw.name) : null)
    ?? null;
  const mutations = readMutations(raw);
  const targetScale = readTargetScale(raw);
  const computedMax = species ? calculateMaxStrength(targetScale, species) : null;
  const strength = readStrength(item);
  const maxStrength = computedMax ?? strength;
  const rarity = species ? (getPetMetadata(species)?.rarity ?? null) : null;

  return {
    id: item.id,
    species,
    name,
    mutations,
    targetScale,
    rarity,
    maxStrength: maxStrength == null ? null : Math.round(maxStrength),
  };
}

async function getSellCandidates(): Promise<SellablePet[]> {
  const direct = await readInventoryDirect();
  const items = direct?.items?.length ? direct.items : getInventoryItems();
  const favorites = new Set(
    direct?.favoritedItemIds?.length
      ? direct.favoritedItemIds
      : Array.from(getFavoritedItemIds()),
  );

  const out: SellablePet[] = [];
  for (const item of items) {
    if (!item?.id || favorites.has(item.id)) continue;
    const pet = toSellablePet(item);
    if (!pet) continue;
    out.push(pet);
  }
  return out;
}

function evaluateFlaggedPets(candidates: SellablePet[], rules: SellAllPetsProtectionRules): FlaggedPet[] {
  if (!rules.enabled) return [];
  const protectedRarities = new Set((rules.protectedRarities ?? []).map((value) => value.toLowerCase()));
  const threshold = Math.max(0, Math.min(100, Math.round(rules.maxStrThreshold)));

  const flagged: FlaggedPet[] = [];
  for (const pet of candidates) {
    const reasons: string[] = [];
    const mutations = pet.mutations.map((value) => value.toLowerCase());
    if (rules.protectGold && mutations.some((value) => value.includes('gold'))) {
      reasons.push('Mutation: Gold');
    }
    if (rules.protectRainbow && mutations.some((value) => value.includes('rainbow'))) {
      reasons.push('Mutation: Rainbow');
    }
    if (rules.protectMaxStr && typeof pet.maxStrength === 'number' && pet.maxStrength >= threshold) {
      reasons.push(`Max STR: ${pet.maxStrength}`);
    }
    if (pet.rarity && protectedRarities.has(pet.rarity.toLowerCase())) {
      reasons.push(`Rarity: ${pet.rarity}`);
    }
    if (!reasons.length) continue;
    flagged.push({ pet, reasons });
  }

  return flagged;
}

function buildFallbackMonogram(pet: SellablePet): string {
  const label = pet.species ?? pet.name ?? 'Pet';
  const compact = label.replace(/[^a-zA-Z0-9]/g, '').slice(0, 2).toUpperCase();
  return compact || 'PT';
}

function createConfirmRow(entry: FlaggedPet): HTMLElement {
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:42px 1fr;gap:10px;align-items:center;padding:6px 8px;border:1px solid rgba(255,255,255,0.08);border-radius:10px;background:rgba(255,255,255,0.03);';

  const iconWrap = document.createElement('div');
  iconWrap.style.cssText = 'width:42px;height:42px;border-radius:10px;background:rgba(255,255,255,0.08);display:flex;align-items:center;justify-content:center;overflow:hidden;';

  if (entry.pet.species) {
    try {
      const image = document.createElement('img');
      image.src = getPetSpriteDataUrlWithMutations(entry.pet.species, entry.pet.mutations);
      image.alt = entry.pet.species;
      image.style.cssText = 'width:42px;height:42px;image-rendering:pixelated;object-fit:contain;';
      iconWrap.appendChild(image);
    } catch {
      const fallback = document.createElement('div');
      fallback.textContent = buildFallbackMonogram(entry.pet);
      fallback.style.cssText = 'font-size:12px;font-weight:700;';
      iconWrap.appendChild(fallback);
    }
  } else {
    const fallback = document.createElement('div');
    fallback.textContent = buildFallbackMonogram(entry.pet);
    fallback.style.cssText = 'font-size:12px;font-weight:700;';
    iconWrap.appendChild(fallback);
  }

  const info = document.createElement('div');
  info.style.cssText = 'display:grid;gap:4px;';

  const name = document.createElement('div');
  name.textContent = entry.pet.name ? `${entry.pet.name}${entry.pet.species ? ` (${entry.pet.species})` : ''}` : (entry.pet.species ?? 'Pet');
  name.style.cssText = 'font-size:13px;font-weight:700;color:#ffffff;';

  const reasons = document.createElement('div');
  reasons.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;';
  for (const reason of entry.reasons) {
    const chip = document.createElement('span');
    chip.textContent = reason;
    chip.style.cssText = 'font-size:11px;padding:2px 6px;border-radius:999px;background:rgba(122,162,255,0.2);border:1px solid rgba(122,162,255,0.4);color:#dbe7ff;';
    reasons.appendChild(chip);
  }

  info.append(name, reasons);
  row.append(iconWrap, info);
  return row;
}

function showProtectionConfirmModal(flagged: FlaggedPet[]): Promise<boolean> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve(false);
      return;
    }

    const existing = document.getElementById(CONFIRM_MODAL_ID);
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = CONFIRM_MODAL_ID;
    overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.62);';

    const card = document.createElement('div');
    card.style.cssText = 'min-width:320px;max-width:540px;max-height:min(78vh,680px);background:#0f1318;color:#ffffff;border:1px solid rgba(255,255,255,0.16);border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,0.45);padding:18px 20px;display:grid;gap:12px;';

    const title = document.createElement('div');
    title.textContent = 'Confirm sell all pets';
    title.style.cssText = 'font-size:18px;font-weight:800;';

    const desc = document.createElement('div');
    desc.textContent = 'Protected pets were detected by your safety rules:';
    desc.style.cssText = 'font-size:13px;opacity:0.92;line-height:1.4;';

    const list = document.createElement('div');
    list.style.cssText = 'display:grid;gap:8px;max-height:320px;overflow:auto;padding-right:4px;';
    for (const item of flagged) {
      list.appendChild(createConfirmRow(item));
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;justify-content:flex-end;gap:8px;';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.22);background:transparent;color:#ffffff;cursor:pointer;';

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.textContent = 'Sell';
    confirmBtn.style.cssText = 'padding:8px 14px;border-radius:10px;border:1px solid rgba(122,162,255,0.7);background:#1a2644;color:#ffffff;cursor:pointer;font-weight:700;';

    let settled = false;
    const close = (accepted: boolean): void => {
      if (settled) return;
      settled = true;
      try { overlay.remove(); } catch {}
      document.removeEventListener('keydown', onKeyDown, true);
      resolve(accepted);
    };

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close(false);
    };

    cancelBtn.addEventListener('click', () => close(false));
    confirmBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false);
    });

    actions.append(cancelBtn, confirmBtn);
    card.append(title, desc, list, actions);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown, true);
    confirmBtn.focus();
  });
}

export async function runSellAllPets(): Promise<SellAllPetsRunResult> {
  if (running) {
    return {
      status: 'busy',
      totalCandidates: 0,
      flaggedCount: 0,
      soldCount: 0,
      failedCount: 0,
      message: 'Sell all pets is already running.',
    };
  }

  running = true;
  try {
    const candidates = await getSellCandidates();
    if (!candidates.length) {
      return {
        status: 'noop',
        totalCandidates: 0,
        flaggedCount: 0,
        soldCount: 0,
        failedCount: 0,
        message: 'No non-favorited inventory pets found.',
      };
    }

    const rules = settings.protections;
    const flagged = evaluateFlaggedPets(candidates, rules);
    if (flagged.length > 0) {
      const confirmed = await showProtectionConfirmModal(flagged);
      if (!confirmed) {
        return {
          status: 'cancelled',
          totalCandidates: candidates.length,
          flaggedCount: flagged.length,
          soldCount: 0,
          failedCount: 0,
          message: 'Sell all pets cancelled.',
        };
      }
    }

    await ensureJournalLogged(candidates);

    let soldCount = 0;
    let failedCount = 0;
    for (const pet of candidates) {
      const sent = sendRoomAction('SellPet', { itemId: pet.id }, { throttleMs: 0, skipThrottle: true });
      if (sent.ok) {
        soldCount += 1;
      } else {
        failedCount += 1;
        log(`[SellAllPets] Failed to send SellPet (${pet.id})`, sent.reason);
      }
      await delay(SELL_DELAY_MS);
    }

    const status: SellAllPetsRunStatus = failedCount === 0 ? 'success' : (soldCount > 0 ? 'partial' : 'failed');
    const message = status === 'success'
      ? `Sold ${soldCount} pet${soldCount === 1 ? '' : 's'}.`
      : status === 'partial'
        ? `Sold ${soldCount} pets, ${failedCount} failed.`
        : `Failed to sell ${candidates.length} pets.`;

    return {
      status,
      totalCandidates: candidates.length,
      flaggedCount: flagged.length,
      soldCount,
      failedCount,
      message,
    };
  } catch (error) {
    log('[SellAllPets] Execution failed', error);
    return {
      status: 'failed',
      totalCandidates: 0,
      flaggedCount: 0,
      soldCount: 0,
      failedCount: 0,
      message: 'Sell all pets failed unexpectedly.',
    };
  } finally {
    running = false;
  }
}
