import type { AssignResult, KeybindAction, KeybindActionInfo, KeybindRegistry, KeybindRegistryDeps } from './types';

const MODIFIER_ORDER = ['ctrl', 'alt', 'shift'] as const;
const COMBO_SHAPE = /^((?:(?:ctrl|meta|alt|shift)\+)*)(.+)$/;

/** Canonical `ctrl+alt+shift+key` (the `normalizeKeybind` order, meta → ctrl); null for a modifier alone. */
export function normalizeCombo(raw: string): string | null {
  const match = COMBO_SHAPE.exec(raw.trim().toLowerCase());
  if (!match) return null;
  const key = match[2] ?? '';
  if (!key || /^(?:ctrl|meta|alt|shift)$/.test(key)) return null;
  const mods = new Set((match[1] ?? '').split('+').filter(Boolean).map(m => (m === 'meta' ? 'ctrl' : m)));
  return [...MODIFIER_ORDER.filter(m => mods.has(m)), key].join('+');
}

function toInfo(action: KeybindAction): KeybindActionInfo {
  const info: KeybindActionInfo = { id: action.id, section: action.section, combo: action.read(), canUnbind: action.canUnbind };
  if (action.teamId !== undefined) info.teamId = action.teamId;
  if (action.panelId !== undefined) info.panelId = action.panelId;
  return info;
}

export function createKeybindRegistry(deps: KeybindRegistryDeps): KeybindRegistry {
  const listeners = new Set<() => void>();
  let stopExternal: (() => void) | null = null;
  let writing = false;

  const emit = (): void => {
    for (const cb of [...listeners]) {
      try { cb(); } catch { /* a broken listener must not block the others */ }
    }
  };

  const write = (fn: () => void): void => {
    writing = true;
    try { fn(); } finally { writing = false; }
    emit();
  };

  const find = (id: string): { action: KeybindAction | undefined; all: KeybindAction[] } => {
    const all = deps.actions();
    return { action: all.find(a => a.id === id), all };
  };

  return {
    list: () => deps.actions().map(toInfo),

    assign(actionId, raw) {
      const { action, all } = find(actionId);
      if (!action) return { ok: false, reason: 'unknownAction' };
      const combo = normalizeCombo(raw);
      if (!combo) return { ok: false, reason: 'invalidCombo' };
      const game = deps.isGameHotkey(combo);
      if (game === true) return { ok: false, reason: 'gameKey' };
      const holders = all.filter(a => a.id !== action.id && a.holds(combo));
      const locked = holders.find(a => !a.canUnbind);
      if (locked) return { ok: false, reason: 'panelKey', heldBy: locked.id };
      const result: AssignResult = { ok: true, combo, movedFrom: holders.map(a => a.id), gameKeysUnread: game === null };
      if (action.read() === combo && holders.length === 0) return result;
      write(() => {
        for (const holder of holders) holder.clear();
        action.set(combo);
      });
      return result;
    },

    clear(actionId) {
      const { action } = find(actionId);
      if (!action) return false;
      write(() => action.clear());
      return true;
    },

    update: write,

    onChange(cb) {
      listeners.add(cb);
      if (!stopExternal && deps.watchExternal) {
        stopExternal = deps.watchExternal(() => { if (!writing) emit(); });
      }
      return () => {
        listeners.delete(cb);
        if (listeners.size === 0 && stopExternal) {
          stopExternal();
          stopExternal = null;
        }
      };
    },
  };
}
