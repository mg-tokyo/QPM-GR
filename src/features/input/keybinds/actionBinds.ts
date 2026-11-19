// Keys for actions INP-1 added (game panels, QPM windows, later team cycling). Existing binds keep their own
// storage (D1); these start unbound (D5).

import { storage } from '../../../utils/storage';

const STORAGE_KEY = 'qpm.keybinds.actions.v1';

interface ActionBindState {
  binds: Record<string, string>;
}

function load(): Record<string, string> {
  const raw = storage.get<ActionBindState | null>(STORAGE_KEY, null);
  const binds = raw && typeof raw === 'object' && raw.binds && typeof raw.binds === 'object' ? raw.binds : {};
  const out: Record<string, string> = {};
  for (const [id, combo] of Object.entries(binds)) {
    if (typeof combo === 'string' && combo !== '') out[id] = combo;
  }
  return out;
}

function save(binds: Record<string, string>): void {
  storage.set(STORAGE_KEY, { binds } satisfies ActionBindState);
}

export function getActionBinds(): Record<string, string> {
  return load();
}

export function getActionBind(actionId: string): string {
  return load()[actionId] ?? '';
}

/** One action per combo inside this store too: an action listed only later (panel list unread) cannot keep it. */
export function setActionBind(actionId: string, combo: string): void {
  const binds = load();
  for (const [id, held] of Object.entries(binds)) {
    if (held === combo) delete binds[id];
  }
  binds[actionId] = combo;
  save(binds);
}

export function clearActionBind(actionId: string): void {
  const binds = load();
  if (!(actionId in binds)) return;
  delete binds[actionId];
  save(binds);
}
