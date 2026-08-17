import type { TowerId, UpgradeTier } from '../types';
import { type UpgradeSlot } from '../data/tierSlots';
import type { Binding, DesignLibraryEntry, MgSceneV1, TDCustomDesignsV1 } from './types';
import { loadStoredState, saveStoredState } from './persistence';
import { resolveDesignForTower, isValidSlotForKind } from './bindings';
import { PRESET_SCENES, presetIdFor } from '../data/presetScenes/manifest';
import { renderDesignThumbnail } from './thumbnail';

let state: TDCustomDesignsV1 | null = null;
// Presets live in-memory only. They refresh from the bundled manifest each
// session; nothing in storage tracks them. Blending happens in listLibrary()
// and resolveDesignForTower() so persistence stays user-owned.
let presetLibrary: readonly DesignLibraryEntry[] = [];
const libraryChangeSubs = new Set<() => void>();
const bindingChangeSubs = new Set<(changed?: { kind: TowerId; slot: UpgradeSlot }) => void>();

function ensureState(): TDCustomDesignsV1 {
  if (state === null) state = loadStoredState();
  return state;
}

function persist(): void { if (state) saveStoredState(state); }

function fireLibrary(): void {
  for (const cb of libraryChangeSubs) {
    try { cb(); } catch { /* subscriber best-effort */ }
  }
}

function fireBindings(cell?: { kind: TowerId; slot: UpgradeSlot }): void {
  for (const cb of bindingChangeSubs) {
    try { cb(cell); } catch { /* subscriber best-effort */ }
  }
}

function newId(): string {
  return `cd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildPresetLibrary(): readonly DesignLibraryEntry[] {
  const out: DesignLibraryEntry[] = [];
  for (const p of PRESET_SCENES) {
    const id = presetIdFor(p.kind, p.slot);
    let thumb = '';
    try { thumb = renderDesignThumbnail(p.scene); } catch { /* preset thumb best-effort; UI re-renders live from scene */ }
    out.push({
      id,
      name: p.scene.name ?? id,
      createdAt: 0,
      scene: p.scene,
      thumbnailDataUrl: thumb,
      builtIn: true,
    });
  }
  return out;
}

export function initTDCustomDesigns(): void {
  if (state !== null) return;
  state = loadStoredState();
  presetLibrary = buildPresetLibrary();
}

export function stopTDCustomDesigns(): void {
  state = null;
  presetLibrary = [];
  libraryChangeSubs.clear();
  bindingChangeSubs.clear();
}

export function listLibrary(): readonly DesignLibraryEntry[] {
  const s = ensureState();
  const userIds = new Set(s.library.map(l => l.id));
  const presetsMinusOverridden = presetLibrary.filter(p => !userIds.has(p.id));
  return [...s.library, ...presetsMinusOverridden];
}

export function addLibraryEntry(scene: MgSceneV1, thumbnailDataUrl: string, name?: string): string {
  const s = ensureState();
  const id = newId();
  const entry: DesignLibraryEntry = {
    id,
    name: name ?? scene.name ?? 'Untitled',
    createdAt: Date.now(),
    scene,
    thumbnailDataUrl,
  };
  s.library = [...s.library, entry];
  persist();
  fireLibrary();
  return id;
}

export function renameLibraryEntry(id: string, name: string): void {
  const s = ensureState();
  s.library = s.library.map(l => l.id === id ? { ...l, name } : l);
  persist();
  fireLibrary();
}

export function removeLibraryEntry(id: string): void {
  const s = ensureState();
  const beforeCount = s.bindings.length;
  s.library = s.library.filter(l => l.id !== id);
  s.bindings = s.bindings.filter(b => b.designId !== id);
  persist();
  fireLibrary();
  if (beforeCount !== s.bindings.length) fireBindings();
}

export function getDesign(kind: TowerId, upgA: UpgradeTier, upgB: UpgradeTier): DesignLibraryEntry | null {
  if (state === null) return null;
  return resolveDesignForTower(state.bindings, listLibrary(), kind, upgA, upgB);
}

export function setBinding(kind: TowerId, slot: UpgradeSlot, designId: string | null): void {
  if (!isValidSlotForKind(kind, slot)) return;
  const s = ensureState();
  s.bindings = s.bindings.filter(b => !(b.kind === kind && b.slot === slot));
  if (designId !== null) s.bindings = [...s.bindings, { kind, slot, designId }];
  persist();
  fireBindings({ kind, slot });
}

export function listBindings(): readonly Binding[] {
  return ensureState().bindings;
}

export function onLibraryChanged(cb: () => void): () => void {
  libraryChangeSubs.add(cb);
  return () => { libraryChangeSubs.delete(cb); };
}

export function onBindingsChanged(
  cb: (changed?: { kind: TowerId; slot: UpgradeSlot }) => void,
): () => void {
  bindingChangeSubs.add(cb);
  return () => { bindingChangeSubs.delete(cb); };
}
