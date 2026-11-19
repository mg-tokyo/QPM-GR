export type KeybindSection = 'general' | 'windows' | 'shops' | 'gamePanels' | 'tools' | 'myItems' | 'pets';

/** An action INP-1 added: its key lives in `actionBinds`, the dispatcher runs it. */
export interface RunnableAction {
  id: string;
  section: KeybindSection;
  panelId?: string;
  run(): Promise<void>;
}

export interface KeybindAction {
  id: string;                      // e.g. 'panel', 'shop:seedShop', 'feed:0', 'team:<teamId>', 'sellAll', 'bag', 'panel:seedSilo'
  section: KeybindSection;
  teamId?: string;
  panelId?: string;                // the game's panel id for 'panel:<id>' actions
  /** false: the action always keeps a key (the panel toggle); its combo cannot be taken. */
  canUnbind: boolean;
  read(): string;                  // '' = no key
  holds(combo: string): boolean;
  set(combo: string): void;
  clear(): void;
}

export interface KeybindActionInfo {
  id: string;
  section: KeybindSection;
  teamId?: string;
  panelId?: string;
  combo: string;
  canUnbind: boolean;
}

export type AssignRefusal = 'unknownAction' | 'invalidCombo' | 'gameKey' | 'panelKey';

export type AssignResult =
  | { ok: true; combo: string; movedFrom: string[]; gameKeysUnread: boolean }
  | { ok: false; reason: AssignRefusal; heldBy?: string };

export interface KeybindRegistryDeps {
  actions(): KeybindAction[];
  /** true = the game uses this combo, null = the game's keys are not read. */
  isGameHotkey(combo: string): boolean | null;
  /** Watches binds changed outside the registry; returns its cleanup. */
  watchExternal?(fire: () => void): () => void;
}

export interface KeybindRegistry {
  list(): KeybindActionInfo[];
  assign(actionId: string, combo: string): AssignResult;
  clear(actionId: string): boolean;
  /** Runs a bind-related write (e.g. the shop keys switch) and fires one change event. */
  update(fn: () => void): void;
  onChange(cb: () => void): () => void;
}
